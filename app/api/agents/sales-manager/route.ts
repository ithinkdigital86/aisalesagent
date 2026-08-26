// app/api/agents/sales-manager/route.ts
//
// Runs the Sales Manager for a workspace. runAgent logs the output to
// agent_runs, which the dashboard reads for "today's Sales Manager output".

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { runAgent, statusForFailure } from '@/lib/cadence/runtime';
import { supabaseServer } from '@/lib/supabase/server';

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

    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Channel performance for the prompt.
    const { data: actions } = await db
      .from('actions')
      .select('channel, status, replied_at')
      .eq('workspace_id', workspaceId);

    const channelStats: Record<string, { sent: number; replied: number }> = {};
    for (const action of actions ?? []) {
      const channel = action.channel as string;
      channelStats[channel] ??= { sent: 0, replied: 0 };
      if (action.status === 'sent') channelStats[channel].sent += 1;
      if (action.replied_at) channelStats[channel].replied += 1;
    }

    const run = await runAgent(db, {
      agent: 'sales_manager',
      workspaceId,
      extra: { channelStats },
    });
    if (!run.ok || !run.data) {
      return NextResponse.json(
        { error: run.error ?? 'Sales Manager run failed', failure: run.failure ?? null },
        { status: statusForFailure(run.failure) }
      );
    }

    return NextResponse.json({ data: run.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
