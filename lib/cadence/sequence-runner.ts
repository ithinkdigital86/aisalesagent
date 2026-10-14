// lib/cadence/sequence-runner.ts
//
// The pass the send queue makes over sequences. This is the half that touches
// the database: it reads which leads are due, checks the stop conditions at
// send time, asks the channel's existing agent for the message, queues it, and
// moves the lead's date to when it should next be looked at. The rules it
// applies are in ./sequence.ts.
//
// A step's delay counts from when the previous step was sent, not from when
// it was queued, and a lead whose previous step has not been sent is not due
// for the next one. So queueing a step does not schedule the next: it sets a
// date to look again (the next pass, or the day an unapproved draft expires),
// and the next step's due date is worked out from sent_at once there is one.
// A step that never sends ends the run with its own stop reason rather than
// holding the lead on the sequence for good; see stepReadiness.
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
//
// The workspace's limits (migration 0011) are checked here before anything
// else. The kill switch leaves a paused workspace's leads exactly as they
// were. The minimum fit score is a rule, not a saving: a lead below it is
// never drafted to, whatever its consent. The daily cap is a saving again,
// like the gate call: the adapter's claim enforces it, and this only avoids
// drafting more email than the cap will let out today.

import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateConsent, type Channel } from '@/lib/cadence/consent';
import { loadActiveIcp } from '@/lib/cadence/icp';
import { runAgent } from '@/lib/cadence/runtime';
import type { AgentSlug } from '@/lib/cadence/roster';
import {
  checkFit,
  inList,
  loadSendControls,
  loadSendWindow,
  pausedWorkspaceIds,
  retryAfterCap,
} from '@/lib/cadence/send-controls';
import {
  DUE_BATCH_LIMIT,
  STEP_EXPIRY_DAYS,
  dueOn,
  nextPass,
  nextStep,
  parseSteps,
  stepReadiness,
  stopReasonFrom,
  type StopSignals,
} from '@/lib/cadence/sequence';
import { loadStepAttempts, type RetryableAttempt } from '@/lib/cadence/sequence-progress';
import type { Database, Json, TablesUpdate } from '@/types/database';

type Db = SupabaseClient<Database>;

/** Calendar days a step waits when the consent gate says the channel is closed. */
const BLOCKED_RETRY_DAYS = 7;

/**
 * Calendar days a step waits when the lead is below the minimum fit score.
 * Short, because the cure is a rescore or a lower minimum, and either should
 * let the lead carry on from where it is rather than a week later.
 */
const BELOW_FIT_RETRY_DAYS = 1;

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
  fit_score: number | null;
  assigned_sequence_id: string | null;
  sequence_step: number;
}

export const DUE_LEAD_COLUMNS =
  'id, workspace_id, stage, email, fit_score, assigned_sequence_id, sequence_step';

export type StepOutcome =
  | { status: 'stopped'; reason: string }
  | {
      status: 'queued';
      step: number;
      channel: Channel;
      actionId: string | null;
      awaitingApproval: boolean;
      nextAt: string | null;
      /** Which send of this step this is: 1 for a fresh draft, more for a retry. */
      attempt: number;
    }
  /** Nothing was queued and the step will be tried again on this date. */
  | { status: 'deferred'; reason: string; nextAt: string }
  /** The kill switch is on. Nothing was written for this lead. */
  | { status: 'paused' }
  | { status: 'failed'; reason: string };

type Draft = { subject?: string; body: string };

/**
 * How many more emails one pass may queue per workspace before the daily cap
 * would hold them. Read once per workspace per pass and counted down as steps
 * are queued, because a step queued now is delivered later in the same pass
 * and the window count cannot see it yet.
 */
