// components/sending/sending-banner.tsx
//
// The sending state, on every page that can send or queue something to send:
// whether the kill switch is on, and how much of the daily cap is used. The
// switch itself lives on the dashboard; this only says where it stands and
// links there. A server component, rendered from the page's own read.

import Link from 'next/link';

import { formatSendTime, type SendStatus } from '@/lib/cadence/send-controls';

export function SendingBanner({
  status,
  linkToDashboard = true,
}: {
  status: SendStatus | null;
  /** False on the dashboard itself, where the controls are right below. */
  linkToDashboard?: boolean;
}) {
  const link = linkToDashboard ? (
    <Link href="/" className="text-foreground underline underline-offset-4">
      Sending controls
    </Link>
  ) : null;

  if (!status) {
    return (
      <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <span className="font-medium text-destructive">Sending state could not be read. </span>
        <span className="text-muted-foreground">Treated as paused: nothing is sent until it can be. </span>
        {link}
      </div>
    );
  }

  const { controls, window, stuck } = status;

  if (controls.paused) {
    return (
      <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <span className="font-medium text-destructive">Sending is paused</span>
        <span className="text-muted-foreground">
          {controls.pausedAt ? ` since ${formatSendTime(controls.pausedAt)}` : ''}. No email is sent and
          sequences do not advance. Anything queued waits and goes once sending is resumed.{' '}
        </span>
        {link}
      </div>
    );
  }

  const full = window.used >= controls.dailyCap;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2 text-sm ${
        full ? 'border-amber-500/50 bg-amber-500/5' : ''
      }`}
    >
      <span className="inline-flex items-center gap-2">
        <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden />
        <span className="font-medium">Sending is on</span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {window.used} of {controls.dailyCap} emails in the last 24 hours
      </span>
      {full ? (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          Daily cap reached; queued email waits
          {window.freesAt ? ` until ${formatSendTime(window.freesAt)}` : ''}.
        </span>
      ) : null}
      {stuck > 0 ? (
        <span className="text-xs text-destructive">
          {stuck} stuck in sending for over an hour
        </span>
      ) : null}
      <span className="font-mono text-xs text-muted-foreground">min fit {controls.minFitScore}</span>
      {link ? <span className="ml-auto text-xs">{link}</span> : null}
    </div>
  );
}
