// lib/cadence/sequence.test.ts
//
// The parts of the sequence runner that are worth being sure about without a
// database: what counts as a step, which step comes next, when it falls due,
// and the six conditions that stop a run. The database half is exercised in
// the browser; these are the rules that decide whether a person gets a fifth
// message or keeps getting them after saying stop.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_SEND_ATTEMPTS,
  MAX_STEPS,
  STEP_EXPIRY_DAYS,
  countFailures,
  describeProgress,
  describeStop,
  dueAt,
  dueOn,
  formatDueDate,
  nextStep,
  parseSteps,
  stepReadiness,
  stepsSchema,
  stopReasonFrom,
  type SequenceStep,
  type StepAttempt,
} from './sequence.ts';

function step(n: number, over: Partial<SequenceStep> = {}): SequenceStep {
  return { step: n, channel: 'email', delay_days: n === 1 ? 0 : 3, requires_approval: false, ...over };
}

// ---------------------------------------------------------------
// Steps
// ---------------------------------------------------------------

test('parseSteps reads a well-formed sequence', () => {
  const steps = parseSteps([
    { step: 1, channel: 'email', delay_days: 0, requires_approval: false },
    { step: 2, channel: 'email', delay_days: 3, requires_approval: true },
  ]);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[1], {
    step: 2,
    channel: 'email',
    delay_days: 3,
    requires_approval: true,
  });
});

test('parseSteps numbers steps by position, not by what the row claims', () => {
  const steps = parseSteps([
    { step: 7, channel: 'email', delay_days: 0, requires_approval: false },
  ]);
  assert.equal(steps[0]?.step, 1);
});

test('parseSteps converts the pre-0008 delay_hours shape', () => {
  const steps = parseSteps([
    { step: 1, channel: 'email', delay_hours: 0 },
    { step: 2, channel: 'email', delay_hours: 72 },
  ]);
  assert.equal(steps[1]?.delay_days, 3);
});

test('parseSteps refuses a sequence it cannot make sense of', () => {
  assert.deepEqual(parseSteps([{ step: 1, channel: 'carrier_pigeon', delay_days: 0 }]), []);
  assert.deepEqual(parseSteps([{ step: 1, channel: 'email', delay_days: -1 }]), []);
  assert.deepEqual(parseSteps('not an array' as never), []);
  assert.deepEqual(parseSteps(null), []);
});

test('parseSteps never reads a fifth step', () => {
  const steps = parseSteps(
    [1, 2, 3, 4, 5].map((n) => ({
      step: n,
      channel: 'email',
      delay_days: 1,
      requires_approval: false,
    }))
  );
  assert.equal(steps.length, MAX_STEPS);
});

test('stepsSchema refuses an empty sequence and a fifth step', () => {
  assert.equal(stepsSchema.safeParse([]).success, false);
  assert.equal(stepsSchema.safeParse([1, 2, 3, 4, 5].map((n) => step(n))).success, false);
  assert.equal(stepsSchema.safeParse([step(1), step(2)]).success, true);
});

test('stepsSchema refuses steps numbered out of order', () => {
  assert.equal(stepsSchema.safeParse([step(1), step(3)]).success, false);
});

// ---------------------------------------------------------------
// Which step is next
// ---------------------------------------------------------------

test('nextStep walks the sequence and stops at the end', () => {
  const steps = [step(1), step(2)];
  assert.equal(nextStep(steps, 0)?.step, 1);
  assert.equal(nextStep(steps, 1)?.step, 2);
  assert.equal(nextStep(steps, 2), null);
});

test('nextStep never returns a fifth step even if one is somehow stored', () => {
  const steps = [step(1), step(2), step(3), step(4), step(4)] as SequenceStep[];
  assert.equal(nextStep(steps, MAX_STEPS), null);
});

test('a one-step sequence is finished after its only step', () => {
  assert.equal(nextStep([step(1)], 1), null);
});

test('dueAt counts whole 24-hour days', () => {
  const from = new Date('2026-09-23T09:00:00.000Z');
  assert.equal(dueAt(from, 0), '2026-09-23T09:00:00.000Z');
  assert.equal(dueAt(from, 3), '2026-09-26T09:00:00.000Z');
});

