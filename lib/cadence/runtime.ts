// lib/cadence/runtime.ts
//
// One function runs every agent. Context loading is driven by the agent's
// declared `reads` scope, so an agent can never see more of the brain than
// it asked for.
//
// Two providers, one runtime. The only thing that branches on the provider is
// callModel below: the same context, the same JSON parse, the same schema
// validation, the same output review, the same corrective retry and the same
// agent_runs row apply whichever API answered. Keep it that way. Anything that is not literally a
// difference in the HTTP call does not belong behind that branch.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { Database, Json, Tables } from '@/types/database';
import { describeIssues } from '@/lib/anthropic/schema';
import {
  AGENTS,
  type AgentDefinition,
  type AgentSlug,
  type AiTell,
  type ContextScope,
} from './registry';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/**
 * One corrective retry, shared between the schema and the review. Past that
 * the prompt is wrong, not the sampling.
 */
const MAX_ATTEMPTS = 2;

export type RunFailureKind =
  /** The model did not return parseable JSON. */
  | 'invalid_json'
  /** Valid JSON, but an essential field was missing or unusable. */
  | 'schema_mismatch'
  /** The provider call itself failed: rate limit, overload, bad key. */
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
  /**
   * Set when the answer only parsed after the unusable parts were dropped. The
   * data is usable, but something the model produced is not in it, and the
   * schema records what inside `data` so a human reading the output sees it.
   */
  salvage?: { detail: string; attempts: number };
  /**
   * What the agent's reviewOutput found in the draft that was returned. An
   * empty array means the copy was checked and is clean. Absent means the
   * agent declares no review, which is not the same thing, and callers that
   * persist this should keep the distinction rather than defaulting to [].
   */
  tells?: AiTell[];
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

    const messages: ChatMessage[] = [{ role: 'user', content: user }];
    let failure: RunFailure | undefined;
    /** The last thing the model said, kept for the salvage parse below. */
    let lastText = '';
    /**
     * A draft that passed the schema but not the review, held back while the
     * retry runs. It is what ships if the retry does worse: a message with a
     * written-out "it is" beats no message, and the tells travel with it.
     */
    let flawed: { data: unknown; tells: AiTell[]; attempt: number } | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const started = Date.now();
      spent = attempt;
      const { text, usage } = await callModel(def, system, messages);
      lastText = text;

      const outcome = parseOutput(def.outputSchema, text);

      if (outcome.ok) {
        // The schema says the shape is right. The review, where the agent
        // declares one, says whether the copy is. undefined here means "not
        // reviewed", which is logged as such rather than as zero tells.
        const tells = def.reviewOutput?.(outcome.data);

        if (!tells || tells.length === 0 || attempt === MAX_ATTEMPTS) {
          const runId = await logRun(db, {
            ...opts,
            model: def.model,
            usage,
            started,
            ok: true,
            output: outcome.data,
            tellCount: tells?.length ?? null,
            error: tells?.length
              ? `kept with ${countTells(tells)} after ${attempt} attempts: ${describeTells(tells)}`
              : undefined,
          });
          return { ok: true, data: outcome.data as T, runId, tells };
        }

        // Valid but marked. Same treatment as a schema failure: the row is
        // logged so a run of them shows the prompt needs work, and the model
        // is shown exactly what it wrote and which rule it broke.
        flawed = { data: outcome.data, tells, attempt };
        await logRun(db, {
          ...opts,
          model: def.model,
          usage,
          started,
          ok: false,
          output: outcome.data,
          tellCount: tells.length,
          error: `attempt ${attempt}/${MAX_ATTEMPTS} style_tells: ${describeTells(tells)}`,
        });
        messages.push(
          { role: 'assistant', content: text.trim() },
          { role: 'user', content: correctionForTells(tells) }
        );
        continue;
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
        usage,
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

    // The retry was asked to fix the copy and broke the JSON instead. The
    // draft it was fixing is still good, so that is what goes out, tells and
    // all. No model call is made here, so the row logs zero tokens; the failed
    // retry is already on the record above.
    if (flawed) {
      const runId = await logRun(db, {
        ...opts,
        model: def.model,
        started: Date.now(),
        ok: true,
        output: flawed.data,
        tellCount: flawed.tells.length,
        error: `kept attempt ${flawed.attempt} with ${countTells(flawed.tells)}, retry ${failure?.kind ?? 'failed'}: ${failure?.detail ?? 'no detail'}`,
      });
      return { ok: true, data: flawed.data as T, runId, tells: flawed.tells };
    }

    // Every retry is spent. If the agent declared a salvage schema, parse once
    // more with the unusable parts dropped: a review missing one instruction is
    // worth more to the person waiting for it than a 422. No model call is made
    // here, so the row logs zero tokens, and the failed attempts above are
    // already on the record as the signal that the prompt needs work.
    if (def.salvageSchema && lastText.trim() !== '') {
      const salvaged = parseOutput(def.salvageSchema, lastText);
      if (salvaged.ok) {
        const detail = failure?.detail ?? 'no detail';
        const attempts = failure?.attempts ?? MAX_ATTEMPTS;
        // No retry is left to spend on these, but they are still recorded.
        const tells = def.reviewOutput?.(salvaged.data);
        const runId = await logRun(db, {
          ...opts,
          model: def.model,
          started: Date.now(),
          ok: true,
          output: salvaged.data,
          tellCount: tells?.length ?? null,
          error: `salvaged after ${attempts} attempts: ${detail}`,
        });
        return {
          ok: true,
          data: salvaged.data as T,
          runId,
          salvage: { detail, attempts },
          tells,
        };
      }
    }

    return {
      ok: false,
      error: `Agent output rejected after ${failure?.attempts ?? MAX_ATTEMPTS} attempts. ${failure?.detail ?? 'no detail'}`,
      failure,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    const kind: RunFailureKind =
      err instanceof Anthropic.APIError || err instanceof OpenAiApiError ? 'api_error' : 'unknown';
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

// ---------------------------------------------------------------
// The provider call
// ---------------------------------------------------------------

/** One turn of the conversation, in the shape both providers understand. */
type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Token counts, named the same way whichever provider reported them. */
export interface TokenUsage {
  input: number;
  output: number;
}

interface ModelReply {
  /** The response text. Never null, but it can legitimately be empty. */
  text: string;
  usage: TokenUsage;
}

/**
 * Any non-2xx from OpenAI, plus the missing-key case. It exists so the catch in
 * runAgent can classify an OpenAI failure as api_error the same way it
 * classifies Anthropic.APIError, rather than logging it as unknown.
 */
export class OpenAiApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OpenAiApiError';
    this.status = status;
  }
}

