// app/api/cron/follow-up/route.ts
//
// Runs every 6 hours. Reads every lead that is due, asks the Follow-up
// manager what to do, and applies the decision.
//
// Leads on a running sequence are skipped: the sequence runner owns their
// next_action_at, and two schedulers writing the same column is how a lead
// ends up with a step silently rescheduled out from under it. Once a run
// stops — a reply, an unsubscribe, the last step — sequence_stopped_reason is
// set and the lead comes back here, which is what makes a reply land with the
// manager that knows how to read one.
//
// Leads in a workspace whose kill switch is on are left out entirely and keep
// their next_action_at, so they are picked up when it is turned off. That
// includes a reply the manager would have read as an opt-out; the webhook
// suppresses those on arrival, independently of this cron.

import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase/server';
import { runAgent } from '@/lib/cadence/runtime';
import { evaluateConsent, type Channel } from '@/lib/cadence/consent';
import { inList, pausedWorkspaceIds } from '@/lib/cadence/send-controls';
import { blockPendingActions, writeSuppression } from '@/lib/cadence/suppression';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

  let paused: string[];
  try {
    paused = await pausedWorkspaceIds(db);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }

  let query = db
    .from('leads')
    .select('id, workspace_id')
    .lte('next_action_at', new Date().toISOString())
    .in('stage', ['contacted', 'engaged'])
    .or('assigned_sequence_id.is.null,sequence_stopped_reason.not.is.null')
    .limit(100);
  if (paused.length > 0) query = query.not('workspace_id', 'in', inList(paused));
  const { data: due } = await query;

  const handled = [];
  // One failed suppression fails the run, after the other leads are handled.
  let suppressionFailed = false;

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
      handled.push({
        leadId: lead.id,
        ok: false,
        error: run.error,
        failureKind: run.failure?.kind ?? 'unknown',
      });
      continue;
    }

    const d = run.data;

    if (d.next_action === 'suppress') {
      try {
        await suppress(db, lead.workspace_id, lead.id);
        handled.push({ leadId: lead.id, ok: true, action: 'suppressed' });
      } catch (err) {
        suppressionFailed = true;
        handled.push({
          leadId: lead.id,
          ok: false,
          action: 'suppress',
          error: err instanceof Error ? err.message : 'unknown_error',
        });
      }
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

  return NextResponse.json(
    { processed: handled.length, pausedWorkspaces: paused.length, handled },
    { status: suppressionFailed ? 500 : 200 }
  );
}

async function suppress(db: ReturnType<typeof supabaseService>, workspaceId: string, leadId: string) {
  const { data: lead } = await db
    .from('leads')
    .select('email, phone')
    .eq('id', leadId)
    .single();

  // The suppression row goes first and throws on failure. Moving the stage
  // to suppressed takes the lead out of this cron's due list, so a stage
  // written ahead of a failed upsert would never be retried.
  if (lead?.email) {
    await writeSuppression(
      db,
      {
        workspace_id: workspaceId,
        email: lead.email.toLowerCase(),
        phone: lead.phone ?? null,
        reason: 'unsubscribed',
      },
      'workspace_id,email'
    );
  } else if (lead?.phone) {
    await writeSuppression(
      db,
      { workspace_id: workspaceId, phone: lead.phone, reason: 'unsubscribed' },
      'workspace_id,phone'
    );
  }

  await db.from('leads').update({ stage: 'suppressed', next_action_at: null }).eq('id', leadId);
  await db.from('consent_records').update({ revoked_at: new Date().toISOString() }).eq('lead_id', leadId);
  await blockPendingActions(db, workspaceId, leadId);
}
