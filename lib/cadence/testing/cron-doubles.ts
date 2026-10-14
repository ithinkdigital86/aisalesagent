// lib/cadence/testing/cron-doubles.ts
//
// Stands in for the two modules a cron route cannot run without reaching the
// outside world: lib/supabase/server (a real database) and lib/cadence/runtime
// (Anthropic and OpenAI). The cron tests swap both for this file through
// registerRouteLoader(), so the routes, the send queue, the sequence runner,
// the consent gate and the email adapter all run for real against a FakeDb,
// and only the model call is scripted. Not a test file itself.

import type { SupabaseClient } from '@supabase/supabase-js';

import { asClient, type FakeDb } from './fake-postgrest.ts';

/** The subset of runAgent's options the doubles see. */
export interface AgentCall {
  agent: string;
  workspaceId: string;
  leadId?: string;
  extra?: Record<string, unknown>;
}

/** The subset of RunResult the routes read. */
export interface AgentResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  failure?: { kind: string; detail: string; attempts: number };
  salvage?: { detail: string; attempts: number };
  tells?: unknown[];
}

type AgentScript = (call: AgentCall) => AgentResult | Promise<AgentResult>;

let db: FakeDb | null = null;
let script: AgentScript = () => ({ ok: false, error: 'no agent script set' });

/** Every runAgent call since the last reset, in order. */
export const agentCalls: AgentCall[] = [];

export function useDb(next: FakeDb): void {
  db = next;
}

export function scriptAgents(next: AgentScript): void {
  script = next;
}

export function resetDoubles(): void {
  db = null;
  script = () => ({ ok: false, error: 'no agent script set' });
  agentCalls.length = 0;
}

// --- lib/supabase/server ---

export function supabaseService(): SupabaseClient {
  if (!db) throw new Error('cron-doubles: useDb() was not called');
  return asClient(db);
}

// --- lib/cadence/runtime ---

export async function runAgent(_db: unknown, opts: AgentCall): Promise<AgentResult> {
  agentCalls.push(opts);
  return script(opts);
}

/** This file, for registerRouteLoader() to swap the two modules for. */
export const DOUBLES_URL = import.meta.url;

/** Both swaps every cron test makes. */
export const CRON_DOUBLES = {
  '@/lib/supabase/server': DOUBLES_URL,
  '@/lib/cadence/runtime': DOUBLES_URL,
};
