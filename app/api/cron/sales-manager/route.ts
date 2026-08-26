// app/api/cron/sales-manager/route.ts
//
// Runs once a day. Loops every workspace and runs the Sales Manager for each,
// mirroring the authenticated route in app/api/agents/sales-manager. runAgent
// logs each output to agent_runs, which is what the dashboard card reads, so
// the daily review is waiting on the dashboard without anyone pressing a
// button.

import { NextResponse } from 'next/server';

import { runAgent } from '@/lib/cadence/runtime';
import { supabaseService } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

  const { data: workspaces } = await db.from('workspaces').select('id').limit(200);

  const handled: Array<{
    workspaceId: string;
    ok: boolean;
    error?: string;
    failureKind?: string;
  }> = [];

  for (const ws of workspaces ?? []) {
    try {
      // Channel performance for the prompt, same shape the manual route builds.
      const { data: actions } = await db
        .from('actions')
        .select('channel, status, replied_at')
        .eq('workspace_id', ws.id);

      // A workspace with no activity yet has nothing to review. Skip it
      // rather than spending an Opus call to be told the pipeline is empty.
      if (!actions || actions.length === 0) {
        handled.push({ workspaceId: ws.id, ok: true, error: 'skipped_no_activity' });
        continue;
      }

      const channelStats: Record<string, { sent: number; replied: number }> = {};
      for (const action of actions) {
        const channel = action.channel as string;
        channelStats[channel] ??= { sent: 0, replied: 0 };
        if (action.status === 'sent') channelStats[channel].sent += 1;
        if (action.replied_at) channelStats[channel].replied += 1;
      }

      const run = await runAgent(db, {
        agent: 'sales_manager',
        workspaceId: ws.id,
        extra: { channelStats },
      });
      handled.push({
        workspaceId: ws.id,
        ok: run.ok,
        error: run.error,
        failureKind: run.failure?.kind,
      });
    } catch (err) {
      handled.push({
        workspaceId: ws.id,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown_error',
      });
    }
  }

  return NextResponse.json({ processed: handled.length, handled });
}
