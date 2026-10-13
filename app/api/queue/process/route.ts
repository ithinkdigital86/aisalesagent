// app/api/queue/process/route.ts
//
// User-triggered version of the send queue, scoped to the caller's workspace.
// This is what the dashboard "Process send queue" button calls, so the queue
// can run on demand without a cron (useful on plans without frequent crons).
//
// It makes the same two passes as the cron, in the same order: due sequence
// steps first, so a step that becomes due now is queued and then delivered on
// this one request, and the delivery loop second.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { deliverQueuedEmailAction } from '@/lib/cadence/adapters/email';
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

    const sequences = await runDueSequenceSteps(service, { workspaceId });

    const { data: due } = await service
      .from('actions')
      .select('id, workspace_id, lead_id, subject, body')
      .eq('workspace_id', workspaceId)
      .eq('status', 'queued')
      .eq('channel', 'email')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(50);

    let sent = 0;
    let blocked = 0;
    let failed = 0;
    for (const action of due ?? []) {
      const result = await deliverQueuedEmailAction(service, action);
      if (result.status === 'sent') sent += 1;
      else if (result.status === 'blocked') blocked += 1;
      else if (result.status === 'failed') failed += 1;
    }

    return NextResponse.json({
      data: {
        processed: due?.length ?? 0,
        sent,
        blocked,
        failed,
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
