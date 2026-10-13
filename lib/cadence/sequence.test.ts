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
  MAX_STEPS,
  dueAt,
  formatDueDate,
  nextStep,
  parseSteps,
  stepsSchema,
  stopReasonFrom,
  type SequenceStep,
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

test('dueAt counts whole days from the previous send', () => {
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
