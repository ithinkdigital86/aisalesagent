// app/api/cron/send-queue/daily-cap.test.ts
//
// The daily cap against the cron that enforces it. The send-queue cron runs
// once a day at about the same time (vercel.json), so the cap has to free its
// slots by the next run. Counted over a rolling 24 hours it did not:
// yesterday's sends, made a few seconds into yesterday's run, were still
// inside the window when today's run started, and a workspace at its cap sent
// only every other day.
//
// These run the cron end to end on a clock the test sets, day after day.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { registerRouteLoader } from '../../../../lib/cadence/testing/route-loader.ts';
import {
  CRON_DOUBLES,
  agentCalls,
  resetDoubles,
  scriptAgents,
  useDb,
  type AgentResult,
} from '../../../../lib/cadence/testing/cron-doubles.ts';
import {
  SECRET,
  addLead,
  addSequence,
  addWorkspace,
  cronDb,
  cronRequest,
  leadOf,
  queueEmails,
  statusOf,
  stubNetwork,
  type ResendStub,
} from '../../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader(CRON_DOUBLES);
const { GET } = await import('./route.ts');

/** 09:00 in India, when vercel.json fires the send-queue cron. */
const RUN_UTC = 'T03:30:00.000Z';

let db: FakeDb;
let network: ResendStub;

const DRAFT: AgentResult = { ok: true, data: { subject: 'Quick question', body: 'Hi there' }, tells: [] };

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  mock.timers.enable({ apis: ['Date'], now: new Date(`2026-10-14${RUN_UTC}`) });
  db = cronDb();
  useDb(db);
  scriptAgents(() => DRAFT);
  network = stubNetwork();
});

afterEach(() => {
  network.restore();
  resetDoubles();
  mock.timers.reset();
});

/** The cron, run with the clock at `at`. */
async function runAt(at: string) {
  mock.timers.setTime(new Date(at).getTime());
  const response = await GET(cronRequest());
  assert.equal(response.status, 200);
  return (await response.json()) as {
    sent: number;
    held: Array<{ workspaceId: string; reason: string; retryAt: string | null; waiting: number }>;
    sequences: { leads: Array<{ leadId: string; outcome: Record<string, unknown> }> };
  };
}

test('a workspace at its cap sends its cap every day, not every other day', async () => {
  addWorkspace(db, 'ws', { cap: 3 });
  addLead(db, 'ws', 'ws-lead', { nextActionAt: null });
  const queued = queueEmails(db, 'ws', 'ws-lead', 9);

  // Day one: the run starts at 09:00 and its sends land a few seconds in.
  const first = await runAt('2026-10-14T03:30:05.000Z');
  assert.equal(first.sent, 3);

  // Day two, at 09:00 sharp: a few seconds short of 24 hours since
  // yesterday's sends. A rolling window still counts all three and sends none.
  const second = await runAt(`2026-10-15${RUN_UTC}`);
  assert.equal(second.sent, 3, "yesterday's sends do not count against today");

  const third = await runAt(`2026-10-16${RUN_UTC}`);
  assert.equal(third.sent, 3);

  assert.deepEqual(network.sent, queued, 'oldest first, three a day');
  assert.ok(queued.every((id) => statusOf(db, id) === 'sent'));
});

test('a second run the same day sends nothing more and holds the rest until midnight in India', async () => {
  addWorkspace(db, 'ws', { cap: 2 });
  addLead(db, 'ws', 'ws-lead', { nextActionAt: null });
  queueEmails(db, 'ws', 'ws-lead', 4);

  assert.equal((await runAt(`2026-10-14${RUN_UTC}`)).sent, 2);

  // The dashboard's "Process send queue" at 23:59 the same evening.
  const later = await runAt('2026-10-14T18:29:59.000Z');
  assert.equal(later.sent, 0);
  assert.deepEqual(later.held, [
    { workspaceId: 'ws', reason: 'daily_cap_reached', retryAt: '2026-10-14T18:30:00.000Z', waiting: 2 },
  ]);

  // A minute later it is tomorrow there, and the count has started again.
  // Two calendar days' caps can go this close together; only a manual pass
  // either side of midnight does it, since the cron runs at 09:00.
  assert.equal((await runAt('2026-10-14T18:31:00.000Z')).sent, 2);
});

test("a sequence step the cap held is drafted and sent on the next day's run", async () => {
  addWorkspace(db, 'ws', { cap: 1 });
  addSequence(db, 'ws', 'ws-seq');
  addLead(db, 'ws', 'ws-lead', { nextActionAt: null });
  const [queued] = queueEmails(db, 'ws', 'ws-lead', 1);
  addLead(db, 'ws', 'seq-lead', { stage: 'qualified', sequenceId: 'ws-seq' });

  // Day one: the queued email takes the only slot, so the step is not drafted.
  const first = await runAt('2026-10-14T03:30:05.000Z');
  assert.deepEqual(network.sent, [queued]);
  assert.equal(agentCalls.length, 0);
  const held = first.sequences.leads.find((entry) => entry.leadId === 'seq-lead')?.outcome;
  assert.equal(held?.reason, 'daily_cap_reached');
  assert.equal(leadOf(db, 'seq-lead').next_action_at, '2026-10-14T18:30:00.000Z', 'due from midnight');

  // Day two, at 09:00 sharp: room again, so it is drafted and goes out.
  const second = await runAt(`2026-10-15${RUN_UTC}`);
  assert.equal(agentCalls.length, 1);
  assert.equal(second.sent, 1);
  assert.equal(leadOf(db, 'seq-lead').sequence_step, 1);
});
