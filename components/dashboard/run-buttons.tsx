'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function RunButtons({ workspaceId }: { workspaceId: string }) {
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
        toast.success(`Queue: ${d.sent} sent, ${d.blocked} blocked, ${d.failed} failed.`);
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
        disabled={pending !== null}
        onClick={() => post('/api/queue/process', 'queue')}
      >
        {pending === 'queue' ? 'Processing' : 'Process send queue'}
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
