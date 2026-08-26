// app/api/agents/linkedin-specialist/route.ts
//
// Generates a LinkedIn draft with the linkedin_specialist agent and writes an
// actions row with status awaiting_approval. LinkedIn is HUMAN_SEND_ONLY:
// there is no compliant send API, so approving a draft marks it handed off for
// a human to send from their own account. Nothing here ever sends.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { loadActiveIcp } from '@/lib/cadence/icp';
import { runAgent, statusForFailure } from '@/lib/cadence/runtime';
import { supabaseServer } from '@/lib/supabase/server';

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  leadId: z.string().uuid(),
  offer: z.string().max(2000).optional(),
  sender: z.string().max(200).optional(),
  stepNumber: z.number().int().min(1).max(20).optional(),
});

type Draft = {
  subject?: string;
  body: string;
  opening_line_rationale: string;
  personalisation_anchor: string;
  word_count: number;
};

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

    const { workspaceId, leadId, offer, sender, stepNumber } = parsed.data;

    // Ownership (RLS) and lead existence before spending an agent call.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .eq('workspace_id', workspaceId)
      .single();
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // Same as the email route: the profile supplies the standing offer, and a
    // workspace without one still gets a draft, just a more generic one.
    const icp = await loadActiveIcp(db, workspaceId);

    const run = await runAgent<Draft>(db, {
      agent: 'linkedin_specialist',
      workspaceId,
      leadId,
      extra: { offer, sender, step_number: stepNumber, icp },
    });
    if (!run.ok || !run.data) {
      return NextResponse.json(
        { error: run.error ?? 'Draft generation failed', failure: run.failure ?? null },
        { status: statusForFailure(run.failure) }
      );
    }

    const draft = run.data;

    // Straight to the approval queue. A human sends this from their own
    // account, so there is no scheduled_for and no consent basis to record:
    // the constraint is platform terms, not consent.
    const { data: action, error: insertErr } = await db
      .from('actions')
      .insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        agent: 'linkedin_specialist',
        channel: 'linkedin',
        subject: null,
        body: draft.body,
        status: 'awaiting_approval',
        step_number: stepNumber ?? null,
      })
      .select('id')
      .single();
    if (insertErr || !action) {
      return NextResponse.json(
        { error: insertErr?.message ?? 'Could not queue draft' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      data: { actionId: action.id, status: 'awaiting_approval', draft },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
