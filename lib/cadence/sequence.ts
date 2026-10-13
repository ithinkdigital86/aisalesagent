// lib/cadence/sequence.ts
//
// The shape of a sequence and the rules that govern it: what a step is, which
// one comes next, when it falls due, and the six conditions that end a run.
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

/** When a step with this delay falls due, counted from the previous send. */
export function dueAt(from: Date, delayDays: number): string {
  return new Date(from.getTime() + delayDays * 86_400_000).toISOString();
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
  };
  return words[reason] ?? `stopped: ${reason}`;
}
