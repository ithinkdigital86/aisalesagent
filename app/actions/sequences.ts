'use server';

// app/actions/sequences.ts
//
// Server actions behind the sequences page. Everything runs on the
// request-scoped (RLS) client, so a caller can only ever touch sequences and
// leads in a workspace they own; the explicit workspace check is there to
// return a clean message rather than a silent no-op.
//
// Two rules are enforced here as well as in the database: a sequence has at
// least one step and never more than four. The check constraint in migration
// 0008 is what makes the cap true; this is what makes it a readable error.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  MAX_STEPS,
  TERMINAL_STAGES,
  dueOn,
  parseSteps,
  stepsSchema,
} from '@/lib/cadence/sequence';
import { checkFit, loadSendControls } from '@/lib/cadence/send-controls';
import { supabaseServer } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

export interface SequenceActionResult {
  ok: boolean;
  error?: string;
  id?: string;
  /** Set by enrolLeads: how many leads were put on the sequence. */
  enrolled?: number;
  /** Leads that were not enrolled, with the reason, so nothing fails silently. */
  skipped?: Array<{ leadId: string; reason: string }>;
}

const saveSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Absent means create. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Give the sequence a name').max(120),
  active: z.boolean().default(true),
  steps: stepsSchema,
});

export type SaveSequenceInput = z.input<typeof saveSchema>;

/** Confirms the workspace is the caller's. RLS does the real work. */
async function ownedWorkspace(workspaceId: string) {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { db, error: 'Unauthorised' as const };

  const { data: ws } = await db
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) return { db, error: 'Workspace not found' as const };
  return { db, error: undefined };
}

