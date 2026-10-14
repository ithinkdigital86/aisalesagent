// lib/cadence/sequence.ts
//
// The shape of a sequence and the rules that govern it: what a step is, which
// one comes next, when it falls due (counted from the previous step's send,
// never from when it was queued), and the conditions that end a run.
// Everything here is pure, so `npm test` can exercise the rules that decide
// whether a person gets a fifth message or keeps getting them after saying
// stop. The pass that touches the database is ./sequence-runner.ts.

import { z } from 'zod';

import type { Json } from '@/types/database';

/**
 * The hard cap. Four messages is where a cold sequence stops being follow-up
 * and starts generating complaints, and complaints cost the sending domain.
 * It is enforced here, in the save action, and as a check constraint in
 * migration 0008, because a fifth step written past the UI is the case the
 * application check cannot see.
 */
export const MAX_STEPS = 4;

/** A step cannot be scheduled further out than this. */
export const MAX_DELAY_DAYS = 365;

/** How many due leads one pass will drive. */
export const DUE_BATCH_LIMIT = 50;

// ---------------------------------------------------------------
// Step shape
// ---------------------------------------------------------------

export const CHANNELS = ['email', 'sms', 'voice', 'linkedin', 'instagram'] as const;

export const stepSchema = z.object({
  step: z.number().int().min(1).max(MAX_STEPS),
  channel: z.enum(CHANNELS),
  /** Days to wait after the previous step's send. Step one is normally 0. */
  delay_days: z.number().int().min(0).max(MAX_DELAY_DAYS),
  requires_approval: z.boolean(),
});

export type SequenceStep = z.infer<typeof stepSchema>;

/**
 * A saved sequence: at least one step, at most four, numbered in order. The
 * renumbering is done by the caller before validating, so a step removed from
 * the middle does not leave a gap the constraint would refuse.
 */
export const stepsSchema = z
  .array(stepSchema)
  .min(1, 'A sequence needs at least one step')
  .max(MAX_STEPS, `A sequence can have at most ${MAX_STEPS} steps`)
  .refine(
    (steps) => steps.every((step, index) => step.step === index + 1),
    'Steps must be numbered 1, 2, 3, 4 in order'
  );

/**
 * Read steps off a row. Tolerant on purpose: this runs against whatever is in
 * the column, including the pre-0008 `delay_hours` shape the original schema
 * comment described, and a row it cannot make sense of reads as no steps,
 * which the runner treats as a finished sequence rather than an exception.
 */
export function parseSteps(value: Json | null | undefined): SequenceStep[] {
  if (!Array.isArray(value)) return [];

  const steps: SequenceStep[] = [];
  for (const [index, raw] of value.entries()) {
    if (index >= MAX_STEPS) break;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];

    const row = raw as Record<string, unknown>;
    const legacyHours = typeof row.delay_hours === 'number' ? row.delay_hours : undefined;
    const parsed = stepSchema.safeParse({
      step: index + 1,
      channel: row.channel,
      delay_days:
        typeof row.delay_days === 'number'
          ? row.delay_days
          : legacyHours !== undefined
            ? Math.round(legacyHours / 24)
            : undefined,
      requires_approval: row.requires_approval === true,
    });
    if (!parsed.success) return [];
    steps.push(parsed.data);
  }
  return steps;
}

/** The step that runs next, or null when the sequence has nothing left. */
export function nextStep(steps: SequenceStep[], currentStep: number): SequenceStep | null {
  const wanted = currentStep + 1;
  if (wanted > MAX_STEPS) return null;
  return steps[wanted - 1] ?? null;
}

/**
 * The start of the day `days` calendar days after `from`'s day, as days fall
 * in a named zone. This is when a step falls due: its delay counts calendar
 * days from the previous step's send, not 24-hour periods.
 *
 * Counting to the second does not work with a pass that runs once a day. A
 * send happens a few seconds into the pass, so the send plus exactly three
 * days lands a few seconds after the pass three days later, and every
 * follow-up would slip a whole day. Counting days means a step sent on the
 * 14th with a three-day delay is due on the 17th, which is also the date the
 * tables show. Anything else a daily cron waits on (a deferral, enrolment,
 * the Follow-up manager's wait) counts the same way, for the same reason.
 */
export function dueOn(from: Date, days: number, timeZone: string = DISPLAY_TIME_ZONE): string {
  const { year, month, day } = zoneParts(from, timeZone);
  const midnightUtc = Date.UTC(year, month - 1, day + days);
  // The zone's midnight is the UTC midnight moved by the zone's offset. The
  // offset is read twice so a day that starts on a clock change lands right.
  const first = midnightUtc - zoneOffset(midnightUtc, timeZone);
  return new Date(midnightUtc - zoneOffset(first, timeZone)).toISOString();
}

/** When the next daily pass will look again: the start of tomorrow. */
export function nextPass(now: Date = new Date()): string {
  return dueOn(now, 1);
}

const zoneClocks = new Map<string, Intl.DateTimeFormat>();