export class EmailBudget {
  private room = new Map<string, { left: number; retryAt: string }>();
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** Room left, and when to come back if there is none. */
  async check(workspaceId: string, cap: number): Promise<{ left: number; retryAt: string }> {
    const known = this.room.get(workspaceId);
    if (known) return known;

    const now = new Date();
    const window = await loadSendWindow(this.db, workspaceId, now);
    // Email already queued is spoken for: it takes a slot when it is sent.
    const { count: queued } = await this.db
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('channel', 'email')
      .eq('status', 'queued');

    const entry = { left: cap - window.used - (queued ?? 0), retryAt: retryAfterCap(window, now) };
    this.room.set(workspaceId, entry);
    return entry;
  }

  take(workspaceId: string): void {
    const known = this.room.get(workspaceId);
    if (known) known.left -= 1;
  }
}

/** Nothing queued; try the same step again at nextAt. */
async function deferLead(db: Db, lead: DueLead, reason: string, nextAt: string): Promise<StepOutcome> {
  await db
    .from('leads')
    .update({ next_action_at: nextAt })
    .eq('id', lead.id)
    .eq('workspace_id', lead.workspace_id);
  return { status: 'deferred', reason, nextAt };
}

/**
 * Something went wrong that is not about the lead: a draft or a write failed.
 * The lead keeps its step and is looked at again on the next pass.
 */
async function retryNextPass(db: Db, lead: DueLead, reason: string): Promise<StepOutcome> {
  await db
    .from('leads')
    .update({ next_action_at: nextPass() })
    .eq('id', lead.id)
    .eq('workspace_id', lead.workspace_id);
  return { status: 'failed', reason };
}

/**
 * A step that sat unsent past STEP_EXPIRY_DAYS. An unapproved draft is
 * blocked first, so it leaves the approvals list and cannot be approved into
 * a run that has stopped; only while it is still awaiting approval, because
 * one approved a moment ago is on its way and the run waits for it. A row
 * stuck in 'sending' is left as it is: whether it went out is unknown.
 */
async function expireStep(
  db: Db,
  lead: DueLead,
  attempt: RetryableAttempt,
  status: 'awaiting_approval' | 'sending'
): Promise<StepOutcome> {
  if (status === 'awaiting_approval') {
    const { data, error } = await db
      .from('actions')
      .update({ status: 'blocked', block_reason: 'step_expired' })
      .eq('id', attempt.id)
      .eq('workspace_id', lead.workspace_id)
      .eq('status', 'awaiting_approval')
      .select('id');
    if (error) return retryNextPass(db, lead, `expire_failed: ${error.message}`);
    if (!data?.length) return deferLead(db, lead, 'step_awaiting_approval', nextPass());
  }
  return stop(db, lead, 'step_expired');
}

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
 * be left due with nothing written. The action queued is the next step, or
 * the current step again when its send failed.
 */