test('formatDueDate shows the day as it falls in India, whatever the host zone', () => {
  // 22:30 UTC is 04:00 the next morning in Kolkata.
  const value = '2026-10-16T22:30:00.000Z';
  assert.equal(formatDueDate(value), '17 Oct');
  assert.equal(formatDueDate(value, { year: true }), '17 Oct 2026');
  // Just before IST midnight stays on the same day.
  assert.equal(formatDueDate('2026-10-16T18:29:00.000Z'), '16 Oct');
  // The year rolls over in India before it does in UTC.
  assert.equal(formatDueDate('2026-12-31T19:00:00.000Z', { year: true }), '1 Jan 2027');
  // September is "Sep" here even where ICU's en-GB data says "Sept".
  assert.equal(formatDueDate('2026-09-05T06:00:00.000Z'), '5 Sep');
  assert.equal(formatDueDate(null), '-');
  assert.equal(formatDueDate('not a date'), '-');
});

test('formatDueDate takes another zone when one is given', () => {
  assert.equal(formatDueDate('2026-10-16T22:30:00.000Z', { timeZone: 'UTC' }), '16 Oct');
  assert.equal(formatDueDate('2026-10-17T03:00:00.000Z', { timeZone: 'America/New_York' }), '16 Oct');
});

// ---------------------------------------------------------------
// When the next step is due: counted from the previous send
// ---------------------------------------------------------------

const NOW = new Date('2026-10-20T03:30:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let attemptIds = 0;

function attempt(status: string, over: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: `attempt-${++attemptIds}`,
    status,
    sent_at: null,
    created_at: daysAgo(1),
    block_reason: null,
    retry_of: null,
    ...over,
  };
}

/** A first send and its retries, each pointing at the one before; newest first. */
function retryChain(statuses: string[]): StepAttempt[] {
  const chain: StepAttempt[] = [];
  for (const status of statuses) {
    chain.push(attempt(status, { block_reason: 'resend 500', retry_of: chain.at(-1)?.id ?? null }));
  }
  return chain.reverse();
}

test('dueOn counts calendar days in India from the day of the send', () => {
  // 09:00 IST on the 14th, the daily pass.
  const sent = new Date('2026-10-14T03:30:05.000Z');
  assert.equal(dueOn(sent, 0), '2026-10-13T18:30:00.000Z', 'the start of the same day');
  assert.equal(dueOn(sent, 3), '2026-10-16T18:30:00.000Z', 'midnight IST on the 17th');
  // 01:30 IST on the 15th is already the 15th in India, though still the 14th in UTC.
  assert.equal(dueOn(new Date('2026-10-14T20:00:00.000Z'), 1), '2026-10-15T18:30:00.000Z');
  // Year end rolls over in India first.
  assert.equal(dueOn(new Date('2026-12-31T19:00:00.000Z'), 1), '2027-01-01T18:30:00.000Z');
});

test('a step sent seconds into a pass is due on the pass that many days later, not the one after', () => {
  const pass = (day: number) => new Date(Date.UTC(2026, 9, day, 3, 30, 0));
  // Sent five seconds after the pass on the 14th started.
  const sent = new Date(pass(14).getTime() + 5_000);
  const attempts: StepAttempt[] = [attempt('sent', { sent_at: sent.toISOString() })];
  assert.equal(stepReadiness(attempts, 3, pass(16)).kind, 'wait');
  assert.equal(stepReadiness(attempts, 3, pass(17)).kind, 'run');
  // The bare 72 hours would have missed the pass on the 17th.
  assert.ok(dueAt(sent, 3) > pass(17).toISOString());
});

test('dueOn finds midnight across a clock change in a zone that has one', () => {
  // New York leaves daylight time on 1 Nov 2026: midnight on the 1st is
  // 04:00 UTC, midnight on the 2nd is 05:00 UTC.
  assert.equal(dueOn(new Date('2026-10-31T12:00:00.000Z'), 1, 'America/New_York'), '2026-11-01T04:00:00.000Z');
  assert.equal(dueOn(new Date('2026-11-01T12:00:00.000Z'), 1, 'America/New_York'), '2026-11-02T05:00:00.000Z');
});

test('the delay counts from the send, not from when the step was queued', () => {
  // Queued ten days ago, approved and sent yesterday, three-day delay.
  const late = [attempt('sent', { created_at: daysAgo(10), sent_at: daysAgo(1) })];
  assert.deepEqual(stepReadiness(late, 3, NOW), {
    kind: 'wait',
    reason: 'not_due',
    at: dueOn(new Date(daysAgo(1)), 3),
  });

  const done = [attempt('sent', { created_at: daysAgo(10), sent_at: daysAgo(3) })];
  assert.equal(stepReadiness(done, 3, NOW).kind, 'run');
});

