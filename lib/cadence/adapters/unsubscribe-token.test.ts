// lib/cadence/adapters/unsubscribe-token.test.ts
//
// The key unsubscribe links are signed with. They were signed with
// `CRON_SECRET ?? ''`: with the secret unset the key was empty, so anyone
// could sign a token for any address in any workspace, and rotating the cron
// secret killed every link already sitting in an inbox. Links now have their
// own UNSUBSCRIBE_SECRET, and with it unset nothing is signed, verified or sent.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

import { FakeDb, asClient } from '../testing/fake-postgrest.ts';
import {
  deliverQueuedEmailAction,
  sendEmail,
  unsubscribeToken,
  verifyUnsubscribeToken,
  type QueuedEmailAction,
} from './email.ts';

const KEY = 'unsubscribe-test-secret';
const CRON = 'cron-test-secret';
const WS = 'ws-1';
const LEAD = 'lead-1';

/** A token signed with any key, the way a forger or an older build would. */
function signWith(key: string, workspaceId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, e: email })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', key).update(payload).digest('base64url')}`;
}

/** The List-Unsubscribe header of each email posted to Resend. */
let posted: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = KEY;
  process.env.CRON_SECRET = CRON;
  posted = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { headers: Record<string, string> };
    posted.push(body.headers['List-Unsubscribe']);
    return new Response(JSON.stringify({ id: `resend-${posted.length}` }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function unsetKey(value: undefined | ''): void {
  if (value === undefined) delete process.env.UNSUBSCRIBE_SECRET;
  else process.env.UNSUBSCRIBE_SECRET = value;
}

test('a token names its workspace and the address, lowercased', () => {
  const token = unsubscribeToken(WS, 'Lead@Acme.com');
  assert.deepEqual(verifyUnsubscribeToken(token), { workspaceId: WS, email: 'lead@acme.com' });
});

test('tokens are signed with UNSUBSCRIBE_SECRET, not CRON_SECRET', () => {
  const token = unsubscribeToken(WS, 'lead@acme.com');
  assert.equal(token, signWith(KEY, WS, 'lead@acme.com'));
  assert.equal(verifyUnsubscribeToken(signWith(CRON, WS, 'lead@acme.com')), null);
});

test('rotating CRON_SECRET leaves links already sent working', () => {
  const token = unsubscribeToken(WS, 'lead@acme.com');
  process.env.CRON_SECRET = 'rotated-cron-secret';
  assert.deepEqual(verifyUnsubscribeToken(token), { workspaceId: WS, email: 'lead@acme.com' });
  delete process.env.CRON_SECRET;
  assert.deepEqual(verifyUnsubscribeToken(token), { workspaceId: WS, email: 'lead@acme.com' });
});

test('a token signed with an empty key is refused', () => {
  assert.equal(verifyUnsubscribeToken(signWith('', WS, 'anyone@victim.com')), null);
});

test('a signature moved onto another address is refused', () => {
  const [, signature] = unsubscribeToken(WS, 'lead@acme.com').split('.');
  const [payload] = signWith(KEY, WS, 'other@acme.com').split('.');
  assert.equal(verifyUnsubscribeToken(`${payload}.${signature}`), null);
  assert.equal(verifyUnsubscribeToken('no-dot-here'), null);
});

for (const value of [undefined, ''] as const) {
  const label = value === undefined ? 'unset' : 'empty';

  test(`with UNSUBSCRIBE_SECRET ${label}, nothing is signed or verified`, () => {
    const good = unsubscribeToken(WS, 'lead@acme.com');
    unsetKey(value);
    assert.throws(() => unsubscribeToken(WS, 'lead@acme.com'), /UNSUBSCRIBE_SECRET is not set/);
    // Not even a token that was valid a moment ago, nor one forged with the
    // empty key the old code fell back to.
    assert.throws(() => verifyUnsubscribeToken(good), /UNSUBSCRIBE_SECRET is not set/);
    assert.throws(
      () => verifyUnsubscribeToken(signWith('', WS, 'lead@acme.com')),
      /UNSUBSCRIBE_SECRET is not set/
    );
  });
}

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

const queued: QueuedEmailAction = { id: 'action-1', workspace_id: WS, lead_id: LEAD, subject: 'Hello', body: 'Body' };

test('a direct send with the key unset sends nothing and queues nothing', async () => {
  unsetKey(undefined);
  const db = world();

  await assert.rejects(
    sendEmail(asClient(db), { workspaceId: WS, leadId: LEAD, subject: 'Hello', body: 'Body' }),
    /UNSUBSCRIBE_SECRET is not set/
  );

  assert.equal(posted.length, 0);
  assert.deepEqual(db.rows('actions'), []);
});

test('a queued email with the key unset stays queued, and goes once the key is set', async () => {
  unsetKey(undefined);
  const db = world([{ ...queued, status: 'queued', channel: 'email' }]);

  await assert.rejects(deliverQueuedEmailAction(asClient(db), queued), /UNSUBSCRIBE_SECRET is not set/);
  assert.equal(posted.length, 0);
  // Not claimed: a row left in 'sending' would never be sent or retried.
  assert.equal(db.rows('actions')[0].status, 'queued');

  process.env.UNSUBSCRIBE_SECRET = KEY;
  const result = await deliverQueuedEmailAction(asClient(db), queued);

  assert.equal(result.status, 'sent');
  assert.equal(posted.length, 1);
  const token = new URL(posted[0].slice(1, -1)).searchParams.get('token')!;
  assert.deepEqual(verifyUnsubscribeToken(token), { workspaceId: WS, email: 'lead@acme.com' });
});
