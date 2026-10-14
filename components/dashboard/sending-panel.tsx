'use client';

// components/dashboard/sending-panel.tsx
//
// The controls over unattended sending: the kill switch, today's sends
// against the daily cap, rows stuck mid-send, and the two limits. The numbers
// are read on the server and passed in; this only renders them and calls the
// actions in app/actions/sending.ts.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { saveSendingLimits, setSendingPaused } from '@/app/actions/sending';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface SendingPanelProps {
  workspaceId: string;
  paused: boolean;
  /** Already formatted on the server, so the text hydrates unchanged. */
  pausedAtLabel: string | null;
  dailyCap: number;
  minFitScore: number;
  sent: number;
  inFlight: number;
  /** When the oldest send in the window ages out, formatted. */
  freesAtLabel: string | null;
  stuck: number;
}

export function SendingPanel(props: SendingPanelProps) {
  const router = useRouter();
  const [switching, setSwitching] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [cap, setCap] = React.useState(String(props.dailyCap));
  const [minFit, setMinFit] = React.useState(String(props.minFitScore));

  const used = props.sent + props.inFlight;
  const full = used >= props.dailyCap;
  const pct = props.dailyCap > 0 ? Math.min(100, Math.round((used / props.dailyCap) * 100)) : 100;
  const dirty = cap !== String(props.dailyCap) || minFit !== String(props.minFitScore);

  async function toggle() {
    setSwitching(true);
    try {
      const result = await setSendingPaused({ workspaceId: props.workspaceId, paused: !props.paused });
      if (!result.ok) throw new Error(result.error ?? 'Could not change the kill switch');
      toast.success(props.paused ? 'Sending resumed.' : 'Sending paused. Nothing more will be sent.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSwitching(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await saveSendingLimits({
        workspaceId: props.workspaceId,
        dailySendCap: cap.trim() === '' ? Number.NaN : Number(cap),
        minFitScore: minFit.trim() === '' ? Number.NaN : Number(minFit),
      });
      if (!result.ok) throw new Error(result.error ?? 'Could not save the limits');
      toast.success('Limits saved.');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={`rounded-xl border p-5 ${props.paused ? 'border-destructive/50 bg-destructive/5' : ''}`}
      aria-labelledby="sending-controls-heading"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="sending-controls-heading" className="text-sm font-medium text-muted-foreground">
            Sending controls
          </h2>
          {props.paused ? (
            <p className="text-base font-medium text-destructive">
              Paused{props.pausedAtLabel ? ` since ${props.pausedAtLabel}` : ''}. Nothing is sent.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-base font-medium">
              <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden />
              Sending is on
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={props.paused ? 'default' : 'destructive'}
          disabled={switching}
          onClick={toggle}
        >
          {switching ? 'Working' : props.paused ? 'Resume sending' : 'Pause all sending'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Sent in the last 24 hours
          </div>
          <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
            {used} <span className="text-base font-normal text-muted-foreground">/ {props.dailyCap}</span>
          </div>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${full ? 'bg-amber-500' : 'bg-primary'}`}
              style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
            />
          </span>
          <p className="mt-2 text-xs text-muted-foreground">
            {props.inFlight > 0 ? `${props.inFlight} of these mid-send. ` : ''}
            {full
              ? `Cap reached: queued email waits${props.freesAtLabel ? ` until ${props.freesAtLabel}` : ''}.`
              : `${props.dailyCap - used} more can go before the cap.`}
          </p>
        </div>

        <div className={`rounded-lg border p-4 ${props.stuck > 0 ? 'border-destructive/50' : ''}`}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Stuck in sending over an hour
          </div>
          <div
            className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
              props.stuck > 0 ? 'text-destructive' : ''
            }`}
          >
            {props.stuck}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {props.stuck > 0
              ? 'The process stopped mid-send, so whether these went out is unknown. They are never retried automatically; check Resend before resending by hand.'
              : 'Nothing is stuck.'}
          </p>
        </div>
      </div>

      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="daily-send-cap">Daily send cap</Label>
          <Input
            id="daily-send-cap"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            value={cap}
            onChange={(event) => setCap(event.target.value)}
            className="w-32"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="min-fit-score">Minimum fit score</Label>
          <Input
            id="min-fit-score"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={minFit}
            onChange={(event) => setMinFit(event.target.value)}
            className="w-32"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={saving || !dirty}>
          {saving ? 'Saving' : 'Save limits'}
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          The cap counts emails over a rolling 24 hours; reaching it holds the rest in the queue
          rather than failing them. Leads below the minimum fit score, and leads not yet scored, are
          not drafted to or put on a sequence.
        </p>
      </form>
    </section>
  );
}
