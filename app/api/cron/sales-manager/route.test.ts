// app/api/cron/sales-manager/route.test.ts
//
// The daily Sales Manager review, run once per workspace. It sends nothing,
// so it ignores the kill switch on purpose, and one workspace's failed review
// must not cost every workspace after it theirs. The model call is scripted;
// CRON_SECRET is covered for all three crons in ../auth.test.ts.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { registerRouteLoader } from '../../../../lib/cadence/testing/route-loader.ts';
import {
  CRON_DOUBLES,
  agentCalls,
  resetDoubles,
  scriptAgents,
  useDb,
} from '../../../../lib/cadence/testing/cron-doubles.ts';
import {
  SECRET,
  addLead,
  addSent,
  addWorkspace,
  cronDb,
  cronRequest,
  stubNetwork,
  type ResendStub,
} from '../../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader(CRON_DOUBLES);
const { GET } = await import('./route.ts');

let db: FakeDb;
let network: ResendStub;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  db = cronDb();
  useDb(db);
  scriptAgents(() => ({ ok: true, data: { summary: 'fine' } }));
  network = stubNetwork();
});

afterEach(() => {
  network.restore();
  resetDoubles();
});

/** A workspace with one lead and one sent email, so there is something to review. */
function activeWorkspace(id: string, spec: Parameters<typeof addWorkspace>[2] = {}) {
  addWorkspace(db, id, spec);
  addLead(db, id, `${id}-lead`);
  addSent(db, id, `${id}-lead`, [2]);
}

async function run() {
  const response = await GET(cronRequest());
  return { status: response.status, body: await response.json() };
}

const reviewed = () => agentCalls.map((call) => [call.agent, call.workspaceId]);

test('runs the review for every workspace with activity', async () => {
  activeWorkspace('a');
  activeWorkspace('b');

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(reviewed(), [
    ['sales_manager', 'a'],
    ['sales_manager', 'b'],
  ]);
  assert.deepEqual(agentCalls[0].extra, { channelStats: { email: { sent: 1, replied: 0 } } });
  assert.equal(body.processed, 2);
  assert.deepEqual(
    body.handled.map((h: { workspaceId: string; ok: boolean }) => [h.workspaceId, h.ok]),
    [
      ['a', true],
      ['b', true],
    ]
  );
});

test('runs for a paused workspace exactly as for any other', async () => {
  activeWorkspace('paused', { paused: true });
  activeWorkspace('open');

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(reviewed(), [
    ['sales_manager', 'paused'],
    ['sales_manager', 'open'],
  ]);
  assert.ok(body.handled.every((h: { ok: boolean }) => h.ok));
  assert.deepEqual(network.sent, [], 'a review sends nothing');
});

test('skips a workspace with no activity without a model call', async () => {
  addWorkspace(db, 'new');
  activeWorkspace('busy');

  const { body } = await run();

  assert.deepEqual(reviewed(), [['sales_manager', 'busy']]);
  assert.deepEqual(body.handled[0], { workspaceId: 'new', ok: true, error: 'skipped_no_activity' });
});

test('a failed review in one workspace does not stop the next', async () => {
  activeWorkspace('a');
  activeWorkspace('b');
  activeWorkspace('c');
  scriptAgents((call) =>
    call.workspaceId === 'a'
      ? {
          ok: false,
          error: 'Agent output rejected after 2 attempts.',
          failure: { kind: 'schema_mismatch', detail: 'missing summary', attempts: 2 },
        }
      : { ok: true, data: { summary: 'fine' } }
  );

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(reviewed().map(([, ws]) => ws), ['a', 'b', 'c']);
  assert.deepEqual(body.handled[0], {
    workspaceId: 'a',
    ok: false,
    error: 'Agent output rejected after 2 attempts.',
    failureKind: 'schema_mismatch',
  });
  assert.deepEqual(
    body.handled.slice(1).map((h: { workspaceId: string; ok: boolean }) => [h.workspaceId, h.ok]),
    [
      ['b', true],
      ['c', true],
    ]
  );
});

test('an exception in one workspace is recorded and the run carries on', async () => {
  activeWorkspace('a');
  activeWorkspace('b');
  scriptAgents((call) => {
    if (call.workspaceId === 'a') throw new Error('connection reset');
    return { ok: true, data: { summary: 'fine' } };
  });

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(body.handled, [
    { workspaceId: 'a', ok: false, error: 'connection reset' },
    { workspaceId: 'b', ok: true },
  ]);
});
