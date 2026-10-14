// lib/cadence/send-controls.test.ts
//
// The limits on unattended sending (migration 0011): the kill switch, the
// daily cap and the minimum fit score. Each case is one way an unwatched pass
// could send something it should not: after the switch was turned on, past
// the cap, or to a lead nobody judged worth contacting. The claim is the fake
// PostgREST's copy of claim_email_send; the live function was exercised
// against a throwaway workspace (see PROJECT_JOURNAL.md).

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { FakeDb, asClient } from './testing/fake-postgrest.ts';
import { deliverQueuedEmailAction, sendEmail } from './adapters/email.ts';
import { capResetsAt, checkFit, formatSendTime, loadSendWindow } from './send-controls.ts';
import { deliverDueEmails } from './send-queue.ts';

// Noon in India, on a clock the tests set. The adapter stamps sent_at with
// Date, and the day the cap counts starts at midnight there, so with the real
// clock a send "an hour ago" would fall yesterday when the tests ran just
// after midnight. Midnight today is 12 hours before NOW.
const NOW = new Date('2026-10-14T06:30:00.000Z');
const HOUR = 3_600_000;
const SINCE_MIDNIGHT = 12;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

let resendCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  resendCalls = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    resendCalls.push((init.headers as Record<string, string>)['Idempotency-Key']);
    return new Response(JSON.stringify({ id: `resend-${resendCalls.length}` }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

interface WorkspaceSpec {
  id: string;
  paused?: boolean;
  cap?: number;
  /** Queued, due email actions to create. */
  queued?: number;
  /** sent_at offsets, in hours ago, of emails already sent. */
  sentHoursAgo?: number[];
}

/** Workspaces each with one consented lead, and their actions. */
function world(...specs: WorkspaceSpec[]): FakeDb {
  const db = new FakeDb({ workspaces: [], leads: [], consent_records: [], suppression_list: [], actions: [] });
  db.now = () => NOW;
  for (const spec of specs) {
    const lead = `${spec.id}-lead`;
    db.rows('workspaces').push({
      id: spec.id,
      jurisdictions: ['IN'],
      dlt_registered: false,
      sending_paused: spec.paused ?? false,
      sending_paused_at: null,
      daily_send_cap: spec.cap ?? 50,
      min_fit_score: 60,
    });
    db.rows('leads').push({
      id: lead,
      workspace_id: spec.id,
      email: `${spec.id}@acme.com`,
      phone: null,
      company_domain: 'acme.com',
      country: 'IN',
      stage: 'contacted',
    });
    db.rows('consent_records').push({
      lead_id: lead,
      basis: 'legitimate_b2b',
      channels: ['email'],
      captured_at: ago(240),
      expires_at: null,
      revoked_at: null,
    });
    for (const [index, hours] of (spec.sentHoursAgo ?? []).entries()) {
      db.rows('actions').push({
        id: `${spec.id}-sent-${index}`,
        workspace_id: spec.id,
        lead_id: lead,
        channel: 'email',
        status: 'sent',
        sent_at: ago(hours),
        updated_at: ago(hours),
      });
    }
    for (let index = 0; index < (spec.queued ?? 0); index++) {
      db.rows('actions').push({
        id: `${spec.id}-q-${index}`,
        workspace_id: spec.id,
        lead_id: lead,
        channel: 'email',
        status: 'queued',
        subject: 'Hello',
        body: 'Body',
        // Oldest first, all due.
        scheduled_for: ago(10 - index * 0.1),
      });
    }
  }
  return db;
}

function action(db: FakeDb, id: string) {
  const row = db.rows('actions').find((r) => r.id === id)!;
  return {
    id,
    workspace_id: row.workspace_id as string,
    lead_id: row.lead_id as string,
    subject: row.subject as string,
    body: row.body as string,
  };
}

const statusOf = (db: FakeDb, id: string) => db.rows('actions').find((r) => r.id === id)!.status;

// ---------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------

test('a paused workspace defers a queued email and leaves it queued', async () => {
  const db = world({ id: 'ws', paused: true, queued: 1 });

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-0'));

  assert.deepEqual(result, { status: 'deferred', actionId: 'ws-q-0', reason: 'sending_paused' });
  assert.equal(statusOf(db, 'ws-q-0'), 'queued');
  assert.equal(resendCalls.length, 0);
});

test('a direct send in a paused workspace is held in the queue, not sent', async () => {
  const db = world({ id: 'ws', paused: true });

  const result = await sendEmail(asClient(db), {
    workspaceId: 'ws',
    leadId: 'ws-lead',
    subject: 'Hello',
    body: 'Body',
  });

  assert.equal(result.status, 'deferred');
  assert.equal(resendCalls.length, 0);
  assert.equal(db.rows('actions')[0].status, 'queued');
});

test('the switch turned on mid-pass stops the pass at the next row', async () => {
  const db = world({ id: 'ws', queued: 3 });
  // Flip the switch once the first email has gone out.
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    resendCalls.push((init.headers as Record<string, string>)['Idempotency-Key']);
    db.rows('workspaces')[0].sending_paused = true;
    return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 });
  }) as typeof fetch;

  const result = await deliverDueEmails(asClient(db), { now: NOW });

  assert.equal(resendCalls.length, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.deferred, 1);
  assert.deepEqual(
    result.held.map((h) => [h.reason, h.waiting]),
    [['sending_paused', 2]]
  );
  assert.equal(statusOf(db, 'ws-q-1'), 'queued');
  assert.equal(statusOf(db, 'ws-q-2'), 'queued');
});

