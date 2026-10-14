// app/api/cron/send-queue/sequence-timing.test.ts
//
// QA fault 6: a step's delay was counted from when the previous step was
// queued, not from when it was sent, so a draft left unapproved let the next
// step fall due on top of it. These run the send-queue cron end to end (the
// runner, then delivery) against leads part-way through a sequence, and check
// that the next step waits for the previous one's send, and that a step that
// never sends ends the run with its own reason instead of holding the lead.

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
  addStepAction,
  addWorkspace,
  cronDb,
  cronRequest,
  hoursFromNow,
  leadOf,
  statusOf,
  stubNetwork,
  type ResendStub,
} from '../../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../../lib/cadence/testing/fake-postgrest.ts';
import { STEP_EXPIRY_DAYS, dueOn, nextPass } from '../../../../lib/cadence/sequence.ts';

registerRouteLoader(CRON_DOUBLES);
const { GET } = await import('./route.ts');

const WS = 'ws';
const SEQ = 'ws-seq';
const LEAD = 'lead';
const DAY_HOURS = 24;

let db: FakeDb;
let network: ResendStub;

const DRAFT: AgentResult = { ok: true, data: { subject: 'Following up', body: 'A fresh draft' }, tells: [] };

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.UNSUBSCRIBE_SECRET = 'unsubscribe-test-secret';
  db = cronDb();
  useDb(db);
  scriptAgents(() => DRAFT);
  network = stubNetwork();
  addWorkspace(db, WS);
  // Three email steps, three days apart.
  addSequence(db, WS, SEQ, [{ delay_days: 0 }, { delay_days: 3 }, { delay_days: 3 }]);
});

afterEach(() => {
  network.restore();
  resetDoubles();
});

async function run() {
  const response = await GET(cronRequest());
  assert.equal(response.status, 200);
  return (await response.json()) as { sequences: { leads: Array<{ leadId: string; outcome: Record<string, unknown> }> } };
}

const outcomeOf = (body: Awaited<ReturnType<typeof run>>, leadId = LEAD) =>
  body.sequences.leads.find((entry) => entry.leadId === leadId)?.outcome;

/** A lead already on step `step`, due by its date. */
function onStep(step: number, id = LEAD) {
  addLead(db, WS, id, { sequenceId: SEQ, sequenceStep: step });
}

/** The next day: the lead's look-again date has come round. */
function nextDay(id = LEAD) {
  leadOf(db, id).next_action_at = hoursFromNow(-1);
}

const stepRows = (step: number) =>
  db.rows('actions').filter((row) => row.lead_id === LEAD && row.step_number === step);

// ---------------------------------------------------------------
// The fault: the delay counts from the send
// ---------------------------------------------------------------

test('a draft left unapproved holds the next step, however long ago it was queued', async () => {
  onStep(1);
  const draft = addStepAction(db, WS, LEAD, SEQ, 1, { status: 'awaiting_approval', createdHoursAgo: 5 * DAY_HOURS });

  const body = await run();

  assert.equal(agentCalls.length, 0, 'step 2 is not drafted');
  assert.deepEqual(network.sent, []);
  assert.equal(statusOf(db, draft), 'awaiting_approval');
  const lead = leadOf(db, LEAD);
  assert.equal(lead.sequence_step, 1);
  assert.equal(lead.sequence_stopped_reason, null);
  // Looked at again on the day the draft would expire, not three days on.
  const created = new Date(db.rows('actions').find((row) => row.id === draft)!.created_at as string);
  assert.equal(lead.next_action_at, dueOn(created, STEP_EXPIRY_DAYS));
  assert.deepEqual(outcomeOf(body), { status: 'deferred', reason: 'step_awaiting_approval', nextAt: lead.next_action_at });
});

test('step 2 falls due three days after step 1 was sent, not after it was queued', async () => {
  onStep(1);
  // Queued ten days ago, approved and sent yesterday.
  addStepAction(db, WS, LEAD, SEQ, 1, { status: 'sent', createdHoursAgo: 10 * DAY_HOURS, sentHoursAgo: DAY_HOURS });
  const sentAt = stepRows(1)[0].sent_at as string;

  const body = await run();

  assert.equal(agentCalls.length, 0);
  assert.equal(stepRows(2).length, 0);
  assert.equal(outcomeOf(body)?.reason, 'not_due');
  assert.equal(leadOf(db, LEAD).next_action_at, dueOn(new Date(sentAt), 3));
});

test('once three days have passed since the send, step 2 is drafted and sent', async () => {
  onStep(1);
  addStepAction(db, WS, LEAD, SEQ, 1, { status: 'sent', createdHoursAgo: 10 * DAY_HOURS, sentHoursAgo: 4 * DAY_HOURS });

  const body = await run();

  assert.deepEqual(agentCalls.map((call) => call.extra?.step_number), [2]);
  assert.equal(stepRows(2).length, 1);
  assert.equal(stepRows(2)[0].status, 'sent');
  assert.equal(leadOf(db, LEAD).sequence_step, 2);
  assert.equal(outcomeOf(body)?.status, 'queued');
});

