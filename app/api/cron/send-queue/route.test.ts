// app/api/cron/send-queue/route.test.ts
//
// The send-queue cron, end to end through its two passes: due sequence steps
// are drafted and queued, then due email is delivered. Everything below the
// route runs for real against the fake database (the sequence runner, the
// send queue, the consent gate, the email adapter and the fake's copy of
// claim_email_send); only the drafting model call and Resend are stood in.
// CRON_SECRET is covered in ../auth.test.ts.

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
  addSent,
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

const DAY = 86_400_000;

let db: FakeDb;
let network: ResendStub;

const DRAFT: AgentResult = { ok: true, data: { subject: 'Quick question', body: 'Hi there' }, tells: [] };

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  db = cronDb();
  useDb(db);
  scriptAgents(() => DRAFT);
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

/** A workspace with a sequence, and a lead with no email waiting yet. */
function workspace(id: string, spec: Parameters<typeof addWorkspace>[2] = {}) {
  addWorkspace(db, id, spec);
  addSequence(db, id, `${id}-seq`);
  addLead(db, id, `${id}-lead`, { nextActionAt: null });
}

/** A lead whose first sequence step is due now. */
function dueOnSequence(ws: string, id: string, fit: number | null = 80) {
  addLead(db, ws, id, { stage: 'qualified', sequenceId: `${ws}-seq`, fit });
}

/** Ids Resend was asked to send, for one workspace. */
const sentFrom = (ws: string) =>
  network.sent.filter((id) => db.rows('actions').find((row) => row.id === id)?.workspace_id === ws);

const queuedIn = (ws: string) =>
  db.rows('actions').filter((row) => row.workspace_id === ws && row.status === 'queued').length;

const drafted = () => agentCalls.map((call) => call.leadId);

const outcomeOf = (body: { sequences: { leads: Array<{ leadId: string; outcome: unknown }> } }, leadId: string) =>
  body.sequences.leads.find((entry) => entry.leadId === leadId)?.outcome as Record<string, unknown> | undefined;

// ---------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------

test('a paused workspace sends nothing and drafts nothing; an open one carries on', async () => {
  workspace('paused', { paused: true });
  workspace('open');
  const held = queueEmails(db, 'paused', 'paused-lead', 3);
  queueEmails(db, 'open', 'open-lead', 1);
  dueOnSequence('paused', 'paused-seq-lead');
  dueOnSequence('open', 'open-seq-lead');
  const due = leadOf(db, 'paused-seq-lead').next_action_at;

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(sentFrom('paused'), []);
  for (const id of held) assert.equal(statusOf(db, id), 'queued');
  assert.deepEqual(drafted(), ['open-seq-lead'], 'no draft paid for in the paused workspace');
  assert.equal(leadOf(db, 'paused-seq-lead').sequence_step, 0);
  assert.equal(leadOf(db, 'paused-seq-lead').next_action_at, due, 'the paused lead keeps its date');
  assert.equal(body.sequences.pausedWorkspaces, 1);
  assert.deepEqual(body.held, [{ workspaceId: 'paused', reason: 'sending_paused', retryAt: null, waiting: 3 }]);

  // The open workspace's queued email and its freshly drafted step both went.
  assert.equal(sentFrom('open').length, 2);
  assert.equal(queuedIn('open'), 0);
});

test('an unreadable kill switch fails the run with nothing drafted or sent', async () => {
  workspace('ws');
  queueEmails(db, 'ws', 'ws-lead', 2);
  dueOnSequence('ws', 'ws-seq-lead');
  db.faults.push((s) =>
    s.table === 'workspaces' && s.eq.sending_paused === true ? { code: '57014', message: 'timeout' } : null
  );

  const { status, body } = await run();

  assert.equal(status, 500);
  assert.match(body.error, /could not read the kill switch/);
  assert.equal(agentCalls.length, 0);
  assert.deepEqual(network.sent, []);
  assert.equal(queuedIn('ws'), 2);
});

// ---------------------------------------------------------------
// Daily cap
// ---------------------------------------------------------------

test('delivery stops at the cap and leaves the rest queued', async () => {
  workspace('ws', { cap: 3 });
  addSent(db, 'ws', 'ws-lead', [2]);
  const queued = queueEmails(db, 'ws', 'ws-lead', 5);

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(network.sent, queued.slice(0, 2), 'oldest first, up to the cap');
  assert.deepEqual(
    queued.map((id) => statusOf(db, id)),
    ['sent', 'sent', 'queued', 'queued', 'queued']
  );
  assert.equal(body.sent, 2);
  assert.equal(body.failed, 0);
  assert.equal(body.held.length, 1);
  assert.equal(body.held[0].reason, 'daily_cap_reached');
  assert.equal(body.held[0].waiting, 3);
  // The send from two hours ago is the first to age out of the window.
  const freesAt = new Date(db.rows('actions').find((r) => r.id === 'ws-lead-sent-0')!.sent_at as string);
  assert.equal(new Date(body.held[0].retryAt).getTime(), freesAt.getTime() + DAY);
});

