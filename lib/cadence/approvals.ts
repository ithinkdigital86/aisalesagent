// lib/cadence/approvals.ts
//
// What approving a draft writes. Kept out of the route so the consent rule
// below can be tested without a request.
//
// Email goes back into the send queue, and the send path runs the consent
// gate again before anything leaves. The other channels have no send path:
// a person delivers them, and approval marks them sent. So for those the
// approval is the last moment anything can say no, and the gate runs here.
// Without it, a LinkedIn draft written before the lead unsubscribed was still
// approvable, and was recorded as sent to a suppressed lead.

import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateConsent, type Channel, type ConsentBasis } from './consent.ts';

export interface ApprovableAction {
  workspace_id: string;
  lead_id: string;
  channel: Channel;
}

export type ApprovalPatch =
  | { status: 'queued'; scheduled_for: string }
  | { status: 'sent'; sent_at: string; consent_basis: ConsentBasis }
  | { status: 'blocked'; block_reason: string };

export async function approvalPatch(
  db: SupabaseClient,
  action: ApprovableAction,
  now: string = new Date().toISOString()
): Promise<ApprovalPatch> {
  if (action.channel === 'email') return { status: 'queued', scheduled_for: now };

  const verdict = await evaluateConsent(db, {
    workspaceId: action.workspace_id,
    leadId: action.lead_id,
    channel: action.channel,
  });
  if (!verdict.allowed) return { status: 'blocked', block_reason: verdict.reason };

  return { status: 'sent', sent_at: now, consent_basis: verdict.basis };
}

export interface SequenceDraft {
  workspace_id: string;
  lead_id: string;
  sequence_id: string | null;
  step_number: number | null;
}

/**
 * Bring a sequence lead's next look forward to now, after its step's draft
 * was approved or rejected. While a draft waits, the runner only looks again
 * on the day it would expire, so without this an approval would hold the next
 * step until then, and a rejection would not show as a stopped run until
 * then either. Only for a lead still running that same step: a lead moved on,
 * stopped or re-enrolled is left alone.
 *
 * Returns the database error rather than throwing. The approval itself has
 * already been written, and the expiry date is still there as a fallback.
 */
export async function wakeSequenceLead(
  db: SupabaseClient,
  action: SequenceDraft,
  now: string = new Date().toISOString()
): Promise<{ message: string } | null> {
  if (!action.sequence_id || !action.step_number) return null;
  const { error } = await db
    .from('leads')
    .update({ next_action_at: now })
    .eq('id', action.lead_id)
    .eq('workspace_id', action.workspace_id)
    .eq('assigned_sequence_id', action.sequence_id)
    .eq('sequence_step', action.step_number)
    .is('sequence_stopped_reason', null);
  return error ? { message: error.message } : null;
}