export async function runSequenceStep(
  db: Db,
  lead: DueLead,
  budget: EmailBudget = new EmailBudget(db)
): Promise<StepOutcome> {
  if (!lead.assigned_sequence_id) return { status: 'failed', reason: 'not_on_a_sequence' };

  // The kill switch, read fresh for every lead rather than once per pass: a
  // pass with model calls in it runs for minutes, and the switch has to take
  // effect on the next lead, not the next tick. A workspace that cannot be
  // read is treated as paused.
  const controls = await loadSendControls(db, lead.workspace_id);
  if (!controls || controls.paused) return { status: 'paused' };

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

  // The step already queued has to have been sent before the next is due,
  // and the next one's delay counts from that send. Checked before fit and
  // consent, because a lead held on an unsent step is not due for anything.
  let retry: RetryableAttempt | null = null;
  let attempt = 1;
  if (lead.sequence_step > 0) {
    let attempts: RetryableAttempt[];
    try {
      attempts = await loadStepAttempts(db, lead, sequence.id, lead.sequence_step);
    } catch (err) {
      // Not "no rows": that would stop the run as step_missing.
      return retryNextPass(db, lead, err instanceof Error ? err.message : 'step_read_failed');
    }

    const ready = stepReadiness(attempts, step?.delay_days ?? null);
    switch (ready.kind) {
      case 'run':
        break;
      case 'complete':
        return stop(db, lead, 'completed');
      case 'wait':
        return deferLead(db, lead, ready.reason === 'not_due' ? 'not_due' : `step_${ready.reason}`, ready.at);
      case 'expire':
        return expireStep(db, lead, attempts[0], ready.status);
      case 'stop':
        return stop(db, lead, ready.reason);
      case 'retry':
        retry = attempts[0];
        attempt = ready.failures + 1;
        break;
    }
  }

  // A retry sends the same step again, as it was approved, so it does not
  // wait for approval a second time.
  const work = retry
    ? { step: lead.sequence_step, channel: retry.channel, requires_approval: false }
    : step;
  if (!work) return stop(db, lead, 'completed');

  const channel = work.channel;

  // Below the minimum, or never scored: not drafted to. The lead keeps its
  // place and is looked at again tomorrow, so a rescore or a lower minimum
  // lets it carry on from this step rather than start over. Tomorrow is the
  // calendar day, as for a step's delay: now plus 24 hours lands seconds
  // after tomorrow's pass and would slip a whole day every time.
  const fit = checkFit(lead.fit_score, controls.minFitScore);
  if (!fit.ok) {
    return deferLead(db, lead, fit.reason, dueOn(new Date(), BELOW_FIT_RETRY_DAYS));
  }

  // Not a gate, a saving. The adapter re-runs this at send time and its
  // verdict is the one that decides whether anything leaves. Checking here
  // only avoids paying for a draft that cannot be delivered today.
  const verdict = await evaluateConsent(db, {
    workspaceId: lead.workspace_id,
    leadId: lead.id,
    channel,
  });
  if (!verdict.allowed) {
    return deferLead(db, lead, verdict.reason, dueOn(new Date(), BLOCKED_RETRY_DAYS));
  }

  // An email step that goes straight to the queue needs a slot under the
  // cap. One that waits for approval takes no slot until it is approved and
  // sent, and the claim counts it then.
  const queuesEmail = channel === 'email' && !work.requires_approval && !verdict.requiresApproval;
  if (queuesEmail) {
    const room = await budget.check(lead.workspace_id, controls.dailyCap);
    if (room.left <= 0) return deferLead(db, lead, 'daily_cap_reached', room.retryAt);
  }

  // The message itself. A retry sends the failed message again, unchanged,
  // and points at the row it replaces, which is how the step's failures are
  // counted. A fresh step comes from the same agent, prompt and review as the
  // manual draft button; step_number is what tells it this is a follow-up.
  let message: { agent: AgentSlug; subject: string | null; body: string; ai_tells: Json | null };
  if (retry) {
    message = { agent: retry.agent, subject: retry.subject, body: retry.body, ai_tells: retry.ai_tells };
  } else {
    const icp = await loadActiveIcp(db, lead.workspace_id);
    const agent = AGENT_FOR_CHANNEL[channel];
    const run = await runAgent<Draft>(db, {
      agent,
      workspaceId: lead.workspace_id,
      leadId: lead.id,
      extra: { icp, step_number: work.step },
    });

    // The draft failed, not the sequence. Try the same step tomorrow rather
    // than burning it, and leave sequence_step where it is.
    if (!run.ok || !run.data) return retryNextPass(db, lead, run.error ?? 'draft_failed');

    message = {
      agent,
      subject: run.data.subject ?? null,
      body: run.data.body,
      ai_tells: (run.tells ?? null) as Json,
    };
  }

  // A step marked for approval, or a channel the gate will not let us send
  // unattended, waits for a human in the approvals queue.
  const awaitingApproval = work.requires_approval || verdict.requiresApproval;
  const { data: action, error: insertErr } = await db
    .from('actions')
    .insert({
      workspace_id: lead.workspace_id,
      lead_id: lead.id,
      agent: message.agent,
      channel,
      subject: message.subject,
      body: message.body,
      ai_tells: message.ai_tells,
      status: awaitingApproval ? 'awaiting_approval' : 'queued',
      // Due now: the send queue delivers it on this same pass. consent_basis
      // stays null until the gate runs at send time.
      scheduled_for: new Date().toISOString(),
      sequence_id: sequence.id,
      step_number: work.step,
      retry_of: retry?.id ?? null,
    })
    .select('id')
    .single();

  // Nothing was queued, so the lead must not move past this step: moving it
  // would lose the step without a trace. It stays where it is for tomorrow.
  if (insertErr || !action) {
    return retryNextPass(db, lead, `action_insert_failed: ${insertErr?.message ?? 'no row returned'}`);
  }
  if (queuesEmail) budget.take(lead.workspace_id);

  // Not the next step's due date, which cannot be known until this one is
  // sent: the date to look again. A queued row normally goes out on this
  // pass, so that is the next pass. A draft waiting for approval is looked at
  // again when it would expire; approving or rejecting it brings that
  // forward (wakeSequenceLead in ./approvals.ts).
  const nextAt = awaitingApproval ? dueOn(new Date(), STEP_EXPIRY_DAYS) : nextPass();

  const patch: TablesUpdate<'leads'> = {
    sequence_step: work.step,
    next_action_at: nextAt,
  };
  // Nothing has been contacted before step one, and the stage filters on the
  // dashboard and the follow-up cron both read this.
  if (PRE_CONTACT_STAGES.includes(lead.stage)) patch.stage = 'contacted';

  await db.from('leads').update(patch).eq('id', lead.id).eq('workspace_id', lead.workspace_id);
  await refreshCounters(db, sequence.id);

  return {
    status: 'queued',
    step: work.step,
    channel,
    actionId: (action.id as string | undefined) ?? null,
    awaitingApproval,
    nextAt,
    attempt,
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
  /** Leads left alone because their workspace was paused mid-pass. */
  paused: number;
  failed: number;
  /** Workspaces skipped whole because their kill switch was on. */
  pausedWorkspaces: number;
  leads: Array<{ leadId: string; outcome: StepOutcome }>;
}

/**
 * Every lead whose next step is due, driven one step. Called by the send
 * queue cron and by the dashboard's manual trigger, in both cases before the
 * delivery loop, so a step queued on this pass is also sent on it.
 *
 * `workspaceId` scopes the pass to one workspace for the manual trigger; the
 * cron omits it and runs across all of them.
 *
 * Paused workspaces are left out of the query rather than skipped lead by
 * lead, so their due leads cannot fill the batch and starve everyone else.
 */
export async function runDueSequenceSteps(
  db: Db,
  opts: { workspaceId?: string; limit?: number } = {}
): Promise<SequencePassResult> {
  const result: SequencePassResult = {
    due: 0,
    queued: 0,
    stopped: 0,
    deferred: 0,
    paused: 0,
    failed: 0,
    pausedWorkspaces: 0,
    leads: [],
  };

  const paused = await pausedWorkspaceIds(db);
  if (opts.workspaceId) {
    if (paused.includes(opts.workspaceId)) {
      result.pausedWorkspaces = 1;
      return result;
    }
  } else {
    result.pausedWorkspaces = paused.length;
  }

  let query = db
    .from('leads')
    .select(DUE_LEAD_COLUMNS)
    .not('assigned_sequence_id', 'is', null)
    .is('sequence_stopped_reason', null)
    .lte('next_action_at', new Date().toISOString())
    .order('next_action_at', { ascending: true })
    .limit(opts.limit ?? DUE_BATCH_LIMIT);
  if (opts.workspaceId) query = query.eq('workspace_id', opts.workspaceId);
  else if (paused.length > 0) query = query.not('workspace_id', 'in', inList(paused));

  const { data: due } = await query;
  result.due = due?.length ?? 0;

  const budget = new EmailBudget(db);
  for (const lead of (due ?? []) as DueLead[]) {
    const outcome = await runSequenceStep(db, lead, budget);
    result[outcome.status] += 1;
    result.leads.push({ leadId: lead.id, outcome });
  }

  return result;
}
