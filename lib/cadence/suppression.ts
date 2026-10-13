// lib/cadence/suppression.ts
//
// The write half of suppression, shared by every path that takes a lead out
// of circulation: the unsubscribe route, the Resend webhook and the follow-up
// cron. Reading suppression stays in consent.ts.
//
// Both writes here throw on a database error rather than returning it. A
// suppression that silently did not happen is the worst outcome this table
// has, because the caller reports success and the address stays sendable. The
// callers turn the throw into a 500, and everything here is idempotent, so a
// retry from the mail client, from Resend or from the next cron tick is safe.

import type { SupabaseClient } from '@supabase/supabase-js';

/** A suppression write the database refused. Carries the Postgres code. */
export class SuppressionWriteError extends Error {
  readonly code: string | null;

  constructor(step: string, error: { code?: string | null; message: string }) {
    super(`${step} failed${error.code ? ` (${error.code})` : ''}: ${error.message}`);
    this.name = 'SuppressionWriteError';
    this.code = error.code ?? null;
  }
}

export interface SuppressionRow {
  workspace_id: string;
  email?: string | null;
  phone?: string | null;
  reason: string;
}

/**
 * Insert a suppression_list row, or leave an existing one as it is. The
 * conflict target must name a unique index on exactly those columns with no
 * predicate (0009); a partial index raises 42P10 here.
 */
export async function writeSuppression(
  db: SupabaseClient,
  row: SuppressionRow,
  onConflict: 'workspace_id,email' | 'workspace_id,phone'
): Promise<void> {
  const { error } = await db
    .from('suppression_list')
    .upsert(row, { onConflict, ignoreDuplicates: true });
  if (error) throw new SuppressionWriteError('suppression_list upsert', error);
}

/** Statuses that mean a message has not gone out and nobody is sending it. */
const PENDING: string[] = ['awaiting_approval', 'queued'];

/**
 * Block every draft for the lead that has not gone out. Without this an
 * approval queued before the opt-out is still sitting in /approvals, and a
 * LinkedIn or Instagram draft approved from there is marked sent with no gate
 * in between. 'sending' is left alone: that send is already in flight.
 */
export async function blockPendingActions(
  db: SupabaseClient,
  workspaceId: string,
  leadId: string,
  reason = 'lead_suppressed'
): Promise<void> {
  const { error } = await db
    .from('actions')
    .update({ status: 'blocked', block_reason: reason })
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .in('status', PENDING);
  if (error) throw new SuppressionWriteError('pending action block', error);
}
