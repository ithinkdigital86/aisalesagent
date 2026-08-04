// app/api/actions/[id]/route.ts
//
// Approve, edit, or reject an action that is awaiting approval. All updates go
// through the caller's RLS client, so a user can only touch their own actions.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { supabaseServer } from '@/lib/supabase/server';

const bodySchema = z.object({
  intent: z.enum(['approve', 'reject', 'edit']),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(20000).optional(),
});

export async function PATCH(
  request: Request,
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

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { intent, subject, body } = parsed.data;

    // RLS scopes this to the caller's workspace.
    const { data: action } = await db
      .from('actions')
      .select('id, channel, status')
      .eq('id', id)
      .single();
    if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    if (action.status !== 'awaiting_approval') {
      return NextResponse.json({ error: 'Action is not awaiting approval' }, { status: 409 });
    }

    if (intent === 'edit') {
      const patch: Record<string, unknown> = {};
      if (subject !== undefined) patch.subject = subject;
      if (body !== undefined) patch.body = body;
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nothing to edit' }, { status: 400 });
      }
      const { error } = await db.from('actions').update(patch).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: { id, status: 'awaiting_approval' } });
    }

    if (intent === 'reject') {
      const { error } = await db
        .from('actions')
        .update({ status: 'blocked', block_reason: 'rejected_by_user' })
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data: { id, status: 'blocked' } });
    }

    // approve. Email goes back into the send queue; human-send channels
    // (LinkedIn, Instagram, voice) are marked sent because a person delivers them.
    const now = new Date().toISOString();
    const patch =
      action.channel === 'email'
        ? { status: 'queued' as const, scheduled_for: now }
        : { status: 'sent' as const, sent_at: now };

    const { error } = await db.from('actions').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: { id, status: patch.status } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
