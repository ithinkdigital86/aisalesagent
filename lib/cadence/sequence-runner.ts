// lib/cadence/sequence-runner.ts
//
// The pass the send queue makes over sequences. This is the half that touches
// the database: it reads which leads are due, checks the stop conditions at
// send time, asks the channel's existing agent for the message, queues it, and
// moves the lead's date to the next step. The rules it applies are in
// ./sequence.ts.
//
// The division of labour, because it is easy to get wrong:
//
//  - This module owns timing and stopping. Mechanical, no judgement calls, and
//    checked at send time rather than only when the step was scheduled,
//    because a reply landing between the two is exactly what a schedule-time
//    check misses.
//
//  - The existing channel agent owns what the message says. Nothing here
//    writes copy: a step's draft comes from the same agent the manual "Draft
//    emails" button calls, with step_number set, so the prompt that already
//    knows how a second touch should read is the one that writes it.
//
//  - The Follow-up manager owns what a reply means. When a reply stops a
//    sequence the lead keeps its next_action_at and the follow-up cron picks
//    it up on the next tick. That is why the follow-up cron skips leads whose
//    sequence is still running: exactly one scheduler writes next_action_at at
//    a time, and sequence_stopped_reason is what says which one.
//
// Every send still passes the consent gate in the adapter at send time. The
// gate call in here is an optimisation, not a second gate: it avoids spending
// a model call on a draft that could not legally be delivered.

import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateConsent, type Channel } from '@/lib/cadence/consent';
import { loadActiveIcp } from '@/lib/cadence/icp';
import { runAgent } from '@/lib/cadence/runtime';
import type { AgentSlug } from '@/lib/cadence/roster';
import {
  DUE_BATCH_LIMIT,
  dueAt,
  nextStep,
  parseSteps,
  stopReasonFrom,
  type StopSignals,
} from '@/lib/cadence/sequence';
import type { Database, Json, TablesUpdate } from '@/types/database';

type Db = SupabaseClient<Database>;

/** How long a step waits when the consent gate says the channel is closed. */
const BLOCKED_RETRY_DAYS = 7;

/**
 * Read the stop signals for one lead. Three reads, because the six conditions
 * in the brief land in three places: the lead's own stage, the actions written
 * for it, and the suppression list the unsubscribe route and the Resend
 * webhook write to.
 */
export async function loadStopSignals(
  db: Db,
  lead: { id: string; workspace_id: string; stage: string; email: string | null }
): Promise<StopSignals> {
  const { data: actions } = await db
    .from('actions')
    .select('replied_at, status, block_reason')
    .eq('lead_id', lead.id)
    .eq('workspace_id', lead.workspace_id)
    .limit(100);

  const hasReply = (actions ?? []).some((action) => action.replied_at !== null);
  // The webhook writes the bounce class into block_reason as
  // "bounce:Permanent/...". Checked as well as the suppression row because a
  // bounce that suppressed the address is the same event seen twice, and
  // either half arriving alone must still stop the run.
  const hardBounced = (actions ?? []).some((action) =>
    (action.block_reason ?? '').toLowerCase().startsWith('bounce:permanent')
  );

  let suppression: string | null = null;
  if (lead.email) {
    const { data } = await db
      .from('suppression_list')
      .select('reason')
      .eq('workspace_id', lead.workspace_id)
      .eq('email', lead.email.toLowerCase())
      .limit(1);
    suppression = (data?.[0]?.reason as string | undefined) ?? null;
  }

  return { stage: lead.stage, hasReply, hardBounced, suppression };
}

// ---------------------------------------------------------------
// Running a step
// ---------------------------------------------------------------

/** Which agent writes a step's message. Nothing here writes copy itself. */
const AGENT_FOR_CHANNEL: Record<Channel, AgentSlug> = {
  email: 'email_specialist',
  linkedin: 'linkedin_specialist',
  instagram: 'instagram_specialist',
  voice: 'voice_specialist',
  sms: 'content_creator',
};

/** Stages a first step is allowed to move a lead out of. */
const PRE_CONTACT_STAGES = ['sourced', 'qualified', 'parked'];