test('a paused workspace does not hold up the queue of the others', async () => {
  const db = world({ id: 'a', paused: true, queued: 60 }, { id: 'b', queued: 2 });

  const result = await deliverDueEmails(asClient(db), { now: NOW });

  assert.equal(result.sent, 2);
  assert.deepEqual(resendCalls.sort(), ['b-q-0', 'b-q-1']);
  assert.deepEqual(result.held, [{ workspaceId: 'a', reason: 'sending_paused', retryAt: null, waiting: 60 }]);
});

// ---------------------------------------------------------------
// Daily cap
// ---------------------------------------------------------------

test('reaching the cap defers the rest of the queue instead of failing it', async () => {
  const db = world({ id: 'ws', cap: 2, queued: 5 });

  const result = await deliverDueEmails(asClient(db), { now: NOW });

  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.equal(resendCalls.length, 2);
  assert.deepEqual(
    db.rows('actions').map((r) => r.status),
    ['sent', 'sent', 'queued', 'queued', 'queued']
  );
  assert.equal(result.held[0].reason, 'daily_cap_reached');
  assert.equal(result.held[0].waiting, 3);
});

test('a row blocked at send time does not use up a slot', async () => {
  const db = world({ id: 'ws', cap: 2, queued: 3 });
  // The oldest row is for a lead who has since been suppressed.
  db.rows('leads').push({ ...db.rows('leads')[0], id: 'gone', stage: 'suppressed' });
  db.rows('actions')[0].lead_id = 'gone';

  const result = await deliverDueEmails(asClient(db), { now: NOW });

  assert.deepEqual([result.blocked, result.sent], [1, 2]);
  assert.deepEqual(resendCalls, ['ws-q-1', 'ws-q-2']);
  assert.deepEqual(result.held, []);
});

test('the claim refuses a row once the day is full', async () => {
  const db = world({ id: 'ws', cap: 3, sentHoursAgo: [1, 5, SINCE_MIDNIGHT], queued: 1 });

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-0'));

  assert.deepEqual(result, { status: 'deferred', actionId: 'ws-q-0', reason: 'daily_cap_reached' });
  assert.equal(statusOf(db, 'ws-q-0'), 'queued');
  assert.equal(resendCalls.length, 0);
});

test("yesterday's sends do not count, however recent", async () => {
  // A second before midnight, and a rolling day's worth before that.
  const db = world({ id: 'ws', cap: 2, sentHoursAgo: [1, SINCE_MIDNIGHT + 1 / 3600, 23], queued: 1 });

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-0'));

  assert.equal(result.status, 'sent');
});

test('the day starts at midnight in India, not in UTC or on the machine', async () => {
  // 05:00 UTC is 10:30 in India: one send at the day's first second there,
  // one at 23:00 UTC the evening before, which is already 04:30 today.
  mock.timers.setTime(new Date('2026-10-14T05:00:00.000Z').getTime());
  const db = world({ id: 'ws', cap: 2, queued: 1 });
  db.now = () => new Date();
  for (const [index, at] of ['2026-10-13T18:30:00.000Z', '2026-10-13T23:00:00.000Z'].entries()) {
    db.rows('actions').push({ id: `today-${index}`, workspace_id: 'ws', channel: 'email', status: 'sent', sent_at: at });
  }

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-0'));

  assert.equal(result.status, 'deferred', 'both count against today');
  const window = await loadSendWindow(asClient(db), 'ws');
  assert.deepEqual(window, { sent: 2, inFlight: 0, used: 2, resetsAt: '2026-10-14T18:30:00.000Z' });
});

