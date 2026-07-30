// app/api/agents/qualifier/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { runAgent } from '@/lib/cadence/runtime';

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  leadIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(request: Request) {
  const db = await supabaseServer();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { workspaceId, leadIds } = parsed.data;

  // RLS confirms ownership, so a miss here means it is not theirs.
  const { data: ws } = await db
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .single();
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const { data: icp } = await db
    .from('icp_profiles')
    .select('name, filters, trigger_types')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .limit(1)
    .single();

  const results = [];

  for (const leadId of leadIds) {
    const run = await runAgent<{
      fit_score: number;
      reasoning: string;
      urgency: string;
      recommended_channel: string;
    }>(db, { agent: 'qualifier', workspaceId, leadId, extra: { icp } });

    if (!run.ok || !run.data) {
      results.push({ leadId, ok: false, error: run.error });
      continue;
    }

    const { fit_score, reasoning, urgency } = run.data;

    await db
      .from('leads')
      .update({
        fit_score,
        fit_reasoning: reasoning,
        stage: urgency === 'park' ? 'parked' : 'qualified',
        next_action_at: nextActionFor(urgency),
      })
      .eq('id', leadId)
      .eq('workspace_id', workspaceId);

    results.push({ leadId, ok: true, ...run.data });
  }

  return NextResponse.json({ data: results });
}

function nextActionFor(urgency: string): string | null {
  const hours: Record<string, number> = { now: 0, this_month: 48, nurture: 720 };
  if (!(urgency in hours)) return null;
  return new Date(Date.now() + hours[urgency] * 3_600_000).toISOString();
}