test('a step queued and sent in one pass is looked at the next day, then due from its send', async () => {
  addLead(db, WS, LEAD, { stage: 'qualified', sequenceId: SEQ });

  await run();

  const [first] = stepRows(1);
  assert.equal(first.status, 'sent');
  const lead = leadOf(db, LEAD);
  assert.equal(lead.sequence_step, 1);
  assert.equal(lead.next_action_at, nextPass(), 'not three days from the queueing');

  nextDay();
  const body = await run();

  assert.equal(agentCalls.length, 1, 'still only step 1 drafted');
  assert.equal(outcomeOf(body)?.reason, 'not_due');
  assert.equal(leadOf(db, LEAD).next_action_at, dueOn(new Date(first.sent_at as string), 3));
});

test('the last step completes the run once it has been sent, not when it was queued', async () => {
  db.rows('sequences').length = 0;
  addSequence(db, WS, SEQ);
  addLead(db, WS, LEAD, { stage: 'qualified', sequenceId: SEQ });

  await run();
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, null, 'queued, not yet known to be sent');

  nextDay();
  await run();
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, 'completed');
  assert.equal(leadOf(db, LEAD).next_action_at, null);
});

// ---------------------------------------------------------------
// A step that never sends
// ---------------------------------------------------------------

test('a rejected draft stops the run as step_rejected, with nothing drafted', async () => {
  onStep(1);
  addStepAction(db, WS, LEAD, SEQ, 1, { status: 'blocked', blockReason: 'rejected_by_user' });

  const body = await run();

  assert.equal(agentCalls.length, 0);
  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_rejected' });
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, 'step_rejected');
  assert.equal(leadOf(db, LEAD).next_action_at, null);
});

test('a lead re-enrolled after a rejection starts again and is not held by the old row', async () => {
  // Rejected a month ago, then put back on the sequence at step zero.
  addStepAction(db, WS, LEAD, SEQ, 1, {
    status: 'blocked',
    blockReason: 'rejected_by_user',
    createdHoursAgo: 30 * DAY_HOURS,
  });
  addLead(db, WS, LEAD, { sequenceId: SEQ, sequenceStep: 0 });

  await run();
  assert.equal(agentCalls.length, 1, 'step 1 is drafted afresh');
  const fresh = stepRows(1).find((row) => row.status === 'sent')!;
  assert.ok(fresh);

  nextDay();
  const body = await run();
  assert.equal(outcomeOf(body)?.reason, 'not_due', 'the new send decides, not the old rejection');
  assert.equal(leadOf(db, LEAD).next_action_at, dueOn(new Date(fresh.sent_at as string), 3));
});

test('a failed send is retried as the same message, and the run stops after three failures', async () => {
  network.restore();
  network = stubNetwork(() => true);
  addLead(db, WS, LEAD, { stage: 'qualified', sequenceId: SEQ });

  // Pass 1: drafted, and Resend fails.
  await run();
  assert.equal(agentCalls.length, 1);
  assert.deepEqual(stepRows(1).map((row) => row.status), ['failed']);

  // Passes 2 and 3: the same message again, no new draft, failing again.
  for (const attempt of [2, 3]) {
    nextDay();
    const body = await run();
    assert.equal(outcomeOf(body)?.status, 'queued');
    assert.equal(outcomeOf(body)?.attempt, attempt);
    assert.equal(outcomeOf(body)?.step, 1);
  }
  assert.equal(agentCalls.length, 1, 'a retry is not redrafted');
  const rows = stepRows(1);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === 'failed' && row.body === 'A fresh draft'));
  // Each retry points at the send it replaced; the first draft at nothing.
  assert.deepEqual(
    rows.map((row) => row.retry_of),
    [null, rows[0].id, rows[1].id]
  );
  assert.equal(leadOf(db, LEAD).sequence_step, 1);
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, null);

  // Pass 4: three failures of the same step stop the run.
  nextDay();
  const body = await run();
  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_failed' });
  assert.equal(stepRows(1).length, 3, 'nothing queued a fourth time');
  assert.equal(leadOf(db, LEAD).next_action_at, null);
});

test('a retry that goes through lets the run carry on from its send', async () => {
  onStep(1);
  const failed = addStepAction(db, WS, LEAD, SEQ, 1, { status: 'failed', blockReason: 'resend 500' });

  const body = await run();

  assert.equal(outcomeOf(body)?.attempt, 2);
  assert.deepEqual(stepRows(1).map((row) => row.status).sort(), ['failed', 'sent']);
  assert.equal(stepRows(1).find((row) => row.status === 'sent')?.retry_of, failed);
  assert.equal(agentCalls.length, 0);

  nextDay();
  const next = await run();
  assert.equal(outcomeOf(next)?.reason, 'not_due');
});

