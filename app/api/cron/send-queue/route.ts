// app/api/cron/send-queue/route.ts
//
// Runs frequently. Two passes, in this order:
//
//  1. Sequences. Every lead whose next step is due gets that step drafted and
//     queued, or its run stopped. This goes first so a step queued now is
//     delivered by the pass below on the same tick rather than the next one.
//
//  2. Delivery. Queued email actions whose scheduled_for has passed: the
//     consent gate is re-run on each, then it sends, then the row is updated.

import { NextResponse } from 'next/server';

import { deliverQueuedEmailAction } from '@/lib/cadence/adapters/email';
import { runDueSequenceSteps } from '@/lib/cadence/sequence-runner';
import { supabaseService } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

  const sequences = await runDueSequenceSteps(db);

  const { data: due } = await db
    .from('actions')
    .select('id, workspace_id, lead_id, subject, body')
    .eq('status', 'queued')
    .eq('channel', 'email')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50);

  const handled = [];
  for (const action of due ?? []) {
    const result = await deliverQueuedEmailAction(db, action);
    handled.push({ id: action.id, status: result.status });
  }

  return NextResponse.json({ sequences, processed: handled.length, handled });
}