function zoneParts(date: Date, timeZone: string) {
  let format = zoneClocks.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneClocks.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** How far the zone's clock is ahead of UTC at this instant, in ms. */
function zoneOffset(instant: number, timeZone: string): number {
  const p = zoneParts(new Date(instant), timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The zone due dates are shown in. Every workspace is IN today, so this is a
 * constant; when a workspace's jurisdiction should decide it, read the zone
 * from there and pass it to formatDueDate.
 */
export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

const dayParts = new Map<string, Intl.DateTimeFormat>();

/**
 * "16 Oct", or "16 Oct 2026" with the year, as the day falls in a named zone.
 * These dates render on the server and then hydrate in the browser, and any
 * difference in the text is a hydration failure, so nothing here depends on
 * either side's locale or zone: the zone is fixed, Intl supplies only the
 * numeric day, month and year in it, and the month names are our own, since
 * ICU versions disagree on some of them ("Sep" or "Sept").
 */
export function formatDueDate(
  value: string | null,
  options: { year?: boolean; timeZone?: string } = {}
): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const timeZone = options.timeZone ?? DISPLAY_TIME_ZONE;
  let format = dayParts.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    dayParts.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);

  const dayMonth = `${part('day')} ${MONTHS[part('month') - 1]}`;
  return options.year ? `${dayMonth} ${part('year')}` : dayMonth;
}

// ---------------------------------------------------------------
// The step already queued
// ---------------------------------------------------------------

/**
 * How many times one step may fail to send before the run stops. A failed
 * send is a Resend error, not a decision about the lead, so it is tried
 * again; three in a row is no longer transient.
 */
export const MAX_SEND_ATTEMPTS = 3;

/**
 * How long a step may sit awaiting approval, or stuck in 'sending', before
 * the run stops. Long enough to cover a holiday away from the approvals
 * queue, short enough that the draft is not stale by the time it goes.
 */
export const STEP_EXPIRY_DAYS = 14;

/** One action row written for a step, newest first when there are several. */
export interface StepAttempt {
  id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  updated_at?: string | null;
  block_reason: string | null;
  /** The failed row this one was queued to retry; null for a first attempt. */
  retry_of: string | null;
}

/** Stop reasons for a step that did not send. */
export type StepStopReason =
  | 'step_rejected'
  | 'step_blocked'
  | 'step_failed'
  | 'step_expired'
  | 'step_missing';

/**
 * What the step already queued means for the one after it.
 *
 *  - run       it was sent and the next step is due (since `at`)
 *  - complete  it was sent and it was the last step
 *  - wait      not yet: either the next step is not due (`not_due`), or the
 *              step has not sent and the lead is looked at again at `at`
 *  - retry     it failed to send and has failures left; queue it again
 *  - expire    it sat unsent too long; stop the run
 *  - stop      it will never send; stop the run
 */
export type StepReadiness =
  | { kind: 'run'; at: string }
  | { kind: 'complete' }
  | { kind: 'wait'; reason: 'not_due' | 'awaiting_approval' | 'queued' | 'sending'; at: string }
  | { kind: 'retry'; failures: number }
  | { kind: 'expire'; status: 'awaiting_approval' | 'sending' }
  | { kind: 'stop'; reason: StepStopReason };

/**
 * Failed sends along the newest attempt's retry chain: the newest row, the
 * row it retried (retry_of, migration 0012), that row's, and so on, counting
 * the failed ones. A first attempt has no retry_of, so the chain ends there,
 * and an earlier enrolment's failures never count against a fresh draft. A
 * link to a row not in `attempts` (deleted, or past the read limit) ends the
 * chain too, which can only undercount: one retry more, never a stop early.
 */
export function countFailures(attempts: StepAttempt[]): number {
  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  // A cycle cannot be written by the runner, which only ever points a new row
  // at an older one; `seen` is there so a hand-edited row cannot loop this.
  const seen = new Set<string>();
  let failures = 0;
  let current: StepAttempt | undefined = attempts[0];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.status === 'failed') failures += 1;
    current = current.retry_of ? byId.get(current.retry_of) : undefined;
  }
  return failures;
}

/**
 * The rule the fault was about: the next step's delay counts from when the
 * previous step was sent, and a lead whose previous step has not been sent is
 * not due at all. `attempts` are the rows for the previous step, newest first;
 * `nextDelayDays` is null when that step was the last.
 */
