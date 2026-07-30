// app/api/cron/follow-up/route.ts
//
// Runs every 6 hours. Reads every lead that is due, asks the Follow-up
// manager what to do, and applies the decision.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase/server';
import { runAgent } from '@/lib/cadence/runtime';
import { evaluateConsent, type Channel } from '@/lib/cadence/consent';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

  const { data: due } = await db
    .from('leads')
    .select('id, workspace_id')
    .lte('next_action_at', new Date().toISOString())
    .in('stage', ['contacted', 'engaged'])
    .limit(100);

  const handled = [];

  for (const lead of due ?? []) {
    const run = await runAgent<{
      next_action: string;
      next_channel: string;
      wait_hours: number;
      new_stage: string;
      sentiment: string;
    }>(db, {
      agent: 'follow_up',
      workspaceId: lead.workspace_id,
      leadId: lead.id,
    });

    if (!run.ok || !run.data) {
      handled.push({ leadId: lead.id, ok: false, error: run.error });
      continue;
    }

    const d = run.data;

    if (d.next_action === 'suppress') {
      await suppress(db, lead.workspace_id, lead.id);
      handled.push({ leadId: lead.id, ok: true, action: 'suppressed' });
      continue;
    }

    // The agent proposed a channel. The gate decides if it is allowed.
    let channelOk = true;
    if (d.next_channel !== 'none' && d.next_action !== 'wait') {
      const verdict = await evaluateConsent(db, {
        workspaceId: lead.workspace_id,
        leadId: lead.id,
        channel: d.next_channel as Channel,
      });
      channelOk = verdict.allowed;
    }

    await db
      .from('leads')
      .update({
        stage: d.new_stage,
        next_action_at: new Date(
          Date.now() + Math.max(d.wait_hours, channelOk ? 0 : 168) * 3_600_000
        ).toISOString(),
      })
      .eq('id', lead.id);

    handled.push({
      leadId: lead.id,
      ok: true,
      action: d.next_action,
      channelBlocked: !channelOk,
    });
  }

  return NextResponse.json({ processed: handled.length, handled });
}

async function suppress(db: ReturnType<typeof supabaseService>, workspaceId: string, leadId: string) {
  const { data: lead } = await db
    .from('leads')
    .select('email, phone')
    .eq('id', leadId)
    .single();

  await db.from('leads').update({ stage: 'suppressed', next_action_at: null }).eq('id', leadId);
  await db.from('consent_records').update({ revoked_at: new Date().toISOString() }).eq('lead_id', leadId);

  if (lead?.email || lead?.phone) {
    await db.from('suppression_list').upsert(
      {
        workspace_id: workspaceId,
        email: lead.email?.toLowerCase() ?? null,
        phone: lead.phone ?? null,
        reason: 'unsubscribed',
      },
      { onConflict: 'workspace_id,email', ignoreDuplicates: true }
    );
  }
}
