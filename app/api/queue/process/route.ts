// app/api/queue/process/route.ts
//
// User-triggered version of the send queue, scoped to the caller's workspace.
// This is what the dashboard "Process send queue" button calls, so the queue
// can run on demand without a cron (useful on plans without frequent crons).
//
// It makes the same two passes as the cron, in the same order: due sequence
// steps first, so a step that becomes due now is queued and then delivered on
// this one request, and the delivery loop second. A paused workspace is
// refused before either pass, and the cap defers rather than fails.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { loadSendControls } from '@/lib/cadence/send-controls';
import { deliverDueEmails } from '@/lib/cadence/send-queue';
import { runDueSequenceSteps } from '@/lib/cadence/sequence-runner';
import { supabaseServer, supabaseService } from '@/lib/supabase/server';

const bodySchema = z.object({ workspaceId: z.string().uuid() });

export async function POST(request: Request) {
  try {
    const db = await supabaseServer();

    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { workspaceId } = parsed.data;

    // RLS ownership check before running under the service role.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const service = supabaseService();

    // Before anything, including the sequence pass and its model calls.
    const controls = await loadSendControls(service, workspaceId);
    if (!controls || controls.paused) {
      return NextResponse.json(
        { error: 'Sending is paused for this workspace. Nothing was drafted or sent.' },
        { status: 409 }
      );
    }

    const sequences = await runDueSequenceSteps(service, { workspaceId });
    const delivery = await deliverDueEmails(service, { workspaceId });
    const held = delivery.held[0] ?? null;

    return NextResponse.json({
      data: {
        processed: delivery.processed,
        sent: delivery.sent,
        blocked: delivery.blocked,
        failed: delivery.failed,
        /** Set when the kill switch or the cap stopped the pass early. */
        held: held
          ? { reason: held.reason, retryAt: held.retryAt, waiting: held.waiting }
          : null,
        sequenceSteps: {
          due: sequences.due,
          queued: sequences.queued,
          stopped: sequences.stopped,
          deferred: sequences.deferred,
          failed: sequences.failed,
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