export interface DueLead {
  id: string;
  workspace_id: string;
  stage: string;
  email: string | null;
  assigned_sequence_id: string | null;
  sequence_step: number;
}

export const DUE_LEAD_COLUMNS =
  'id, workspace_id, stage, email, assigned_sequence_id, sequence_step';

export type StepOutcome =
  | { status: 'stopped'; reason: string }
  | {
      status: 'queued';
      step: number;
      channel: Channel;
      actionId: string | null;
      awaitingApproval: boolean;
      nextAt: string | null;
    }
  /** Nothing was queued and the step will be tried again on this date. */
  | { status: 'deferred'; reason: string; nextAt: string }
  | { status: 'failed'; reason: string };

type Draft = { subject?: string; body: string };

/** Record why a run ended and hand the lead back to the Follow-up manager. */
async function stop(db: Db, lead: DueLead, reason: string): Promise<StepOutcome> {
  // A reply is the one stop that leaves next_action_at alone: the webhook set
  // it to now so the Follow-up manager would read the reply, and clearing it
  // here would throw away the wake-up the reply earned. Every other reason
  // means nobody should be scheduled against this lead at all.
  const patch: TablesUpdate<'leads'> = { sequence_stopped_reason: reason };
  if (reason !== 'reply') patch.next_action_at = null;

  await db.from('leads').update(patch).eq('id', lead.id).eq('workspace_id', lead.workspace_id);
  return { status: 'stopped', reason };
}

/**
 * Drive one lead one step. Every exit either stops the sequence, queues
 * exactly one action, or moves the lead's date forward, so a lead can never
 * be left due with nothing written.
 */
export async function runSequenceStep(db: Db, lead: DueLead): Promise<StepOutcome> {
  if (!lead.assigned_sequence_id) return { status: 'failed', reason: 'not_on_a_sequence' };

  // The stop check runs here, at send time, not when the step was scheduled.
  // Between the two a lead can reply, unsubscribe, bounce or be closed, and
  // every one of those has to stop the next message before it is written.
  const signals = await loadStopSignals(db, lead);
  const stopped = stopReasonFrom(signals);
  if (stopped) return stop(db, lead, stopped);

  const { data: sequence } = await db
    .from('sequences')
    .select('id, name, steps, active')
    .eq('id', lead.assigned_sequence_id)
    .eq('workspace_id', lead.workspace_id)
    .maybeSingle();

  if (!sequence) return stop(db, lead, 'sequence_missing');
  if (!sequence.active) return stop(db, lead, 'sequence_inactive');

  const steps = parseSteps(sequence.steps);
  const step = nextStep(steps, lead.sequence_step);
  if (!step) return stop(db, lead, 'completed');

  const channel = step.channel;

  // Not a gate, a saving. The adapter re-runs this at send time and its
  // verdict is the one that decides whether anything leaves. Checking here
  // only avoids paying for a draft that cannot be delivered today.
  const verdict = await evaluateConsent(db, {
    workspaceId: lead.workspace_id,
    leadId: lead.id,
    channel,
  });
  if (!verdict.allowed) {
    const nextAt = dueAt(new Date(), BLOCKED_RETRY_DAYS);
    await db
      .from('leads')
      .update({ next_action_at: nextAt })
      .eq('id', lead.id)
      .eq('workspace_id', lead.workspace_id);
    return { status: 'deferred', reason: verdict.reason, nextAt };
  }

  // The message itself. Same agent, same prompt, same review as the manual
  // draft button; step_number is what tells it this is a follow-up.
  const icp = await loadActiveIcp(db, lead.workspace_id);
  const agent = AGENT_FOR_CHANNEL[channel];
  const run = await runAgent<Draft>(db, {
    agent,
    workspaceId: lead.workspace_id,
    leadId: lead.id,
    extra: { icp, step_number: step.step },
  });

  if (!run.ok || !run.data) {
    // The draft failed, not the sequence. Try the same step tomorrow rather
    // than burning it, and leave sequence_step where it is.
    const nextAt = dueAt(new Date(), 1);
    await db
      .from('leads')
      .update({ next_action_at: nextAt })
      .eq('id', lead.id)
      .eq('workspace_id', lead.workspace_id);
    return { status: 'failed', reason: run.error ?? 'draft_failed' };
  }

  // A step marked for approval, or a channel the gate will not let us send
  // unattended, waits for a human in the approvals queue.
  const awaitingApproval = step.requires_approval || verdict.requiresApproval;
  const { data: action } = await db
    .from('actions')
    .insert({
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      agent,
      channel,
      subject: run.data.subject ?? null,
      body: run.data.body,
      ai_tells: (run.tells ?? null) as Json,
      status: awaitingApproval ? 'awaiting_approval' : 'queued',
      // Due now: the send queue delivers it on this same pass. consent_basis
      // stays null until the gate runs at send time.
      scheduled_for: new Date().toISOString(),
      sequence_id: sequence.id,
      step_number: step.step,
    })
    .select('id')
    .single();

  const following = nextStep(steps, step.step);
  const nextAt = following ? dueAt(new Date(), following.delay_days) : null;

  const patch: TablesUpdate<'leads'> = {
    sequence_step: step.step,
    next_action_at: nextAt,
  };
  // Nothing has been contacted before step one, and the stage filters on the
  // dashboard and the follow-up cron both read this.
  if (PRE_CONTACT_STAGES.includes(lead.stage)) patch.stage = 'contacted';
  // The last step leaves the lead with no date and a finished run, so the
  // Follow-up manager is the one that decides what happens next.
  if (!following) patch.sequence_stopped_reason = 'completed';

  await db.from('leads').update(patch).eq('id', lead.id).eq('workspace_id', lead.workspace_id);
  await refreshCounters(db, sequence.id);

  return {
    status: 'queued',
    step: step.step,
    channel,
    actionId: (action?.id as string | undefined) ?? null,
    awaitingApproval,
    nextAt,
  };
}

