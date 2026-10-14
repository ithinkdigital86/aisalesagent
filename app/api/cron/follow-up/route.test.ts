// app/api/cron/follow-up/route.test.ts
//
// The follow-up cron: every due lead, across every workspace, goes to the
// Follow-up manager and the decision is applied. Leads in a paused workspace
// are left exactly as they were, and one lead's failure, whether the model's
// or a suppression write's, must not cost the leads after it their turn.
// The model call is scripted; CRON_SECRET is covered in ../auth.test.ts.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

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
  addWorkspace,
  cronDb,
  cronRequest,
  hoursFromNow,
  leadOf,
  stubNetwork,
  type ResendStub,
} from '../../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader(CRON_DOUBLES);
const { GET } = await import('./route.ts');

let db: FakeDb;
let network: ResendStub;

/** The manager's decision: wait a day, move to engaged. */
const WAIT: AgentResult = {
  ok: true,
  data: { next_action: 'wait', next_channel: 'none', wait_hours: 24, new_stage: 'engaged', sentiment: 'neutral' },
};

const SUPPRESS: AgentResult = {
  ok: true,
  data: { next_action: 'suppress', next_channel: 'none', wait_hours: 0, new_stage: 'suppressed', sentiment: 'negative' },
};

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  db = cronDb();
  useDb(db);
  scriptAgents(() => WAIT);
  network = stubNetwork();
});

afterEach(() => {
  network.restore();
  resetDoubles();
});

async function run() {
  const response = await GET(cronRequest());
  return { status: response.status, body: await response.json() };
}

const asked = () => agentCalls.map((call) => call.leadId);

/** True when the lead's next_action_at moved forward from the past. */
const rescheduled = (leadId: string) =>
  new Date(leadOf(db, leadId).next_action_at as string).getTime() > Date.now();

// ---------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------

test('skips every lead in a paused workspace and leaves it due', async () => {
  addWorkspace(db, 'paused', { paused: true });
  addWorkspace(db, 'open');
  const due = hoursFromNow(-2);
  addLead(db, 'paused', 'p1', { nextActionAt: due });
  addLead(db, 'paused', 'p2', { nextActionAt: due });
  addLead(db, 'open', 'o1');

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(asked(), ['o1']);
  assert.equal(body.pausedWorkspaces, 1);
  assert.equal(body.processed, 1);
  for (const id of ['p1', 'p2']) {
    assert.equal(leadOf(db, id).next_action_at, due, `${id} keeps its date for when the switch is off`);
    assert.equal(leadOf(db, id).stage, 'contacted');
  }
  assert.equal(leadOf(db, 'o1').stage, 'engaged');
  assert.ok(rescheduled('o1'));
});

test('an unreadable kill switch stops the run before any lead is handled', async () => {
  addWorkspace(db, 'ws');
  addLead(db, 'ws', 'lead');
  db.faults.push((s) =>
    s.table === 'workspaces' && s.eq.sending_paused === true ? { code: '57014', message: 'timeout' } : null
  );

  const { status, body } = await run();

  assert.equal(status, 500);
  assert.match(body.error, /could not read the kill switch/);
  assert.equal(agentCalls.length, 0);
});

// ---------------------------------------------------------------
// Which leads are due
// ---------------------------------------------------------------

test('leaves a lead on a running sequence to the sequence runner', async () => {
  addWorkspace(db, 'ws');
  addLead(db, 'ws', 'running', { sequenceId: 'seq' });
  addLead(db, 'ws', 'stopped', { sequenceId: 'seq', stoppedReason: 'reply' });
  addLead(db, 'ws', 'none');
  addLead(db, 'ws', 'later', { nextActionAt: hoursFromNow(5) });
  addLead(db, 'ws', 'fresh', { stage: 'qualified' });

  await run();

  assert.deepEqual(asked().sort(), ['none', 'stopped']);
});

test('does not filter by fit score: below-minimum and unscored leads still reach the manager', async () => {
  // Recorded, not endorsed. The minimum fit score is enforced where a lead
  // is drafted to (the draft routes, enrolment, the sequence runner), and
  // this cron drafts nothing. If it should skip these leads too, this is the
  // test to turn around.
  addWorkspace(db, 'ws', { minFit: 60 });
  addLead(db, 'ws', 'low', { fit: 40 });
  addLead(db, 'ws', 'unscored', { fit: null });

  await run();

  assert.deepEqual(asked().sort(), ['low', 'unscored']);
});

// ---------------------------------------------------------------
// One workspace's failure
// ---------------------------------------------------------------

test("a failed model call for one workspace's lead does not stop another's", async () => {
  addWorkspace(db, 'a');
  addWorkspace(db, 'b');
  addLead(db, 'a', 'a1');
  addLead(db, 'b', 'b1');
  scriptAgents((call) =>
    call.workspaceId === 'a'
      ? { ok: false, error: 'overloaded', failure: { kind: 'api_error', detail: 'overloaded', attempts: 1 } }
      : WAIT
  );

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(asked(), ['a1', 'b1']);
  assert.deepEqual(body.handled[0], { leadId: 'a1', ok: false, error: 'overloaded', failureKind: 'api_error' });
  assert.deepEqual(body.handled[1], { leadId: 'b1', ok: true, action: 'wait', channelBlocked: false });
  assert.equal(leadOf(db, 'a1').stage, 'contacted', 'nothing applied for the failed lead');
  assert.equal(leadOf(db, 'b1').stage, 'engaged');
  assert.ok(rescheduled('b1'));
});

test('a failed suppression write in one workspace still lets the others finish, then fails the run', async () => {
  addWorkspace(db, 'a');
  addWorkspace(db, 'b');
  addWorkspace(db, 'c');
  addLead(db, 'a', 'a1');
  addLead(db, 'b', 'b1');
  addLead(db, 'c', 'c1');
  scriptAgents((call) => (call.workspaceId === 'c' ? WAIT : SUPPRESS));
  db.faults.push((s) =>
    s.table === 'suppression_list' && s.op === 'upsert' && s.rows[0]?.workspace_id === 'a'
      ? { code: '57014', message: 'canceling statement due to statement timeout' }
      : null
  );

  const { status, body } = await run();

  // 500 so the failure is seen, but only after every lead had its turn.
  assert.equal(status, 500);
  assert.deepEqual(
    body.handled.map((h: { leadId: string; ok: boolean; action: string }) => [h.leadId, h.ok, h.action]),
    [
      ['a1', false, 'suppress'],
      ['b1', true, 'suppressed'],
      ['c1', true, 'wait'],
    ]
  );
  // a1 stays due, so the next run tries the suppression again.
  assert.equal(leadOf(db, 'a1').stage, 'contacted');
  assert.ok(leadOf(db, 'a1').next_action_at);
  assert.deepEqual(
    db.rows('suppression_list').map((row) => [row.workspace_id, row.email]),
    [['b', 'b1@acme.in']]
  );
  assert.equal(leadOf(db, 'b1').stage, 'suppressed');
  assert.equal(leadOf(db, 'c1').stage, 'engaged');
});
