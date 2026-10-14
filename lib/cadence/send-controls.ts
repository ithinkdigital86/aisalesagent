// lib/cadence/send-controls.ts
//
// The three limits a workspace puts on unattended sending (migration 0011):
// the kill switch, the daily send cap, and the minimum fit score. This module
// reads them and answers the questions the automation asks before it acts.
//
// Where each one is enforced, because no single place covers all three:
//
//  - Kill switch and cap: claim_email_send, the database function the email
//    adapter claims a row with. That is the only check that holds under
//    concurrency, and the only one a caller cannot forget. Everything here
//    about them is a cheaper look ahead of it: the send queue skips a paused
//    or full workspace instead of asking for every row, and the sequence
//    runner does not pay for a draft that could not be sent today.
//
//  - Minimum fit score: the drafting routes, enrolment, and the sequence
//    runner, before any model call. It is a rule about who is worth
//    contacting, not about consent, so it sits beside the consent gate rather
//    than inside it, and passing one never implies the other.
//
// Relative imports only, so node --test can load this file directly.

import type { SupabaseClient } from '@supabase/supabase-js';

import { DISPLAY_TIME_ZONE, dueOn, formatDueDate } from './sequence.ts';

/** A row in 'sending' longer than this is reported as stuck. */
export const STUCK_SENDING_MINUTES = 60;

export interface SendControls {
  workspaceId: string;
  paused: boolean;
  pausedAt: string | null;
  dailyCap: number;
  minFitScore: number;
}

const CONTROL_COLUMNS = 'id, sending_paused, sending_paused_at, daily_send_cap, min_fit_score';

type ControlRow = {
  id: string;
  sending_paused: boolean;
  sending_paused_at: string | null;
  daily_send_cap: number;
  min_fit_score: number;
};

function toControls(row: ControlRow): SendControls {
  return {
    workspaceId: row.id,
    paused: row.sending_paused,
    pausedAt: row.sending_paused_at,
    dailyCap: row.daily_send_cap,
    minFitScore: row.min_fit_score,
  };
}

/**
 * The workspace's controls, or null when the workspace cannot be read. A
 * caller that gets null must treat the workspace as paused: an unreadable
 * switch is not an open one.
 */
export async function loadSendControls(
  db: SupabaseClient,
  workspaceId: string
): Promise<SendControls | null> {
  const { data, error } = await db
    .from('workspaces')
    .select(CONTROL_COLUMNS)
    .eq('id', workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  return toControls(data as ControlRow);
}

/** Ids of every paused workspace, for passes that run across all of them. */
export async function pausedWorkspaceIds(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from('workspaces').select('id').eq('sending_paused', true);
  // A failed read must not let a paused workspace through. Throwing stops the
  // pass, which sends nothing; the next tick tries again.
  if (error) throw new Error(`could not read the kill switch: ${error.message}`);
  return (data ?? []).map((row) => row.id as string);
}

/** PostgREST's `not.in` list, for excluding paused workspaces from a query. */
export function inList(ids: string[]): string {
  return `(${ids.join(',')})`;
}

// ---------------------------------------------------------------
// Minimum fit score
// ---------------------------------------------------------------

export type FitVerdict =
  | { ok: true }
  | { ok: false; reason: 'unscored' | 'below_min_fit'; message: string };

/**
 * Whether a lead clears the workspace's minimum. An unscored lead never does,
 * including against a minimum of 0: no score means nobody has looked, and the
 * point of the rule is that somebody has.
 */
export function checkFit(score: number | null | undefined, minFitScore: number): FitVerdict {
  if (score === null || score === undefined) {
    return {
      ok: false,
      reason: 'unscored',
      message: 'not scored yet; run the Qualifier first',
    };
  }
  if (score < minFitScore) {
    return {
      ok: false,
      reason: 'below_min_fit',
      message: `fit score ${score} is below this workspace's minimum of ${minFitScore}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------
// The send window
// ---------------------------------------------------------------
//
// The cap counts the calendar day in India (migration 0013), not a rolling
// 24 hours. The send-queue cron runs once a day at the same time, and its
// sends land a few seconds into the run, so a rolling window still held them
// when the next day's run started and a workspace at its cap sent only every
// other day. The same reason the sequence timing counts calendar days.

export interface SendWindow {
  /** Emails sent today. */
  sent: number;
  /** Rows claimed today and not yet resolved. Counted against the cap. */
  inFlight: number;
  /** What the cap is measured against: sent + inFlight. */
  used: number;
  /**
   * The start of tomorrow, when the count starts again. A step deferred by
   * the cap is due again at this time.
   */
  resetsAt: string;
}

/**
 * The same count claim_email_send makes, read without the lock. Good for a
 * look ahead and for the dashboard; the function's own count is the one that
 * decides whether a row is sent.
 */
export async function loadSendWindow(
  db: SupabaseClient,
  workspaceId: string,
  now: Date = new Date()
): Promise<SendWindow> {
  const since = dueOn(now, 0);

  const [sentRes, flightRes] = await Promise.all([
    db
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('channel', 'email')
      .gte('sent_at', since),
    db
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('channel', 'email')
      .eq('status', 'sending')
      .gte('updated_at', since),
  ]);
  for (const res of [sentRes, flightRes]) {
    if (res.error) throw new Error(`could not count sends: ${res.error.message}`);
  }

  const sent = sentRes.count ?? 0;
  const inFlight = flightRes.count ?? 0;

  return { sent, inFlight, used: sent + inFlight, resetsAt: capResetsAt(now) };
}

/**
 * When the cap has room again after deferring something: the start of
 * tomorrow, when every slot frees at once, sends and stuck rows alike.
 */
export function capResetsAt(now: Date = new Date()): string {
  return dueOn(now, 1);
}

/** Email actions claimed more than an hour ago and never resolved. */
export async function countStuckSending(
  db: SupabaseClient,
  workspaceId: string,
  now: Date = new Date()
): Promise<number> {
  const before = new Date(now.getTime() - STUCK_SENDING_MINUTES * 60_000).toISOString();
  const { count, error } = await db
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'sending')
    .lt('updated_at', before);
  if (error) throw new Error(`could not count stuck sends: ${error.message}`);
  return count ?? 0;
}

const clockParts = new Map<string, Intl.DateTimeFormat>();

/**
 * "15 Oct 09:05", in the display zone. Same reasoning as formatDueDate: the
 * text renders on the server and hydrates in the browser, so it is built from
 * numeric parts in a fixed zone and nothing depends on either side's locale.
 */
export function formatSendTime(value: string | null, timeZone: string = DISPLAY_TIME_ZONE): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  let format = clockParts.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    clockParts.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${formatDueDate(value, { timeZone })} ${pad(part('hour'))}:${pad(part('minute'))}`;
}

/** Everything the dashboard panel and the page banners show. */
export interface SendStatus {
  controls: SendControls;
  window: SendWindow;
  stuck: number;
}

export async function loadSendStatus(
  db: SupabaseClient,
  workspaceId: string,
  now: Date = new Date()
): Promise<SendStatus | null> {
  const controls = await loadSendControls(db, workspaceId);
  if (!controls) return null;
  const [window, stuck] = await Promise.all([
    loadSendWindow(db, workspaceId, now),
    countStuckSending(db, workspaceId, now),
  ]);
  return { controls, window, stuck };
}