test('a step that has not been sent holds the lead, whatever the delay says', () => {
  for (const status of ['awaiting_approval', 'queued', 'sending']) {
    const ready = stepReadiness([attempt(status, { created_at: daysAgo(5) })], 0, NOW);
    assert.equal(ready.kind, 'wait', status);
    assert.equal((ready as { reason: string }).reason, status);
  }
});

test('an unapproved draft is looked at again on the day it expires, and expires then', () => {
  const waiting = stepReadiness([attempt('awaiting_approval', { created_at: daysAgo(5) })], 3, NOW);
  assert.deepEqual(waiting, {
    kind: 'wait',
    reason: 'awaiting_approval',
    at: dueOn(new Date(daysAgo(5)), STEP_EXPIRY_DAYS),
  });

  const old = [attempt('awaiting_approval', { created_at: daysAgo(STEP_EXPIRY_DAYS) })];
  assert.deepEqual(stepReadiness(old, 3, NOW), { kind: 'expire', status: 'awaiting_approval' });
});

test('a row stuck in sending expires; a queued row never does', () => {
  const stuck = [attempt('sending', { created_at: daysAgo(20), updated_at: daysAgo(15) })];
  assert.deepEqual(stepReadiness(stuck, 3, NOW), { kind: 'expire', status: 'sending' });

  // Claimed recently after a long wait for approval: measured from the claim.
  const fresh = [attempt('sending', { created_at: daysAgo(20), updated_at: daysAgo(1) })];
  assert.equal(stepReadiness(fresh, 3, NOW).kind, 'wait');

  const held = [attempt('queued', { created_at: daysAgo(60) })];
  assert.equal(stepReadiness(held, 3, NOW).kind, 'wait');
});

test('a rejected draft stops the run with its own reason, other blocks with theirs', () => {
  const rejected = [attempt('blocked', { block_reason: 'rejected_by_user' })];
  assert.deepEqual(stepReadiness(rejected, 3, NOW), { kind: 'stop', reason: 'step_rejected' });

  const consent = [attempt('blocked', { block_reason: 'insufficient_consent:US:email' })];
  assert.deepEqual(stepReadiness(consent, 3, NOW), { kind: 'stop', reason: 'step_blocked' });

  const expired = [attempt('blocked', { block_reason: 'step_expired' })];
  assert.deepEqual(stepReadiness(expired, 3, NOW), { kind: 'stop', reason: 'step_expired' });
});

test('a failed send is retried, and the run stops on the third failure along its retry chain', () => {
  const failed = (n: number) => retryChain(Array.from({ length: n }, () => 'failed'));
  assert.deepEqual(stepReadiness(failed(1), 3, NOW), { kind: 'retry', failures: 1 });
  assert.deepEqual(stepReadiness(failed(2), 3, NOW), { kind: 'retry', failures: 2 });
  assert.equal(MAX_SEND_ATTEMPTS, 3);
  assert.deepEqual(stepReadiness(failed(3), 3, NOW), { kind: 'stop', reason: 'step_failed' });
});

test('failures from an earlier enrolment do not count against a fresh draft of the step', () => {
  // Last enrolment: three failures, chained. This one: a fresh draft, no retry_of.
  const attempts = [attempt('failed'), ...retryChain(['failed', 'failed', 'failed'])];
  assert.equal(countFailures(attempts), 1);
  assert.deepEqual(stepReadiness(attempts, 3, NOW), { kind: 'retry', failures: 1 });
});

test('failed rows that are not on the chain are not counted, whatever they say', () => {
  // A manual draft for the same step that failed, between two links of the chain.
  const [second, first] = retryChain(['failed', 'failed']);
  const stray = attempt('failed');
  assert.equal(countFailures([second, stray, first]), 2);
});

test('a broken link ends the chain, and a loop in hand-edited rows ends the count', () => {
  // The row retried was deleted: only what is left is counted.
  assert.equal(countFailures([attempt('failed', { retry_of: 'gone' })]), 1);

  const a = attempt('failed', { id: 'a', retry_of: 'b' });
  const b = attempt('failed', { id: 'b', retry_of: 'a' });
  assert.equal(countFailures([a, b]), 2);
});

