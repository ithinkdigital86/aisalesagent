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