test('a full workspace does not draft a sequence step it could not send today', async () => {
  workspace('ws', { cap: 1 });
  addSent(db, 'ws', 'ws-lead', [3]);
  dueOnSequence('ws', 'seq-lead');

  const { body } = await run();

  assert.equal(agentCalls.length, 0);
  assert.equal(outcomeOf(body, 'seq-lead')?.reason, 'daily_cap_reached');
  assert.equal(leadOf(db, 'seq-lead').sequence_step, 0);
  assert.ok(new Date(leadOf(db, 'seq-lead').next_action_at as string).getTime() > Date.now());
});

test('one workspace at its cap does not hold back another', async () => {
  workspace('capped', { cap: 2 });
  workspace('free');
  const capped = queueEmails(db, 'capped', 'capped-lead', 4);
  const free = queueEmails(db, 'free', 'free-lead', 3);

  const { body } = await run();

  assert.deepEqual(sentFrom('capped'), capped.slice(0, 2));
  assert.equal(queuedIn('capped'), 2);
  assert.deepEqual(sentFrom('free'), free);
  assert.equal(queuedIn('free'), 0);
  assert.deepEqual(
    body.held.map((h: { workspaceId: string; reason: string; waiting: number }) => [h.workspaceId, h.reason, h.waiting]),
    [['capped', 'daily_cap_reached', 2]]
  );
});

// ---------------------------------------------------------------
// Minimum fit score
// ---------------------------------------------------------------

test('leads below the minimum and unscored leads are not drafted to', async () => {
  workspace('ws', { minFit: 60 });
  dueOnSequence('ws', 'low', 59);
  dueOnSequence('ws', 'unscored', null);
  dueOnSequence('ws', 'at-min', 60);

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(drafted(), ['at-min']);
  assert.equal(outcomeOf(body, 'low')?.reason, 'below_min_fit');
  assert.equal(outcomeOf(body, 'unscored')?.reason, 'unscored');

  for (const id of ['low', 'unscored']) {
    const lead = leadOf(db, id);
    assert.equal(lead.sequence_step, 0, `${id} keeps its place in the sequence`);
    assert.equal(lead.stage, 'qualified');
    // Looked at again in a day, so a rescore lets it carry on.
    const wait = new Date(lead.next_action_at as string).getTime() - Date.now();
    assert.ok(wait > DAY - 60_000 && wait <= DAY, `${id} deferred by a day`);
    assert.equal(db.rows('actions').filter((row) => row.lead_id === id).length, 0, `nothing queued for ${id}`);
  }

  // The lead at the minimum was drafted, queued and sent on the same pass.
  const step = db.rows('actions').find((row) => row.lead_id === 'at-min')!;
  assert.equal(step.status, 'sent');
  assert.deepEqual(network.sent, [step.id]);
});

// ---------------------------------------------------------------
// One workspace's failure
// ---------------------------------------------------------------

test('a send that fails in one workspace does not stop delivery in the next', async () => {
  workspace('a');
  workspace('b');
  const [failing] = queueEmails(db, 'a', 'a-lead', 1);
  const fine = queueEmails(db, 'b', 'b-lead', 2);
  network.restore();
  network = stubNetwork((id) => id === failing);

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.equal(statusOf(db, failing), 'failed');
  assert.deepEqual(sentFrom('b'), fine);
  assert.deepEqual([body.sent, body.failed], [2, 1]);
});

test('a draft that fails in one workspace does not stop the steps or sends of the next', async () => {
  workspace('a');
  workspace('b');
  dueOnSequence('a', 'a-seq-lead');
  dueOnSequence('b', 'b-seq-lead');
  const queued = queueEmails(db, 'b', 'b-lead', 1);
  scriptAgents((call) =>
    call.workspaceId === 'a'
      ? { ok: false, error: 'overloaded', failure: { kind: 'api_error', detail: 'overloaded', attempts: 1 } }
      : DRAFT
  );

  const { status, body } = await run();

  assert.equal(status, 200);
  assert.deepEqual(drafted(), ['a-seq-lead', 'b-seq-lead']);
  assert.deepEqual(outcomeOf(body, 'a-seq-lead'), { status: 'failed', reason: 'overloaded' });
  assert.equal(outcomeOf(body, 'b-seq-lead')?.status, 'queued');

  // a's lead keeps its step and is tried again tomorrow.
  assert.equal(leadOf(db, 'a-seq-lead').sequence_step, 0);
  assert.ok(new Date(leadOf(db, 'a-seq-lead').next_action_at as string).getTime() > Date.now());
  assert.deepEqual(sentFrom('a'), []);

  // b's step and b's queued email both went out.
  const step = db.rows('actions').find((row) => row.lead_id === 'b-seq-lead')!;
  assert.deepEqual(sentFrom('b').sort(), [queued[0], step.id].sort());
});
