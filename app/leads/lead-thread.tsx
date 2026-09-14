'use client';

// app/leads/lead-thread.tsx
//
// Every message written for one lead, in date order, read end to end. Fetched
// on open rather than with the table, because a page of 100 leads carries far
// more history than anyone reads at once.

import * as React from 'react';

import {
  ActionDetail,
  LeadCard,
  MessageDialog,
  type LeadRef,
  type MessageAction,
} from '@/components/messages/message-dialog';

type Thread = { lead: LeadRef; actions: MessageAction[] };

export function LeadThread({
  leadId,
  fallbackName,
  onClose,
}: {
  leadId: string;
  fallbackName: string;
  onClose: () => void;
}) {
  const [thread, setThread] = React.useState<Thread | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // A close mid-flight must not write into an unmounted dialog.
    let live = true;
    setThread(null);
    setError(null);

    (async () => {
      try {
        const response = await fetch(`/api/leads/${leadId}/actions`);
        const payload = await response.json().catch(() => null);
        if (!live) return;
        if (!response.ok) {
          const reason = payload && typeof payload.error === 'string' ? payload.error : null;
          throw new Error(reason ?? `Request failed with ${response.status}`);
        }
        setThread(payload.data as Thread);
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'Could not load this conversation');
      }
    })();

    return () => {
      live = false;
    };
  }, [leadId]);

  const name = thread?.lead.full_name ?? thread?.lead.company_name ?? fallbackName;
  const count = thread?.actions.length ?? 0;

  return (
    <MessageDialog
      title={name}
      subtitle={
        thread
          ? count === 0
            ? 'No messages yet'
            : `${count} message${count === 1 ? '' : 's'}, oldest first`
          : undefined
      }
      onClose={onClose}
    >
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
          {error}
        </div>
      ) : !thread ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <LeadCard lead={thread.lead} />
          {thread.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has been drafted or sent to this lead yet.
            </p>
          ) : (
            thread.actions.map((action, index) => (
              <div key={action.id} className="rounded-lg border p-4">
                <div className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  {index + 1} of {thread.actions.length}
                </div>
                <ActionDetail action={action} />
              </div>
            ))
          )}
        </div>
      )}
    </MessageDialog>
  );
}