test('a row claimed today and still mid-send counts against the cap', async () => {
  const db = world({ id: 'ws', cap: 1, queued: 2 });
  db.rows('actions')[0].status = 'sending';
  db.rows('actions')[0].updated_at = ago(0.1);

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-1'));

  assert.equal(result.status, 'deferred');
});

test('a row stuck in sending since yesterday stops counting at midnight, as a send would', async () => {
  const db = world({ id: 'ws', cap: 1, queued: 2 });
  db.rows('actions')[0].status = 'sending';
  db.rows('actions')[0].updated_at = ago(SINCE_MIDNIGHT + 0.5);

  const result = await deliverQueuedEmailAction(asClient(db), action(db, 'ws-q-1'));

  assert.equal(result.status, 'sent');
  assert.equal(statusOf(db, 'ws-q-0'), 'sending', 'left as it is: whether it went is unknown');
});

test('two passes at once cannot send past the cap between them', async () => {
  const db = world({ id: 'ws', cap: 3, queued: 8 });

  const [first, second] = await Promise.all([
    deliverDueEmails(asClient(db), { now: NOW }),
    deliverDueEmails(asClient(db), { now: NOW }),
  ]);

  assert.equal(resendCalls.length, 3);
  assert.equal(first.sent + second.sent, 3);
  assert.equal(db.rows('actions').filter((r) => r.status === 'sent').length, 3);
  assert.equal(db.rows('actions').filter((r) => r.status === 'queued').length, 5);
});

test('a cap of 0 sends nothing', async () => {
  const db = world({ id: 'ws', cap: 0, queued: 2 });
  const result = await deliverDueEmails(asClient(db), { now: NOW });
  assert.equal(resendCalls.length, 0);
  assert.equal(result.held[0].reason, 'daily_cap_reached');
});

test('the window reports what it counted today and when the count starts again', async () => {
  const db = world({ id: 'ws', sentHoursAgo: [2, 11, 13], queued: 1 });
  for (const [id, hours] of [['flight', 3], ['stale-flight', 14]] as const) {
    db.rows('actions').push({
      id,
      workspace_id: 'ws',
      channel: 'email',
      status: 'sending',
      sent_at: null,
      updated_at: ago(hours),
    });
  }

  const window = await loadSendWindow(asClient(db), 'ws', NOW);

  // Midnight tonight in India, 12 hours on, whatever was sent when.
  assert.deepEqual(window, { sent: 2, inFlight: 1, used: 3, resetsAt: ago(-12) });
  assert.equal(capResetsAt(NOW), ago(-12));
});

// ---------------------------------------------------------------
// Minimum fit score
// ---------------------------------------------------------------

test('an unscored lead never passes, even against a minimum of 0', () => {
  assert.equal(checkFit(null, 0).ok, false);
  assert.equal(checkFit(undefined, 0).ok, false);
  const verdict = checkFit(null, 60);
  assert.equal(verdict.ok === false && verdict.reason, 'unscored');
});

test('a score below the minimum fails and says by how much', () => {
  const verdict = checkFit(59, 60);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.reason, 'below_min_fit');
  assert.match(verdict.ok === false ? verdict.message : '', /59 is below .* minimum of 60/);
});

test('a score at or above the minimum passes', () => {
  assert.deepEqual(checkFit(60, 60), { ok: true });
  assert.deepEqual(checkFit(0, 0), { ok: true });
  assert.deepEqual(checkFit(100, 60), { ok: true });
});

// ---------------------------------------------------------------
// Display
// ---------------------------------------------------------------

test('send times render in the display zone, whatever the machine', () => {
  assert.equal(formatSendTime('2026-10-14T03:35:00.000Z'), '14 Oct 09:05');
  assert.equal(formatSendTime('2026-10-14T18:30:00.000Z'), '15 Oct 00:00');
  assert.equal(formatSendTime(null), '-');
});
