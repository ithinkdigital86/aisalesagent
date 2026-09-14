// app/api/leads/[id]/actions/route.ts
//
// Every action written for one lead, oldest first, so the whole conversation
// with a prospect can be read in one place. Read-only. The caller's RLS client
// scopes both reads to their own workspace.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { supabaseServer } from '@/lib/supabase/server';

// A lead with more history than this is a bug upstream, not a UI problem.
const MAX_ACTIONS = 200;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { data: lead } = await db
      .from('leads')
      .select('id, full_name, company_name, title, email, stage')
      .eq('id', id)
      .maybeSingle();
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const { data: actions, error } = await db
      .from('actions')
      .select(
        'id, channel, status, agent, step_number, subject, body, ai_tells, block_reason, created_at, scheduled_for, sent_at, replied_at, reply_body, reply_sentiment'
      )
      .eq('lead_id', id)
      .order('created_at', { ascending: true })
      .limit(MAX_ACTIONS);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ data: { lead, actions: actions ?? [] } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
