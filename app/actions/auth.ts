'use server';

// app/actions/auth.ts
//
// Server actions for the auth flow. Both use the request-scoped (RLS) client,
// so every write is constrained to the calling user's own rows.

import { redirect } from 'next/navigation';

import { supabaseServer } from '@/lib/supabase/server';

function workspaceNameFor(email: string | undefined): string {
  const local = email?.split('@')[0]?.trim();
  return local ? `${local}'s workspace` : 'My workspace';
}

/**
 * Create the signed-in user's first workspace if they do not have one yet.
 * Idempotent, so it is safe to call on every sign-in. RLS forces owner_id to
 * be the caller, so this can never create a workspace for anyone else.
 */
export async function ensureWorkspace(): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'unauthenticated' };

    const { data: existing, error: readErr } = await db
      .from('workspaces')
      .select('id')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    if (existing) return { ok: true };

    const { error: insertErr } = await db
      .from('workspaces')
      .insert({ owner_id: user.id, name: workspaceNameFor(user.email) });
    if (insertErr) return { ok: false, error: insertErr.message };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

export async function signOut(): Promise<void> {
  const db = await supabaseServer();
  await db.auth.signOut();
  redirect('/login');
}
