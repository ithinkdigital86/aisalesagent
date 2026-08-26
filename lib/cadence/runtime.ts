// lib/cadence/runtime.ts
//
// One function runs every agent. Context loading is driven by the agent's
// declared `reads` scope, so an agent can never see more of the brain than
// it asked for.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { Database, Json, Tables } from '@/types/database';
import { describeIssues } from '@/lib/anthropic/schema';
import { AGENTS, type AgentSlug, type ContextScope } from './registry';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** One corrective retry. Past that the prompt is wrong, not the sampling. */
const MAX_ATTEMPTS = 2;

export type RunFailureKind =
  /** The model did not return parseable JSON. */
  | 'invalid_json'
  /** Valid JSON, but an essential field was missing or unusable. */
  | 'schema_mismatch'
  /** The Anthropic call itself failed: rate limit, overload, bad key. */
  | 'api_error'
  /** Anything else, usually a database read while assembling context. */
  | 'unknown';

/**
 * Why a run failed, in enough detail for the caller to show a human something
 * actionable. `detail` names the offending field and rule, so it is safe to
 * surface in the UI.
 */
export interface RunFailure {
  kind: RunFailureKind;
  detail: string;
  /** How many model calls were spent before giving up. */
  attempts: number;
  /** The start of what the model actually returned, when we got that far. */
  rawSample?: string;
}

export interface RunResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** Human-readable one-liner. Always set when ok is false. */
  error?: string;
  failure?: RunFailure;
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
  const begun = Date.now();
  let spent = 0;

  try {
    const context = await loadContext(db, def.reads, opts);
    const { system, user } = def.buildPrompt({ ...context, ...opts.extra });

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
    let failure: RunFailure | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      spent = attempt;
      const response = await anthropic.messages.create({
        model: def.model,
        max_tokens: def.maxTokens,
        system,
        messages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      const outcome = parseOutput(def.outputSchema, text);

      if (outcome.ok) {
        const runId = await logRun(db, {
          ...opts,
          model: def.model,
          response,
          started,
          ok: true,
          output: outcome.data,
        });
        return { ok: true, data: outcome.data as T, runId };
      }

      failure = {
        kind: outcome.kind,
        detail: outcome.detail,
        attempts: attempt,
        rawSample: text.slice(0, 500),
      };

      // Log every call, including the wasted ones. Cost is cost, and a run of
      // schema_mismatch rows is the signal that a prompt needs fixing.
      await logRun(db, {
        ...opts,
        model: def.model,
        response,
        started,
        ok: false,
        error: `attempt ${attempt}/${MAX_ATTEMPTS} ${outcome.kind}: ${outcome.detail}`,
        rawText: text,
      });

      if (attempt === MAX_ATTEMPTS) break;

      // Show the model its own output and the exact complaint. Correcting one
      // field is much cheaper than regenerating the whole answer blind.
      messages.push(
        { role: 'assistant', content: text.trim() || '(empty response)' },
        { role: 'user', content: correctionFor(outcome) }
      );
    }

    return {
      ok: false,
      error: `Agent output rejected after ${failure?.attempts ?? MAX_ATTEMPTS} attempts. ${failure?.detail ?? 'no detail'}`,
      failure,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    const kind: RunFailureKind = err instanceof Anthropic.APIError ? 'api_error' : 'unknown';
    await logRun(db, {
      ...opts,
      model: def.model,
      started: begun,
      ok: false,
      error: `${kind}: ${message}`,
    });
    return {
      ok: false,
      error: message,
      failure: { kind, detail: message, attempts: Math.max(spent, 1) },
    };
  }
}

/**
 * HTTP status for a failed run. A model that returns the wrong shape is not a
 * bad gateway: 502 sent callers hunting for an outage that was not there.
 */
export function statusForFailure(failure?: RunFailure): number {
  switch (failure?.kind) {
    case 'invalid_json':
    case 'schema_mismatch':
      return 422;
    case 'api_error':
      return 502;
    default:
      return 500;
  }
}

type ParseOutcome =
  | { ok: true; data: unknown }
  | { ok: false; kind: 'invalid_json' | 'schema_mismatch'; detail: string };

function parseOutput(schema: z.ZodTypeAny, text: string): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch (err) {
    return {
      ok: false,
      kind: 'invalid_json',
      detail: err instanceof Error ? err.message : 'response was not valid JSON',
    };
  }

  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, kind: 'schema_mismatch', detail: describeIssues(parsed.error) };
}

function correctionFor(outcome: Extract<ParseOutcome, { ok: false }>): string {
  const complaint =
    outcome.kind === 'invalid_json'
      ? `Your last response could not be parsed as JSON: ${outcome.detail}`
      : `Your last response was valid JSON but failed validation: ${outcome.detail}`;

  return `${complaint}

Send the same answer again as a single JSON object, correcting only what the error above names. Do not add prose, an explanation, or markdown fences. Respect every character limit stated in your instructions: shorten the field rather than dropping it.`;
}

/**
 * Models wrap JSON in markdown fences or a sentence of preamble despite
 * instructions. Strip the fences, and if that still is not parseable, fall
 * back to the outermost braces before spending another call.
 */
function extractJson(text: string): string {
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    const first = stripped.indexOf('{');
    const last = stripped.lastIndexOf('}');
    return first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
  }
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
    /** Raw model text, kept on failures so a bad run is debuggable later. */
    rawText?: string;
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
      raw_output: (a.output ?? a.rawText ?? null) as Json,
    })
    .select('id')
    .single();
  return data?.id;
}
