'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { formatSendTime } from '@/lib/cadence/send-controls';

type Held = { reason: 'sending_paused' | 'daily_cap_reached'; retryAt: string | null; waiting: number };

/** What the cap or the switch held back, for the end of the toast. */
function describeHeld(held: Held | null): string {
  if (!held) return '';
  if (held.reason === 'sending_paused') return ' Sending was paused during the run.';
  const when = held.retryAt ? ` until ${formatSendTime(held.retryAt)}` : '';
  return ` Daily cap reached: ${held.waiting} queued email${held.waiting === 1 ? '' : 's'} wait${
    held.waiting === 1 ? 's' : ''
  }${when}.`;
}

export function RunButtons({ workspaceId, paused }: { workspaceId: string; paused: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<null | 'queue' | 'manager'>(null);

  async function post(url: string, kind: 'queue' | 'manager') {
    setPending(kind);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Request failed');
      }
      if (kind === 'queue') {
        const d = payload.data;
        const summary = `Queue: ${d.sent} sent, ${d.blocked} blocked, ${d.failed} failed.${describeHeld(d.held)}`;
        if (d.held) toast.warning(summary);
        else toast.success(summary);
      } else {
        toast.success('Sales Manager ran.');
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={pending !== null || paused}
        title={paused ? 'Sending is paused. Resume it below first.' : undefined}
        onClick={() => post('/api/queue/process', 'queue')}
      >
        {pending === 'queue' ? 'Processing' : paused ? 'Sending paused' : 'Process send queue'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending !== null}
        onClick={() => post('/api/agents/sales-manager', 'manager')}
      >
        {pending === 'manager' ? 'Running' : 'Run Sales Manager'}
      </Button>
    </div>
  );
}
