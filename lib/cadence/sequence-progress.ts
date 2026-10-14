// lib/cadence/sequence-progress.ts
//
// Reads the action rows behind a lead's current step, which is what decides
// whether the next step is due (see stepReadiness in ./sequence.ts). The
// runner reads one lead's rows before it drafts anything; the leads and
// sequences pages read them in bulk, so a lead held on an unsent step says so
// instead of showing a date that is only when the runner will look again.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  describeProgress,
  nextStep,
  stepReadiness,
  type SequenceProgress,
  type SequenceStep,
  type StepAttempt,
} from '@/lib/cadence/sequence';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;

/** Enough history to count a step's retries; a step never has more than a few rows. */
const ATTEMPT_LIMIT = 20;

/** A row the runner can also queue again, when a failed send is retried. */
export interface RetryableAttempt extends StepAttempt {
  agent: Database['public']['Enums']['agent_slug'];
  channel: Database['public']['Enums']['channel'];
  subject: string | null;
  body: string;
  ai_tells: Database['public']['Tables']['actions']['Row']['ai_tells'];
}

/**
 * One lead's rows for one step of one sequence, newest first. Throws on a
 * read error: an empty answer reads as "this step was never queued", which
 * stops the run, and a failed read must not do that.
 */
export async function loadStepAttempts(
  db: Db,
  lead: { id: string; workspace_id: string },
  sequenceId: string,
  step: number
): Promise<RetryableAttempt[]> {
  const { data, error } = await db
    .from('actions')
    .select(
      'id, status, sent_at, created_at, updated_at, block_reason, retry_of, agent, channel, subject, body, ai_tells'
    )
    .eq('lead_id', lead.id)
    .eq('workspace_id', lead.workspace_id)
    .eq('sequence_id', sequenceId)
    .eq('step_number', step)
    .order('created_at', { ascending: false })
    .limit(ATTEMPT_LIMIT);
  if (error) throw new Error(`could not read step ${step}'s actions: ${error.message}`);
  return (data ?? []) as RetryableAttempt[];
}

export interface RunningLead {
  id: string;
  assigned_sequence_id: string | null;
  sequence_step: number;
  sequence_stopped_reason: string | null;
}

/**
 * The rows behind each running lead's current step, for display: whether the
 * step is waiting, failed or sent, and with retry_of, how many times it has
 * failed, exactly as the runner counts it. A lead missing from the map
 * has nothing to show beyond its date. A failed read returns an empty map,
 * so the tables fall back to dates rather than failing to render.
 */
export async function loadCurrentStepAttempts(
  db: Db,
  leads: RunningLead[]
): Promise<Map<string, StepAttempt[]>> {
  const running = leads.filter(
    (lead) => lead.assigned_sequence_id && !lead.sequence_stopped_reason && lead.sequence_step > 0
  );
  const byLead = new Map<string, StepAttempt[]>();
  if (running.length === 0) return byLead;

  const { data, error } = await db
    .from('actions')
    .select(
      'id, lead_id, sequence_id, step_number, status, sent_at, created_at, updated_at, block_reason, retry_of'
    )
    .in(
      'lead_id',
      running.map((lead) => lead.id)
    )
    .not('sequence_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(running.length * ATTEMPT_LIMIT);
  if (error) return byLead;

  for (const lead of running) {
    const rows = (data ?? []).filter(
      (row) =>
        row.lead_id === lead.id &&
        row.sequence_id === lead.assigned_sequence_id &&
        row.step_number === lead.sequence_step
    );
    // No rows is left to the runner to call: here it is as likely to be the
    // row limit as a missing step, and a date is the safer thing to show.
    if (rows.length > 0) byLead.set(lead.id, rows);
  }
  return byLead;
}

/** What the tables show for one lead, from the rows loadCurrentStepAttempts read. */
export function progressFor(
  lead: RunningLead & { next_action_at: string | null },
  steps: SequenceStep[],
  attempts: Map<string, StepAttempt[]>,
  now: Date = new Date()
): SequenceProgress {
  const rows = attempts.get(lead.id);
  const readiness = rows
    ? stepReadiness(rows, nextStep(steps, lead.sequence_step)?.delay_days ?? null, now)
    : null;
  return describeProgress(lead.sequence_step, readiness, lead.next_action_at);
}
