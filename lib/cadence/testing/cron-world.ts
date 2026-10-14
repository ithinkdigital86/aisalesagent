// lib/cadence/testing/cron-world.ts
//
// Fixtures for the cron route tests: a FakeDb laid out the way the three
// crons read it, the request Vercel sends, and a stand-in for Resend. Not a
// test file itself.
//
// Every lead is created sendable (an Indian work address with a B2B consent
// record for email), so a test only states what makes its case different.

import { FakeDb } from './fake-postgrest.ts';

export const SECRET = 'cron-test-secret';

const HOUR = 3_600_000;

export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

/** The request a scheduled call makes, or one with the given header. */
export function cronRequest(authorization: string | null = `Bearer ${SECRET}`): Request {
  const headers = new Headers();
  if (authorization !== null) headers.set('authorization', authorization);
  return new Request('http://localhost/api/cron', { headers });
}

export function cronDb(): FakeDb {
  const db = new FakeDb({
    workspaces: [],
    leads: [],
    consent_records: [],
    suppression_list: [],
    actions: [],
    sequences: [],
    icp_profiles: [],
  });
  // The nullable columns the runner and the stop check read, which an
  // insert leaves null rather than absent.
  db.defaults.actions = {
    sent_at: null,
    replied_at: null,
    block_reason: null,
    provider_message_id: null,
    retry_of: null,
  };
  // The arbiters writeSuppression names (migration 0009).
  db.indexes.suppression_list = [
    { name: 'suppression_list_workspace_email_key', columns: ['workspace_id', 'email'], where: null },
    { name: 'suppression_list_workspace_phone_key', columns: ['workspace_id', 'phone'], where: null },
  ];
  return db;
}

export interface WorkspaceSpec {
  paused?: boolean;
  cap?: number;
  minFit?: number;
}

export function addWorkspace(db: FakeDb, id: string, spec: WorkspaceSpec = {}): void {
  db.rows('workspaces').push({
    id,
    jurisdictions: ['IN'],
    dlt_registered: false,
    sending_paused: spec.paused ?? false,
    sending_paused_at: spec.paused ? hoursFromNow(-1) : null,
    daily_send_cap: spec.cap ?? 50,
    min_fit_score: spec.minFit ?? 60,
  });
}

export interface LeadSpec {
  stage?: string;
  /** null for a lead never scored. */
  fit?: number | null;
  /** Defaults to an hour ago, so the lead is due. */
  nextActionAt?: string | null;
  sequenceId?: string | null;
  sequenceStep?: number;
  stoppedReason?: string | null;
}

export function addLead(db: FakeDb, workspaceId: string, id: string, spec: LeadSpec = {}): void {
  db.rows('leads').push({
    id,
    workspace_id: workspaceId,
    email: `${id}@acme.in`,
    phone: null,
    company_domain: 'acme.in',
    country: 'IN',
    stage: spec.stage ?? 'contacted',
    fit_score: spec.fit === undefined ? 80 : spec.fit,
    next_action_at: spec.nextActionAt === undefined ? hoursFromNow(-1) : spec.nextActionAt,
    assigned_sequence_id: spec.sequenceId ?? null,
    sequence_step: spec.sequenceStep ?? 0,
    sequence_stopped_reason: spec.stoppedReason ?? null,
  });
  db.rows('consent_records').push({
    lead_id: id,
    basis: 'legitimate_b2b',
    channels: ['email'],
    captured_at: hoursFromNow(-240),
    expires_at: null,
    revoked_at: null,
  });
}

export interface StepSpec {
  channel?: string;
  delay_days?: number;
  requires_approval?: boolean;
}

/**
 * An email sequence that queues without approval: one step by default, or
 * the steps given, numbered in order.
 */
export function addSequence(
  db: FakeDb,
  workspaceId: string,
  id: string,
  steps: StepSpec[] = [{ delay_days: 0 }]
): void {
  db.rows('sequences').push({
    id,
    workspace_id: workspaceId,
    name: 'Intro',
    steps: steps.map((step, index) => ({
      step: index + 1,
      channel: step.channel ?? 'email',
      delay_days: step.delay_days ?? 0,
      requires_approval: step.requires_approval ?? false,
    })),
    active: true,
    sent_count: 0,
    reply_count: 0,
  });
}