/**
 * The one place the provider matters. Both branches take the same arguments and
 * return the same shape, so nothing downstream of here knows which API answered.
 */
async function callModel(
  def: AgentDefinition,
  system: string,
  messages: ChatMessage[]
): Promise<ModelReply> {
  if (def.provider === 'openai') {
    return callOpenAi(def.model, def.maxTokens, system, messages);
  }
  return callAnthropic(def.model, def.maxTokens, system, messages);
}

async function callAnthropic(
  model: string,
  maxTokens: number,
  system: string,
  messages: ChatMessage[]
): Promise<ModelReply> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return {
    text,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';

/** Only the parts of a chat completion this runtime reads. */
interface OpenAiCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Chat completions over fetch. There is no OpenAI SDK in this project on
 * purpose: one endpoint, one shape, and the rest of the runtime already does
 * the parsing and the retrying.
 */
async function callOpenAi(
  model: string,
  maxTokens: number,
  system: string,
  messages: ChatMessage[]
): Promise<ModelReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAiApiError('OPENAI_API_KEY is not set');

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // No top-level system field here: it is the first message instead.
      messages: [{ role: 'system', content: system }, ...messages],
      // Reasoning tokens are billed and count against this cap. These agents
      // emit a small structured object, so a low effort is what keeps a 2048
      // token budget from being spent thinking and returning nothing.
      reasoning_effort: 'low',
      max_completion_tokens: maxTokens,
    }),
  });

  const payload = (await response.json().catch(() => null)) as OpenAiCompletion | null;

  if (!response.ok) {
    throw new OpenAiApiError(
      `openai ${model}: ${payload?.error?.message ?? `HTTP ${response.status}`}`,
      response.status
    );
  }

  const choice = payload?.choices?.[0];
  const text = choice?.message?.content ?? '';

  // A model that spends the whole budget before writing anything returns an
  // empty string. Reporting the cap beats an invalid_json failure on ''.
  if (text.trim() === '' && choice?.finish_reason === 'length') {
    throw new OpenAiApiError(
      `openai ${model}: hit max_completion_tokens (${maxTokens}) before writing a reply`
    );
  }

  return {
    text,
    usage: {
      input: payload?.usage?.prompt_tokens ?? 0,
      output: payload?.usage?.completion_tokens ?? 0,
    },
  };
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

function countTells(tells: AiTell[]): string {
  return `${tells.length} style tell${tells.length === 1 ? '' : 's'}`;
}

/** Tells as one quotable line, the way describeIssues does for schema errors. */
function describeTells(tells: AiTell[]): string {
  const shown = tells.slice(0, 6).map((tell) => `${tell.rule}: "${tell.found}"`);
  const extra = tells.length > shown.length ? ` (+${tells.length - shown.length} more)` : '';
  return shown.join('; ') + extra;
}

/**
 * The style complaint. Unlike a schema error, fixing one tell can create
 * another (dropping a question can leave the message with none), so the model
 * is told to rewrite and re-check the whole message, not just the quoted text.
 */
function correctionForTells(tells: AiTell[]): string {
  const list = tells.map((tell) => `- ${tell.rule}. Found: "${tell.found}"`).join('\n');

  return `Your last response was valid JSON, but the copy breaks these rules from your instructions:
${list}

Rewrite the message so none of the above appear, then check the whole message against every style constraint again before you answer, because fixing one line can break another rule. Keep the same observation, the same idea, and the same closing question. Send the corrected answer as a single JSON object with the same fields. Do not add prose, an explanation, or markdown fences.`;
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
    /** Absent when no model call was made, as on the salvage parse. */
    usage?: TokenUsage;
    output?: unknown;
    /** Raw model text, kept on failures so a bad run is debuggable later. */
    rawText?: string;
    error?: string;
    /**
     * How many style tells the draft carried. null when the agent declares no
     * review, so an unchecked run is never mistaken for a clean one.
     */
    tellCount?: number | null;
  }
): Promise<string | undefined> {
  const { data } = await db
    .from('agent_runs')
    .insert({
      workspace_id: a.workspaceId,
      agent: a.agent,
      lead_id: a.leadId ?? null,
      model: a.model,
      input_tokens: a.usage?.input ?? 0,
      output_tokens: a.usage?.output ?? 0,
      duration_ms: Date.now() - a.started,
      ok: a.ok,
      error: a.error ?? null,
      raw_output: (a.output ?? a.rawText ?? null) as Json,
      ai_tell_count: a.tellCount ?? null,
    })
    .select('id')
    .single();
  return data?.id;
}