export function stepReadiness(
  attempts: StepAttempt[],
  nextDelayDays: number | null,
  now: Date = new Date()
): StepReadiness {
  const latest = attempts[0];
  // The insert that queued it failed, or the row was deleted. Not something
  // to wait on: nothing will ever arrive.
  if (!latest) return { kind: 'stop', reason: 'step_missing' };

  const sentAt = latest.sent_at ?? (latest.status === 'sent' ? latest.created_at : null);
  if (sentAt) {
    if (nextDelayDays === null) return { kind: 'complete' };
    const due = dueOn(new Date(sentAt), nextDelayDays);
    return due <= now.toISOString() ? { kind: 'run', at: due } : { kind: 'wait', reason: 'not_due', at: due };
  }

  switch (latest.status) {
    case 'awaiting_approval': {
      const expires = dueOn(new Date(latest.created_at), STEP_EXPIRY_DAYS);
      if (expires <= now.toISOString()) return { kind: 'expire', status: 'awaiting_approval' };
      // Approving or rejecting moves the lead's date to now, so this date is
      // only the fallback: the day the draft expires.
      return { kind: 'wait', reason: 'awaiting_approval', at: expires };
    }
    case 'sending': {
      const since = latest.updated_at ?? latest.created_at;
      if (dueOn(new Date(since), STEP_EXPIRY_DAYS) <= now.toISOString()) {
        return { kind: 'expire', status: 'sending' };
      }
      return { kind: 'wait', reason: 'sending', at: nextPass(now) };
    }
    case 'queued':
      // Only the kill switch or the daily cap holds a queued row, and both
      // clear on their own, so there is no expiry: it will go.
      return { kind: 'wait', reason: 'queued', at: nextPass(now) };
    case 'failed': {
      const failures = countFailures(attempts);
      return failures >= MAX_SEND_ATTEMPTS
        ? { kind: 'stop', reason: 'step_failed' }
        : { kind: 'retry', failures };
    }
    case 'blocked':
      // A person said no to this draft. It is not necessarily a no to the
      // lead, so the reason is its own and the lead can be enrolled again.
      if (latest.block_reason === 'rejected_by_user') return { kind: 'stop', reason: 'step_rejected' };
      // Blocked by the runner itself when it expired, and the stop that
      // should have followed did not land.
      if (latest.block_reason === 'step_expired') return { kind: 'stop', reason: 'step_expired' };
      return { kind: 'stop', reason: 'step_blocked' };
    default:
      return { kind: 'stop', reason: 'step_blocked' };
  }
}

/**
 * What the tables show for a running lead: a sentence when the lead is held
 * on a step that has not sent, otherwise the date the next step is due.
 * `step` is the lead's sequence_step, the step already queued.
 */
export type SequenceProgress = { text: string } | { due: string | null };

export function describeProgress(
  step: number,
  readiness: StepReadiness | null,
  nextActionAt: string | null
): SequenceProgress {
  if (!readiness) return { due: nextActionAt };
  switch (readiness.kind) {
    case 'run':
      return { due: readiness.at };
    case 'complete':
      return { text: 'all steps sent' };
    case 'wait':
      if (readiness.reason === 'not_due') return { due: readiness.at };
      if (readiness.reason === 'awaiting_approval') return { text: `step ${step} awaiting approval` };
      if (readiness.reason === 'queued') return { text: `step ${step} queued to send` };
      return { text: `step ${step} sending` };
    case 'retry':
      return { text: `step ${step} failed to send, retrying` };
    case 'expire':
      return { text: `step ${step} not sent in ${STEP_EXPIRY_DAYS} days, stopping` };
    case 'stop':
      return { text: `step ${step} not sent, stopping` };
  }
}

// ---------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------

/**
 * Stages that end a sequence. A lead that booked a meeting, bought, or said
 * no is not someone to keep touching on a schedule.
 */
export const TERMINAL_STAGES = ['meeting_booked', 'won', 'lost'] as const;

export interface StopSignals {
  stage: string;
  /** Any action on this lead carries a reply. */
  hasReply: boolean;
  /** A permanent bounce was recorded against an action on this lead. */
  hardBounced: boolean;
  /** The reason on the lead's suppression_list row, when there is one. */
  suppression: string | null;
}

/**
 * The one place the stop rules live, kept pure so they can be exercised
 * directly. Order is by consequence, not by likelihood: a suppression is a
 * standing instruction and outranks anything else the row happens to say.
 */
export function stopReasonFrom(signals: StopSignals): string | null {
  if (signals.suppression) return signals.suppression;
  if (signals.stage === 'suppressed') return 'suppressed';
  if (signals.hardBounced) return 'hard_bounce';
  if (signals.hasReply) return 'reply';
  if ((TERMINAL_STAGES as readonly string[]).includes(signals.stage)) return `stage:${signals.stage}`;
  return null;
}

/** Human wording for a stop reason, for the leads and sequences tables. */
export function describeStop(reason: string): string {
  if (reason.startsWith('stage:')) return `stopped at ${reason.slice(6).replace('_', ' ')}`;
  const words: Record<string, string> = {
    reply: 'stopped on reply',
    unsubscribed: 'stopped on unsubscribe',
    hard_bounce: 'stopped on hard bounce',
    complaint: 'stopped on complaint',
    suppressed: 'stopped, lead suppressed',
    completed: 'finished all steps',
    sequence_inactive: 'stopped, sequence paused',
    sequence_missing: 'stopped, sequence deleted',
    step_rejected: 'stopped, step rejected',
    step_blocked: 'stopped, step blocked',
    step_failed: `stopped, step failed to send ${MAX_SEND_ATTEMPTS} times`,
    step_expired: `stopped, step not sent in ${STEP_EXPIRY_DAYS} days`,
    step_missing: 'stopped, step missing',
  };
  return words[reason] ?? `stopped: ${reason}`;
}
