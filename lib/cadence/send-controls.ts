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

import { DISPLAY_TIME_ZONE, formatDueDate } from './sequence.ts';

/** The cap counts sends in this many trailing hours. Matches the SQL. */
export const SEND_WINDOW_HOURS = 24;

/** A row in 'sending' longer than this is reported as stuck. */
export const STUCK_SENDING_MINUTES = 60;

const HOUR_MS = 3_600_000;

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

export interface SendWindow {
  /** Emails whose sent_at falls in the window. */
  sent: number;
  /** Rows claimed in the window and not yet resolved. Counted against the cap. */
  inFlight: number;
  /** What the cap is measured against: sent + inFlight. */
  used: number;
  /**
   * When the oldest send in the window ages out and frees a slot, or null
   * when the window is empty. A deferred step is due again at this time.
   */
  freesAt: string | null;
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
  const since = new Date(now.getTime() - SEND_WINDOW_HOURS * HOUR_MS).toISOString();

  const [sentRes, flightRes, oldestRes] = await Promise.all([
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
    db
      .from('actions')
      .select('sent_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'email')
      .gte('sent_at', since)
      .order('sent_at', { ascending: true })
      .limit(1),
  ]);
  for (const res of [sentRes, flightRes, oldestRes]) {
    if (res.error) throw new Error(`could not count sends: ${res.error.message}`);
  }

  const sent = sentRes.count ?? 0;
  const inFlight = flightRes.count ?? 0;
  const oldest = (oldestRes.data?.[0] as { sent_at: string } | undefined)?.sent_at ?? null;

  return {
    sent,
    inFlight,
    used: sent + inFlight,
    freesAt: oldest ? new Date(new Date(oldest).getTime() + SEND_WINDOW_HOURS * HOUR_MS).toISOString() : null,
  };
}

/**
 * When to look again after the cap deferred something. The oldest send's
 * expiry when there is one; otherwise an hour out, which only happens when
 * the window is full of in-flight rows or the cap is 0.
 */
export function retryAfterCap(window: SendWindow, now: Date = new Date()): string {
  if (window.freesAt && new Date(window.freesAt).getTime() > now.getTime()) return window.freesAt;
  return new Date(now.getTime() + HOUR_MS).toISOString();
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
