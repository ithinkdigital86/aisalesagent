// lib/cadence/testing/action-doubles.ts
//
// Stands in for what a server action cannot run without inside Next:
// lib/supabase/server (a request-scoped client with a signed-in user) and
// next/cache (revalidatePath throws outside a request). Tests swap both for
// this file through registerRouteLoader(ACTION_DOUBLES). Not a test file
// itself.

import type { SupabaseClient } from '@supabase/supabase-js';

import { asClient, type FakeDb } from './fake-postgrest.ts';

let db: FakeDb | null = null;
let userId: string | null = null;

/** Every path revalidated since the last reset. */
export const revalidated: string[] = [];

/** The database the action reads, and who is signed in (null for nobody). */
export function useActionDb(next: FakeDb, user: string | null = 'user-1'): void {
  db = next;
  userId = user;
}

export function resetActionDoubles(): void {
  db = null;
  userId = null;
  revalidated.length = 0;
}

// --- lib/supabase/server ---

export async function supabaseServer(): Promise<SupabaseClient> {
  if (!db) throw new Error('action-doubles: useActionDb() was not called');
  const client = asClient(db) as unknown as Record<string, unknown>;
  client.auth = {
    getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
  };
  return client as unknown as SupabaseClient;
}

// --- next/cache ---

export function revalidatePath(path: string): void {
  revalidated.push(path);
}

/** Both swaps a server action test makes. */
export const ACTION_DOUBLES = {
  '@/lib/supabase/server': import.meta.url,
  'next/cache': import.meta.url,
};