export interface StepActionSpec {
  status: string;
  /** How long ago the row was written, in hours. */
  createdHoursAgo?: number;
  /** How long ago it was sent, in hours; only for a sent row. */
  sentHoursAgo?: number;
  blockReason?: string | null;
  body?: string;
  /** The action this one retries. */
  retryOf?: string | null;
}

/** An action a sequence step already wrote for a lead. Returns its id. */
export function addStepAction(
  db: FakeDb,
  workspaceId: string,
  leadId: string,
  sequenceId: string,
  step: number,
  spec: StepActionSpec
): string {
  const id = db.id();
  const created = hoursFromNow(-(spec.createdHoursAgo ?? 1));
  db.rows('actions').push({
    id,
    workspace_id: workspaceId,
    lead_id: leadId,
    agent: 'email_specialist',
    channel: 'email',
    status: spec.status,
    subject: `Step ${step}`,
    body: spec.body ?? `Step ${step} body`,
    ai_tells: null,
    block_reason: spec.blockReason ?? null,
    scheduled_for: created,
    created_at: created,
    updated_at: spec.sentHoursAgo !== undefined ? hoursFromNow(-spec.sentHoursAgo) : created,
    sent_at: spec.sentHoursAgo !== undefined ? hoursFromNow(-spec.sentHoursAgo) : null,
    replied_at: null,
    retry_of: spec.retryOf ?? null,
    sequence_id: sequenceId,
    step_number: step,
  });
  return id;
}

/** Queued email actions for a lead, all due, oldest first. */
export function queueEmails(db: FakeDb, workspaceId: string, leadId: string, count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const id = `${leadId}-q-${index}`;
    ids.push(id);
    db.rows('actions').push({
      id,
      workspace_id: workspaceId,
      lead_id: leadId,
      channel: 'email',
      status: 'queued',
      subject: 'Hello',
      body: 'Body',
      scheduled_for: hoursFromNow(-10 + index * 0.1),
    });
  }
  return ids;
}

/** Emails already sent this many hours ago, which count against the cap. */
export function addSent(db: FakeDb, workspaceId: string, leadId: string, hoursAgo: number[]): void {
  for (const [index, hours] of hoursAgo.entries()) {
    db.rows('actions').push({
      id: `${leadId}-sent-${index}`,
      workspace_id: workspaceId,
      lead_id: leadId,
      channel: 'email',
      status: 'sent',
      sent_at: hoursFromNow(-hours),
      updated_at: hoursFromNow(-hours),
    });
  }
}

export const statusOf = (db: FakeDb, actionId: string) =>
  db.rows('actions').find((row) => row.id === actionId)?.status;

export const leadOf = (db: FakeDb, leadId: string) => db.rows('leads').find((row) => row.id === leadId)!;

// ---------------------------------------------------------------
// The network
// ---------------------------------------------------------------

export interface ResendStub {
  /** Idempotency keys (action ids) of every email Resend was asked to send. */
  sent: string[];
  restore(): void;
}

/**
 * Replace fetch for the length of a test. Resend answers 200, or 500 for an
 * action id `fail` picks out. Any other host throws, so a test that would
 * reach Anthropic, OpenAI or anything else fails rather than calling it.
 */
export function stubNetwork(fail: (actionId: string) => boolean = () => false): ResendStub {
  const real = globalThis.fetch;
  const stub: ResendStub = { sent: [], restore: () => (globalThis.fetch = real) };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.resend.com/')) {
      throw new Error(`unexpected network call in a cron test: ${url}`);
    }
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
    if (fail(key)) return new Response('upstream error', { status: 500 });
    stub.sent.push(key);
    return new Response(JSON.stringify({ id: `resend-${key}` }), { status: 200 });
  }) as typeof fetch;

  return stub;
}
