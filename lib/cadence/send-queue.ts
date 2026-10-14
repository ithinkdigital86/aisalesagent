// lib/cadence/send-queue.ts
//
// The delivery half of the send queue: queued email actions whose time has
// come, sent one by one through the adapter. Shared by the cron and the
// dashboard's "Process send queue" button, which used to carry a copy each.
//
// It goes workspace by workspace rather than taking the oldest rows across
// all of them. A workspace that is paused or has used its daily cap would
// otherwise fill every batch with rows it cannot send, and nobody else's
// queue would move. Each workspace is looked at first: paused is skipped,
// full is skipped, and the rest get at most as many rows as they have room
// for. That look is a saving, not the rule; claim_email_send makes the
// decision on every row, and a 'deferred' from it ends that workspace's turn.
//
// Relative imports, so node --test can load this file directly.

import type { SupabaseClient } from '@supabase/supabase-js';

import { deliverQueuedEmailAction, type DeferReason, type SendEmailResult } from './adapters/email.ts';
import { capResetsAt, loadSendControls, loadSendWindow } from './send-controls.ts';

/** Most rows one pass will try to send, across every workspace. */
export const DELIVERY_BATCH_LIMIT = 50;

/** How many due rows are read to find which workspaces have work. */
const WORKSPACE_SCAN_LIMIT = 1000;

export interface HeldWorkspace {
  workspaceId: string;
  reason: DeferReason;
  /** For the cap: the start of tomorrow, when the count starts again. */
  retryAt: string | null;
  /** Due email rows left queued in this workspace after the pass. */
  waiting: number;
}

export interface DeliveryResult {
  processed: number;
  sent: number;
  blocked: number;
  failed: number;
  skipped: number;
  /** Rows the claim left queued because of the kill switch or the cap. */
  deferred: number;
  /** Workspaces that sent nothing more on this pass, and why. */
  held: HeldWorkspace[];
  handled: Array<{ id: string; status: SendEmailResult['status'] }>;
}

const DUE_COLUMNS = 'id, workspace_id, lead_id, subject, body';

async function countWaiting(db: SupabaseClient, workspaceId: string, now: Date): Promise<number> {
  const { count } = await db
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'queued')
    .eq('channel', 'email')
    .lte('scheduled_for', now.toISOString());
  return count ?? 0;
}

export async function deliverDueEmails(
  db: SupabaseClient,
  opts: { workspaceId?: string; limit?: number; now?: Date } = {}
): Promise<DeliveryResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DELIVERY_BATCH_LIMIT;

  const result: DeliveryResult = {
    processed: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    held: [],
    handled: [],
  };

  let scan = db
    .from('actions')
    .select('workspace_id')
    .eq('status', 'queued')
    .eq('channel', 'email')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(WORKSPACE_SCAN_LIMIT);
  if (opts.workspaceId) scan = scan.eq('workspace_id', opts.workspaceId);
  const { data: scanned, error: scanError } = await scan;
  if (scanError) throw new Error(`could not read the send queue: ${scanError.message}`);

  // Oldest work first, one entry per workspace.
  const workspaces = [...new Set((scanned ?? []).map((row) => row.workspace_id as string))];

  for (const workspaceId of workspaces) {
    if (result.processed >= limit) break;

    const controls = await loadSendControls(db, workspaceId);
    // Unreadable reads as paused: nothing is sent on a switch nobody can see.
    if (!controls || controls.paused) {
      result.held.push({
        workspaceId,
        reason: 'sending_paused',
        retryAt: null,
        waiting: await countWaiting(db, workspaceId, now),
      });
      continue;
    }

    // Rounds, because a row that is blocked or fails at send time leaves its
    // slot free, and the window is re-read each round to see it. Each round
    // either sends, is held, or finds nothing left, and every row it takes
    // leaves 'queued', so it cannot spin; the batch limit bounds it anyway.
    while (result.processed < limit) {
      const window = await loadSendWindow(db, workspaceId, now);
      const headroom = controls.dailyCap - window.used;
      if (headroom <= 0) {
        const waiting = await countWaiting(db, workspaceId, now);
        if (waiting > 0) {
          result.held.push({
            workspaceId,
            reason: 'daily_cap_reached',
            retryAt: window.resetsAt,
            waiting,
          });
        }
        break;
      }

      const { data: due, error: dueError } = await db
        .from('actions')
        .select(DUE_COLUMNS)
        .eq('workspace_id', workspaceId)
        .eq('status', 'queued')
        .eq('channel', 'email')
        .lte('scheduled_for', now.toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(Math.min(limit - result.processed, headroom));
      if (dueError) throw new Error(`could not read the send queue: ${dueError.message}`);
      if (!due?.length) break;

      let deferred = false;
      for (const action of due) {
        const sent = await deliverQueuedEmailAction(
          db,
          action as Parameters<typeof deliverQueuedEmailAction>[1]
        );
        result.processed += 1;
        result.handled.push({ id: action.id as string, status: sent.status });

        if (sent.status === 'deferred') {
          // The switch was turned on, or another pass used the last slot,
          // after the look above. Either way nothing more goes from here.
          deferred = true;
          result.deferred += 1;
          result.held.push({
            workspaceId,
            reason: sent.reason,
            retryAt: sent.reason === 'daily_cap_reached' ? capResetsAt(now) : null,
            waiting: await countWaiting(db, workspaceId, now),
          });
          break;
        }
        if (sent.status === 'sent') result.sent += 1;
        else if (sent.status === 'blocked') result.blocked += 1;
        else if (sent.status === 'failed') result.failed += 1;
        else if (sent.status === 'skipped') result.skipped += 1;
      }
      if (deferred) break;
    }
  }

  return result;
}