test('a step with no row at all stops the run as missing', () => {
  assert.deepEqual(stepReadiness([], 3, NOW), { kind: 'stop', reason: 'step_missing' });
});

test('the last step completes the run only once it has been sent', () => {
  assert.deepEqual(stepReadiness([attempt('sent', { sent_at: daysAgo(0) })], null, NOW), {
    kind: 'complete',
  });
  assert.equal(stepReadiness([attempt('awaiting_approval')], null, NOW).kind, 'wait');
  assert.deepEqual(stepReadiness([attempt('blocked', { block_reason: 'rejected_by_user' })], null, NOW), {
    kind: 'stop',
    reason: 'step_rejected',
  });
});

test('only the newest row for a step decides', () => {
  // Rejected once, then re-enrolled and sent: the send is what counts.
  const attempts = [
    attempt('sent', { sent_at: daysAgo(4) }),
    attempt('blocked', { block_reason: 'rejected_by_user', created_at: daysAgo(30) }),
  ];
  assert.equal(stepReadiness(attempts, 3, NOW).kind, 'run');
});

test('the tables say what a held lead is waiting on instead of showing a date', () => {
  const at = (status: string) => stepReadiness([attempt(status, { created_at: daysAgo(2) })], 3, NOW);
  assert.deepEqual(describeProgress(2, at('awaiting_approval'), daysAgo(-12)), {
    text: 'step 2 awaiting approval',
  });
  assert.deepEqual(describeProgress(2, at('queued'), daysAgo(-1)), { text: 'step 2 queued to send' });
  assert.deepEqual(describeProgress(2, at('failed'), daysAgo(-1)), {
    text: 'step 2 failed to send, retrying',
  });

  // Sent: the real due date, worked out from the send, not the next look.
  const sent = stepReadiness([attempt('sent', { sent_at: daysAgo(1) })], 3, NOW);
  assert.deepEqual(describeProgress(2, sent, daysAgo(-1)), { due: dueOn(new Date(daysAgo(1)), 3) });

  // Nothing read for the lead (step zero): its own date.
  assert.deepEqual(describeProgress(0, null, daysAgo(0)), { due: daysAgo(0) });
});

test('the stops for a step that never sent read as such', () => {
  assert.equal(describeStop('step_rejected'), 'stopped, step rejected');
  assert.equal(describeStop('step_failed'), 'stopped, step failed to send 3 times');
  assert.equal(describeStop('step_expired'), 'stopped, step not sent in 14 days');
  assert.equal(describeStop('step_missing'), 'stopped, step missing');
});

// ---------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------

const running = { stage: 'contacted', hasReply: false, hardBounced: false, suppression: null };

test('a lead mid-sequence with nothing against it keeps going', () => {
  assert.equal(stopReasonFrom(running), null);
  assert.equal(stopReasonFrom({ ...running, stage: 'engaged' }), null);
});

test('every one of the six stop conditions stops the run', () => {
  assert.equal(stopReasonFrom({ ...running, hasReply: true }), 'reply');
  assert.equal(stopReasonFrom({ ...running, suppression: 'unsubscribed' }), 'unsubscribed');
  assert.equal(stopReasonFrom({ ...running, hardBounced: true }), 'hard_bounce');
  assert.equal(stopReasonFrom({ ...running, suppression: 'complaint' }), 'complaint');
  assert.equal(stopReasonFrom({ ...running, stage: 'suppressed' }), 'suppressed');
  assert.equal(stopReasonFrom({ ...running, stage: 'meeting_booked' }), 'stage:meeting_booked');
  assert.equal(stopReasonFrom({ ...running, stage: 'won' }), 'stage:won');
  assert.equal(stopReasonFrom({ ...running, stage: 'lost' }), 'stage:lost');
});

test('a suppression outranks the rest, so the reason recorded is the standing one', () => {
  assert.equal(
    stopReasonFrom({ stage: 'engaged', hasReply: true, hardBounced: true, suppression: 'complaint' }),
    'complaint'
  );
});

test('stages that are not terminal do not stop a run', () => {
  for (const stage of ['sourced', 'qualified', 'parked', 'contacted', 'engaged']) {
    assert.equal(stopReasonFrom({ ...running, stage }), null, stage);
  }
});
