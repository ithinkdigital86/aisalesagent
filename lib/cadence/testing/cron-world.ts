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

/** A one-step email sequence that queues without approval. */
export function addSequence(db: FakeDb, workspaceId: string, id: string): void {
  db.rows('sequences').push({
    id,
    workspace_id: workspaceId,
    name: 'Intro',
    steps: [{ channel: 'email', delay_days: 0, requires_approval: false }],
    active: true,
    sent_count: 0,
    reply_count: 0,
  });
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