test('the third failure along the chain stops the run; failures off the chain do not count', async () => {
  network.restore();
  network = stubNetwork(() => true);
  onStep(1);
  // Last enrolment: three chained failures, a month ago.
  let previous: string | null = null;
  for (const days of [32, 31, 30]) {
    previous = addStepAction(db, WS, LEAD, SEQ, 1, {
      status: 'failed',
      createdHoursAgo: days * DAY_HOURS,
      retryOf: previous,
    });
  }
  // This enrolment: a fresh draft and one retry, both failed.
  const fresh = addStepAction(db, WS, LEAD, SEQ, 1, { status: 'failed', createdHoursAgo: 3 * DAY_HOURS });
  const retried = addStepAction(db, WS, LEAD, SEQ, 1, {
    status: 'failed',
    createdHoursAgo: 2 * DAY_HOURS,
    retryOf: fresh,
  });

  const third = await run();
  assert.equal(outcomeOf(third)?.attempt, 3, 'two failures on this chain, not five');
  // The third send failed at Resend too.
  assert.equal(stepRows(1).find((row) => row.retry_of === retried)?.status, 'failed');

  nextDay();
  const body = await run();
  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_failed' });
});

test('a retry waits for room under the daily cap like any other email', async () => {
  db.rows('workspaces')[0].daily_send_cap = 1;
  addSent(db, WS, 'someone-else', [0]);
  onStep(1);
  addStepAction(db, WS, LEAD, SEQ, 1, { status: 'failed', blockReason: 'resend 500' });

  const body = await run();

  assert.equal(outcomeOf(body)?.reason, 'daily_cap_reached');
  assert.equal(stepRows(1).length, 1, 'no copy queued');
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, null);
});

test('a draft unapproved past the expiry is blocked and the run stops as step_expired', async () => {
  onStep(1);
  const draft = addStepAction(db, WS, LEAD, SEQ, 1, {
    status: 'awaiting_approval',
    createdHoursAgo: (STEP_EXPIRY_DAYS + 1) * DAY_HOURS,
  });

  const body = await run();

  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_expired' });
  assert.equal(statusOf(db, draft), 'blocked', 'it leaves the approvals list');
  assert.equal(db.rows('actions').find((row) => row.id === draft)?.block_reason, 'step_expired');
  assert.equal(agentCalls.length, 0);
});

test('a row stuck in sending past the expiry stops the run and is left as it is', async () => {
  onStep(1);
  const stuck = addStepAction(db, WS, LEAD, SEQ, 1, {
    status: 'sending',
    createdHoursAgo: (STEP_EXPIRY_DAYS + 1) * DAY_HOURS,
  });

  const body = await run();

  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_expired' });
  assert.equal(statusOf(db, stuck), 'sending');
});

test('a queued step held by the cap keeps the lead waiting however old it is', async () => {
  db.rows('workspaces')[0].daily_send_cap = 1;
  addSent(db, WS, 'someone-else', [0]);
  onStep(1);
  const held = addStepAction(db, WS, LEAD, SEQ, 1, { status: 'queued', createdHoursAgo: 40 * DAY_HOURS });

  const body = await run();

  assert.equal(outcomeOf(body)?.reason, 'step_queued');
  assert.equal(statusOf(db, held), 'queued');
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, null);
  assert.equal(leadOf(db, LEAD).next_action_at, nextPass());
});

test('a lead on a step with no action row stops as step_missing', async () => {
  onStep(1);

  const body = await run();

  assert.deepEqual(outcomeOf(body), { status: 'stopped', reason: 'step_missing' });
  assert.equal(agentCalls.length, 0);
});

// ---------------------------------------------------------------
// Failures that are not about the lead
// ---------------------------------------------------------------

test('a failed insert leaves the lead on its step for the next pass', async () => {
  addLead(db, WS, LEAD, { stage: 'qualified', sequenceId: SEQ });
  db.faults.push((s) =>
    s.table === 'actions' && s.op === 'insert' ? { code: '57014', message: 'timeout' } : null
  );

  const body = await run();

  assert.equal(outcomeOf(body)?.status, 'failed');
  assert.match(String(outcomeOf(body)?.reason), /^action_insert_failed/);
  const lead = leadOf(db, LEAD);
  assert.equal(lead.sequence_step, 0, 'the step is not lost');
  assert.equal(lead.stage, 'qualified');
  assert.equal(lead.sequence_stopped_reason, null);
  assert.equal(lead.next_action_at, nextPass());
  assert.deepEqual(network.sent, []);

  // Next pass, with the database back, the same step goes out.
  db.faults.length = 0;
  nextDay();
  await run();
  assert.equal(stepRows(1)[0]?.status, 'sent');
  assert.equal(leadOf(db, LEAD).sequence_step, 1);
});

test('a failed read of the step is not mistaken for a missing step', async () => {
  onStep(1);
  addStepAction(db, WS, LEAD, SEQ, 1, { status: 'sent', sentHoursAgo: 4 * DAY_HOURS });
  db.faults.push((s) =>
    s.table === 'actions' && s.op === 'select' && s.eq.step_number !== undefined
      ? { code: '57014', message: 'timeout' }
      : null
  );

  const body = await run();

  assert.equal(outcomeOf(body)?.status, 'failed');
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, null);
  assert.equal(leadOf(db, LEAD).next_action_at, nextPass());
  assert.equal(agentCalls.length, 0);
});