/**
 * Recount a sequence's sent and reply totals from the actions themselves.
 * Derived rather than incremented, so a counter cannot drift away from the
 * rows it claims to describe. It lags by one pass — the step queued a moment
 * ago has not been delivered yet — and corrects itself on the next one.
 */
async function refreshCounters(db: Db, sequenceId: string): Promise<void> {
  const { count: sent } = await db
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', sequenceId)
    .not('sent_at', 'is', null);

  const { count: replied } = await db
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', sequenceId)
    .not('replied_at', 'is', null);

  await db
    .from('sequences')
    .update({ sent_count: sent ?? 0, reply_count: replied ?? 0 })
    .eq('id', sequenceId);
}

// ---------------------------------------------------------------
// The pass the send queue makes
// ---------------------------------------------------------------

export interface SequencePassResult {
  due: number;
  queued: number;
  stopped: number;
  deferred: number;
  failed: number;
  leads: Array<{ leadId: string; outcome: StepOutcome }>;
}

/**
 * Every lead whose next step is due, driven one step. Called by the send
 * queue cron and by the dashboard's manual trigger, in both cases before the
 * delivery loop, so a step queued on this pass is also sent on it.
 *
 * `workspaceId` scopes the pass to one workspace for the manual trigger; the
 * cron omits it and runs across all of them.
 */
export async function runDueSequenceSteps(
  db: Db,
  opts: { workspaceId?: string; limit?: number } = {}
): Promise<SequencePassResult> {
  let query = db
    .from('leads')
    .select(DUE_LEAD_COLUMNS)
    .not('assigned_sequence_id', 'is', null)
    .is('sequence_stopped_reason', null)
    .lte('next_action_at', new Date().toISOString())
    .order('next_action_at', { ascending: true })
    .limit(opts.limit ?? DUE_BATCH_LIMIT);
  if (opts.workspaceId) query = query.eq('workspace_id', opts.workspaceId);

  const { data: due } = await query;

  const result: SequencePassResult = {
    due: due?.length ?? 0,
    queued: 0,
    stopped: 0,
    deferred: 0,
    failed: 0,
    leads: [],
  };

  for (const lead of (due ?? []) as DueLead[]) {
    const outcome = await runSequenceStep(db, lead);
    result[outcome.status] += 1;
    result.leads.push({ leadId: lead.id, outcome });
  }

  return result;
}