export async function saveSequence(input: SaveSequenceInput): Promise<SequenceActionResult> {
  try {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid sequence' };
    }
    const value = parsed.data;

    const { db, error } = await ownedWorkspace(value.workspaceId);
    if (error) return { ok: false, error };

    const row = {
      workspace_id: value.workspaceId,
      name: value.name,
      active: value.active,
      steps: value.steps as unknown as Json,
    };

    if (value.id) {
      const { error: updateErr } = await db
        .from('sequences')
        .update(row)
        .eq('id', value.id)
        .eq('workspace_id', value.workspaceId);
      if (updateErr) return { ok: false, error: updateErr.message };
      revalidatePath('/sequences');
      revalidatePath('/leads');
      return { ok: true, id: value.id };
    }

    const { data, error: insertErr } = await db
      .from('sequences')
      .insert(row)
      .select('id')
      .single();
    if (insertErr || !data) {
      return { ok: false, error: insertErr?.message ?? 'Could not save the sequence' };
    }

    revalidatePath('/sequences');
    revalidatePath('/leads');
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

const idSchema = z.object({
  workspaceId: z.string().uuid(),
  sequenceId: z.string().uuid(),
});

/**
 * Pausing is not deleting. A paused sequence stops every lead on it at its
 * next due step with reason 'sequence_inactive', and the leads keep their
 * position, so switching it back on does not restart anyone from step one.
 */
export async function setSequenceActive(input: {
  workspaceId: string;
  sequenceId: string;
  active: boolean;
}): Promise<SequenceActionResult> {
  try {
    const parsed = idSchema.extend({ active: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid request' };

    const { db, error } = await ownedWorkspace(parsed.data.workspaceId);
    if (error) return { ok: false, error };

    const { error: updateErr } = await db
      .from('sequences')
      .update({ active: parsed.data.active })
      .eq('id', parsed.data.sequenceId)
      .eq('workspace_id', parsed.data.workspaceId);
    if (updateErr) return { ok: false, error: updateErr.message };

    // A sequence switched back on has to let its leads move again, or they sit
    // stopped on a reason that is no longer true.
    if (parsed.data.active) {
      await db
        .from('leads')
        .update({ sequence_stopped_reason: null, next_action_at: new Date().toISOString() })
        .eq('workspace_id', parsed.data.workspaceId)
        .eq('assigned_sequence_id', parsed.data.sequenceId)
        .eq('sequence_stopped_reason', 'sequence_inactive');
    }

    revalidatePath('/sequences');
    revalidatePath('/leads');
    return { ok: true, id: parsed.data.sequenceId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

const enrolSchema = z.object({
  workspaceId: z.string().uuid(),
  sequenceId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1, 'Select at least one lead').max(200),
});

/**
 * Put leads on a sequence at step zero, due on the first step's delay.
 *
 * Leads the runner would only stop on its first look are refused here instead,
 * because "enrolled, then stopped a minute later" reads as a bug to whoever
 * did it. Suppression is not checked here: the consent gate owns that answer
 * and gives it at send time, every time, which is the only place it can be
 * relied on. Leads below the workspace's minimum fit score, or unscored, are
 * refused too; the runner checks again at every step.
 */
export async function enrolLeads(input: {
  workspaceId: string;
  sequenceId: string;
  leadIds: string[];
}): Promise<SequenceActionResult> {
  try {
    const parsed = enrolSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };
    }
    const { workspaceId, sequenceId, leadIds } = parsed.data;

    const { db, error } = await ownedWorkspace(workspaceId);
    if (error) return { ok: false, error };

    const { data: sequence } = await db
      .from('sequences')
      .select('id, active, steps')
      .eq('id', sequenceId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!sequence) return { ok: false, error: 'Sequence not found' };
    if (!sequence.active) return { ok: false, error: 'That sequence is paused. Switch it on first.' };

    const steps = parseSteps(sequence.steps);
    if (steps.length === 0) {
      return { ok: false, error: 'That sequence has no steps to run.' };
    }
    if (steps.length > MAX_STEPS) {
      return { ok: false, error: `A sequence can have at most ${MAX_STEPS} steps.` };
    }

    const { data: leads } = await db
      .from('leads')
      .select('id, stage, fit_score')
      .eq('workspace_id', workspaceId)
      .in('id', leadIds);

    // The minimum fit score is a rule about who is worth a sequence at all,
    // so it is applied here as well as at each step.
    const controls = await loadSendControls(db, workspaceId);
    if (!controls) return { ok: false, error: 'Could not read the workspace settings' };

    const skipped: Array<{ leadId: string; reason: string }> = [];
    const eligible: string[] = [];
    const found = new Set((leads ?? []).map((lead) => lead.id));

    for (const leadId of leadIds) {
      if (!found.has(leadId)) skipped.push({ leadId, reason: 'not in this workspace' });
    }
    for (const lead of leads ?? []) {
      const fit = checkFit(lead.fit_score, controls.minFitScore);
      if (lead.stage === 'suppressed') {
        skipped.push({ leadId: lead.id, reason: 'suppressed' });
      } else if ((TERMINAL_STAGES as readonly string[]).includes(lead.stage)) {
        skipped.push({ leadId: lead.id, reason: lead.stage.replace('_', ' ') });
      } else if (!fit.ok) {
        skipped.push({ leadId: lead.id, reason: fit.message });
      } else {
        eligible.push(lead.id);
      }
    }

    if (eligible.length === 0) {
      return { ok: false, error: 'None of those leads can be put on a sequence.', skipped };
    }

    // Step zero: nothing queued yet, and the first step falls due on its own
    // delay, counted in calendar days like every later step. The delay is
    // normally 0, which is the start of today: due at once.
    const { error: updateErr } = await db
      .from('leads')
      .update({
        assigned_sequence_id: sequenceId,
        sequence_step: 0,
        sequence_stopped_reason: null,
        next_action_at: dueOn(new Date(), steps[0].delay_days),
      })
      .eq('workspace_id', workspaceId)
      .in('id', eligible);
    if (updateErr) return { ok: false, error: updateErr.message };

    revalidatePath('/sequences');
    revalidatePath('/leads');
    return { ok: true, id: sequenceId, enrolled: eligible.length, skipped };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

/** Take leads off a sequence entirely. Their history stays on the actions. */
export async function removeFromSequence(input: {
  workspaceId: string;
  leadIds: string[];
}): Promise<SequenceActionResult> {
  try {
    const parsed = z
      .object({
        workspaceId: z.string().uuid(),
        leadIds: z.array(z.string().uuid()).min(1).max(200),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid request' };

    const { db, error } = await ownedWorkspace(parsed.data.workspaceId);
    if (error) return { ok: false, error };

    const { error: updateErr } = await db
      .from('leads')
      .update({
        assigned_sequence_id: null,
        sequence_step: 0,
        sequence_stopped_reason: null,
        next_action_at: null,
      })
      .eq('workspace_id', parsed.data.workspaceId)
      .in('id', parsed.data.leadIds);
    if (updateErr) return { ok: false, error: updateErr.message };

    revalidatePath('/sequences');
    revalidatePath('/leads');
    return { ok: true, enrolled: 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}
