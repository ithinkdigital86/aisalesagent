// app/api/cron/send-queue/route.ts
//
// Runs frequently. Picks up queued email actions whose scheduled_for has
// passed, re-runs the consent gate on each, sends, and updates the row.

import { NextResponse } from 'next/server';

import { deliverQueuedEmailAction } from '@/lib/cadence/adapters/email';
import { supabaseService } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

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

  return NextResponse.json({ processed: handled.length, handled });
}
