// app/api/agents/email-specialist/route.ts
//
// Generates an email draft with the email_specialist agent and queues it as an
// actions row. It does not send: the send-queue cron re-runs the consent gate
// and delivers. consent_basis is left null here and set at send time.

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
  sequenceId: z.string().uuid().optional(),
  stepNumber: z.number().int().min(1).max(20).optional(),
  delayHours: z.number().int().min(0).max(2160).optional().default(0),
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

    const { workspaceId, leadId, offer, sender, sequenceId, stepNumber, delayHours } = parsed.data;

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

    // The profile carries the standing offer description and who it is for.
    // A draft written without it is generic, but it is still a draft, so a
    // workspace with no active profile is not an error here.
    const icp = await loadActiveIcp(db, workspaceId);

    const run = await runAgent<Draft>(db, {
      agent: 'email_specialist',
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
    const scheduledFor = new Date(Date.now() + (delayHours ?? 0) * 3_600_000).toISOString();

    // Queue the draft. It does not send here.
    const { data: action, error: insertErr } = await db
      .from('actions')
      .insert({
        workspace_id: workspaceId,
        lead_id: leadId,
        agent: 'email_specialist',
        channel: 'email',
        subject: draft.subject ?? null,
        body: draft.body,
        status: 'queued',
        scheduled_for: scheduledFor,
        sequence_id: sequenceId ?? null,
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
      data: { actionId: action.id, status: 'queued', scheduledFor, draft },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
