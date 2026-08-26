// app/api/agents/qualifier/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { loadActiveIcp } from '@/lib/cadence/icp';
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

  // Scoring against no profile is what produced a wall of 15s and parked
  // leads, so say so instead of spending a model call to learn nothing.
  const icp = await loadActiveIcp(db, workspaceId);
  if (!icp) {
    return NextResponse.json(
      {
        error:
          'No active ideal customer profile. Create one on the ICP page and set it active before qualifying leads.',
      },
      { status: 400 }
    );
  }

  // Per-lead results. A failure carries the reason so the table can name it
  // rather than quietly reporting a smaller success count.
  const results: Array<
    | { leadId: string; ok: false; error: string; failureKind: string }
    | { leadId: string; ok: true; fit_score: number; reasoning: string; urgency: string; recommended_channel: string }
  > = [];

  for (const leadId of leadIds) {
    const run = await runAgent<{
      fit_score: number;
      reasoning: string;
      urgency: string;
      recommended_channel: string;
    }>(db, { agent: 'qualifier', workspaceId, leadId, extra: { icp } });

    if (!run.ok || !run.data) {
      results.push({
        leadId,
        ok: false,
        error: run.error ?? 'Qualifier run failed',
        failureKind: run.failure?.kind ?? 'unknown',
      });
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
        // Record which profile the score was made against: a score is only
        // meaningful next to the profile that produced it, and the active
        // profile changes.
        icp_profile_id: icp.id,
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
