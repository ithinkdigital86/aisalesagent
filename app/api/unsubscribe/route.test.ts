// app/api/unsubscribe/route.test.ts
//
// The unsubscribe route with and without UNSUBSCRIBE_SECRET. Unset, the route
// cannot tell a real link from a forged one, so it must suppress nothing. It
// must also not call a real link invalid: the recipient is told to try again
// (500), and a mail client posting one-click retries on a 500.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';

import { registerRouteLoader } from '../../../lib/cadence/testing/route-loader.ts';
import { DOUBLES_URL, resetDoubles, useDb } from '../../../lib/cadence/testing/cron-doubles.ts';
import { addLead, addWorkspace, cronDb } from '../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader({ '@/lib/supabase/server': DOUBLES_URL });

const { GET, POST } = await import('./route.ts');
const { unsubscribeToken } = await import('../../../lib/cadence/adapters/email.ts');

const KEY = 'unsubscribe-test-secret';
const ADDRESS = 'lead@acme.in';

let db: FakeDb;

beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = KEY;
  db = cronDb();
  addWorkspace(db, 'ws');
  addLead(db, 'ws', 'lead');
  useDb(db);
});

afterEach(() => {
  resetDoubles();
});

function url(token: string): string {
  return `http://localhost/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** What Gmail and Outlook send for the List-Unsubscribe-Post header. */
function oneClick(token: string): Request {
  return new Request(url(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

function confirmForm(token: string): Request {
  return new Request(url(token), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'confirm=yes',
  });
}

function emptyKeyToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ w: 'ws', e: email })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', '').update(payload).digest('base64url')}`;
}

function untouched(): void {
  assert.deepEqual(db.rows('suppression_list'), []);
  assert.equal(db.rows('leads')[0].stage, 'contacted');
  assert.equal(db.rows('consent_records')[0].revoked_at, null);
}

test('a signed link suppresses the address on one-click', async () => {
  const response = await POST(oneClick(unsubscribeToken('ws', ADDRESS)));

  assert.equal(response.status, 200);
  assert.equal(db.rows('suppression_list').length, 1);
  assert.equal(db.rows('suppression_list')[0].email, ADDRESS);
  assert.equal(db.rows('leads')[0].stage, 'suppressed');
});

test('a link forged with the empty key is refused and suppresses nothing', async () => {
  const token = emptyKeyToken(ADDRESS);

  assert.equal((await POST(oneClick(token))).status, 400);
  const page = await GET(new Request(url(token)));
  assert.match(await page.text(), /This link is not valid/);
  untouched();
});

test('with the key unset, the confirm page says try again, not that the link is bad', async () => {
  const token = unsubscribeToken('ws', ADDRESS);
  delete process.env.UNSUBSCRIBE_SECRET;

  const response = await GET(new Request(url(token)));
  const html = await response.text();

  assert.equal(response.status, 500);
  assert.match(html, /You have not been unsubscribed yet/);
  assert.doesNotMatch(html, /This link is not valid/);
  assert.doesNotMatch(html, /Unsubscribe me/);
});

test('with the key unset, a one-click POST is a 500 and suppresses nothing', async () => {
  const token = unsubscribeToken('ws', ADDRESS);
  delete process.env.UNSUBSCRIBE_SECRET;

  assert.equal((await POST(oneClick(token))).status, 500);
  // Not even with the empty key the old code signed with.
  assert.equal((await POST(oneClick(emptyKeyToken(ADDRESS)))).status, 500);
  untouched();
});

test('with the key unset, the confirm form is a 500 page and suppresses nothing', async () => {
  const token = unsubscribeToken('ws', ADDRESS);
  process.env.UNSUBSCRIBE_SECRET = '';

  const response = await POST(confirmForm(token));

  assert.equal(response.status, 500);
  assert.match(await response.text(), /You have not been unsubscribed yet/);
  untouched();
});
