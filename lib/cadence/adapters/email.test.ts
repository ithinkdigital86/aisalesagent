// lib/cadence/adapters/email.test.ts
//
// Regression for duplicate sends. The cron and the dashboard's "Process send
// queue" button select the same queued rows, and nothing marked a row taken,
// so two overlapping passes sent the same email twice. Each case here is a
// way two senders can meet on one row; each must produce one call to Resend,
// carrying the action id as its Idempotency-Key.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { FakeDb, asClient } from '../testing/fake-postgrest.ts';
import { deliverQueuedEmailAction, sendEmail, type QueuedEmailAction } from './email.ts';

const WS = 'ws-1';
const LEAD = 'lead-1';

interface ResendCall {
  idempotencyKey: string | undefined;
  to: string[];
}

let calls: ResendCall[] = [];
let onSend: (() => Promise<void>) | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  onSend = null;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body as string) as { to: string[] };
    calls.push({ idempotencyKey: headers['Idempotency-Key'], to: body.to });
    if (onSend) await onSend();
    return new Response(JSON.stringify({ id: `resend-${calls.length}` }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** One lead with a live B2B basis for email, which the gate passes. */
function world(actions: Record<string, unknown>[] = []): FakeDb {
  return new FakeDb({
    leads: [
      { id: LEAD, workspace_id: WS, email: 'lead@acme.com', phone: null, company_domain: 'acme.com', country: 'IN', stage: 'contacted' },
    ],
    workspaces: [{ id: WS, jurisdictions: ['IN'], dlt_registered: false }],
    consent_records: [
      { lead_id: LEAD, basis: 'legitimate_b2b', channels: ['email'], captured_at: new Date().toISOString(), expires_at: null, revoked_at: null },
    ],
    suppression_list: [],
    actions,
  });
}

const queued: QueuedEmailAction = {
  id: 'action-1',
  workspace_id: WS,
  lead_id: LEAD,
  subject: 'Hello',
  body: 'Body',
};

function queuedRow() {
  return { ...queued, status: 'queued', channel: 'email' };
}

test('two passes delivering the same queued row at once send it once', async () => {
  const db = world([queuedRow()]);

  const results = await Promise.all([
    deliverQueuedEmailAction(asClient(db), queued),
    deliverQueuedEmailAction(asClient(db), queued),
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(results.map((r) => r.status).sort(), ['sent', 'skipped']);
  assert.equal(db.rows('actions')[0].status, 'sent');
});

test('a pass holding a stale copy of a row already sent does not send it again', async () => {
  const db = world([queuedRow()]);

  // Both passes selected the row while it was queued; the second runs late.
  const first = await deliverQueuedEmailAction(asClient(db), queued);
  const second = await deliverQueuedEmailAction(asClient(db), queued);

  assert.equal(first.status, 'sent');
  assert.deepEqual(second, { status: 'skipped', actionId: 'action-1', reason: 'already_claimed' });
  assert.equal(calls.length, 1);
});

test('a row claimed by a pass still waiting on Resend is not sent by another', async () => {
  const db = world([queuedRow()]);
  let overlapping: Awaited<ReturnType<typeof deliverQueuedEmailAction>> | null = null;
  onSend = async () => {
    onSend = null;
    overlapping = await deliverQueuedEmailAction(asClient(db), queued);
  };

  await deliverQueuedEmailAction(asClient(db), queued);

  assert.equal(calls.length, 1);
  assert.equal(overlapping!.status, 'skipped');
});

test('the action id goes to Resend as the idempotency key', async () => {
  const db = world([queuedRow()]);
  await deliverQueuedEmailAction(asClient(db), queued);
  assert.equal(calls[0].idempotencyKey, 'action-1');
});

test('a direct send is claimed from insert, so the queue cannot pick it up mid-send', async () => {
  const db = world();
  let queuePass: Awaited<ReturnType<typeof deliverQueuedEmailAction>> | null = null;
  onSend = async () => {
    onSend = null;
    const row = db.rows('actions')[0];
    assert.equal(row.status, 'sending');
    queuePass = await deliverQueuedEmailAction(asClient(db), { ...queued, id: row.id as string });
  };

  const result = await sendEmail(asClient(db), {
    workspaceId: WS,
    leadId: LEAD,
    subject: 'Hello',
    body: 'Body',
  });

  assert.equal(result.status, 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, result.actionId);
  assert.equal(queuePass!.status, 'skipped');
});
