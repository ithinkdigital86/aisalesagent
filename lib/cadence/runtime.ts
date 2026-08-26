// lib/cadence/runtime.ts
//
// One function runs every agent. Context loading is driven by the agent's
// declared `reads` scope, so an agent can never see more of the brain than
// it asked for.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Tables } from '@/types/database';
import { AGENTS, type AgentSlug, type ContextScope } from './registry';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface RunResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  runId?: string;
}

/**
 * The slice of the shared brain assembled for an agent, typed to the schema.
 * Each field is a projection of the exact columns loadContext selects, so an
 * agent only ever sees the shape it declared in its `reads` scope.
 */
export interface AgentContext {
  lead?: Pick<
    Tables<'leads'>,
    | 'id'
    | 'full_name'
    | 'title'
    | 'seniority'
    | 'company_name'
    | 'company_domain'
    | 'employee_count'
    | 'industry'
    | 'country'
    | 'timezone'
    | 'stage'
    | 'fit_score'
    | 'fit_reasoning'
  > | null;
  triggers?: Pick<Tables<'lead_triggers'>, 'trigger_type' | 'headline' | 'detected_at'>[];
  consent?: Pick<
    Tables<'consent_records'>,
    'basis' | 'channels' | 'captured_at' | 'expires_at'
  >[];
  history?: Pick<
    Tables<'actions'>,
    | 'agent'
    | 'channel'
    | 'step_number'
    | 'subject'
    | 'body'
    | 'status'
    | 'sent_at'
    | 'opened_at'
    | 'replied_at'
    | 'reply_body'
    | 'reply_sentiment'
  >[];
  sequence?: Pick<Tables<'sequences'>, 'name' | 'steps' | 'reply_count' | 'sent_count'> | null;
  memory?: Pick<
    Tables<'agent_memory'>,
    'agent' | 'memory_type' | 'content' | 'success_rate' | 'sample_size' | 'confidence'
  >[];
  pipeline?: { byStage: Record<string, number>; total: number };
}

export async function runAgent<T = unknown>(
  db: SupabaseClient<Database>,
  opts: {
    agent: AgentSlug;
    workspaceId: string;
    leadId?: string;
    extra?: Record<string, unknown>;
  }
): Promise<RunResult<T>> {
  const def = AGENTS[opts.agent];
  const started = Date.now();

  try {
    const context = await loadContext(db, def.reads, opts);
    const { system, user } = def.buildPrompt({ ...context, ...opts.extra });

    const response = await anthropic.messages.create({
      model: def.model,
      max_tokens: def.maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const parsed = def.outputSchema.safeParse(JSON.parse(stripFences(text)));

    if (!parsed.success) {
      await logRun(db, {
        ...opts,
        model: def.model,
        response,
        started,
        ok: false,
        error: `schema_mismatch: ${parsed.error.message}`,
      });
      return { ok: false, error: 'Agent returned an unexpected shape' };
    }

    const runId = await logRun(db, {
      ...opts,
      model: def.model,
      response,
      started,
      ok: true,
      output: parsed.data,
    });

    return { ok: true, data: parsed.data as T, runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    await logRun(db, {
      ...opts,
      model: def.model,
      started,
      ok: false,
      error: message,
    });
    return { ok: false, error: message };
  }
}

/** Models sometimes wrap JSON in markdown fences despite instructions. */
function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

async function loadContext(
  db: SupabaseClient<Database>,
  scopes: ContextScope[],
  opts: { workspaceId: string; leadId?: string }
): Promise<AgentContext> {
  const ctx: AgentContext = {};
  const { workspaceId, leadId } = opts;

  if (scopes.includes('lead') && leadId) {
    const { data } = await db
      .from('leads')
      .select(
        'id, full_name, title, seniority, company_name, company_domain, employee_count, industry, country, timezone, stage, fit_score, fit_reasoning'
      )
      .eq('id', leadId)
      .eq('workspace_id', workspaceId)
      .single();
    ctx.lead = data;
  }

  if (scopes.includes('lead_triggers') && leadId) {
    const { data } = await db
      .from('lead_triggers')
      .select('trigger_type, headline, detected_at')
      .eq('lead_id', leadId)
      .or(`decays_at.is.null,decays_at.gt.${new Date().toISOString()}`)
      .order('detected_at', { ascending: false })
      .limit(5);
    ctx.triggers = data ?? [];
  }

  if (scopes.includes('consent') && leadId) {
    const { data } = await db
      .from('consent_records')
      .select('basis, channels, captured_at, expires_at')
      .eq('lead_id', leadId)
      .is('revoked_at', null);
    ctx.consent = data ?? [];
  }

  if (scopes.includes('action_history') && leadId) {
    const { data } = await db
      .from('actions')
      .select(
        'agent, channel, step_number, subject, body, status, sent_at, opened_at, replied_at, reply_body, reply_sentiment'
      )
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(20);
    ctx.history = data ?? [];
  }

  if (scopes.includes('sequence') && leadId) {
    const { data: lead } = await db
      .from('leads')
      .select('assigned_sequence_id')
      .eq('id', leadId)
      .single();
    if (lead?.assigned_sequence_id) {
      const { data } = await db
        .from('sequences')
        .select('name, steps, reply_count, sent_count')
        .eq('id', lead.assigned_sequence_id)
        .single();
      ctx.sequence = data;
    }
  }

  if (scopes.includes('agent_memory')) {
    const { data } = await db
      .from('agent_memory')
      .select('agent, memory_type, content, success_rate, sample_size, confidence')
      .eq('workspace_id', workspaceId)
      .is('retired_at', null)
      // Only surface lessons with enough evidence to trust.
      .gte('sample_size', 20)
      .order('confidence', { ascending: false })
      .limit(15);
    ctx.memory = data ?? [];
  }

  if (scopes.includes('pipeline_summary')) {
    const { data } = await db
      .from('leads')
      .select('stage, fit_score')
      .eq('workspace_id', workspaceId);
    const byStage: Record<string, number> = {};
    for (const row of data ?? []) byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
    ctx.pipeline = { byStage, total: data?.length ?? 0 };
  }

  return ctx;
}

async function logRun(
  db: SupabaseClient<Database>,
  a: {
    agent: AgentSlug;
    workspaceId: string;
    leadId?: string;
    model: string;
    started: number;
    ok: boolean;
    response?: Anthropic.Message;
    output?: unknown;
    error?: string;
  }
): Promise<string | undefined> {
  const { data } = await db
    .from('agent_runs')
    .insert({
      workspace_id: a.workspaceId,
      agent: a.agent,
      lead_id: a.leadId ?? null,
      model: a.model,
      input_tokens: a.response?.usage.input_tokens ?? 0,
      output_tokens: a.response?.usage.output_tokens ?? 0,
      duration_ms: Date.now() - a.started,
      ok: a.ok,
      error: a.error ?? null,
      raw_output: (a.output ?? null) as Json,
    })
    .select('id')
    .single();
  return data?.id;
}
