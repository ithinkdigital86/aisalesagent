'use client';

// components/dashboard/recent-activity.tsx
//
// The dashboard's recent activity rows, each one opening the full message it
// stands for. Read-only: no editing, approving or sending from here.

import * as React from 'react';

import {
  ActionDetail,
  MessageDialog,
  leadLabel,
  oneLead,
  statusBadge,
  type LeadRef,
  type MessageAction,
} from '@/components/messages/message-dialog';

export type RecentAction = MessageAction & { lead: LeadRef | LeadRef[] | null };

export function RecentActivity({ actions }: { actions: RecentAction[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = actions.find((action) => action.id === openId) ?? null;
  const close = React.useCallback(() => setOpenId(null), []);

  return (
    <>
      <ul className="divide-y">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              onClick={() => setOpenId(action.id)}
              aria-label={`Read the ${action.channel} message for ${leadLabel(action.lead)}`}
              className="flex w-full items-center justify-between gap-3 rounded-md py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="min-w-0 px-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{action.channel}</span>
                  <span className="truncate">{leadLabel(action.lead)}</span>
                </div>
                {action.block_reason ? (
                  <div className="truncate text-xs text-destructive">{action.block_reason}</div>
                ) : action.subject ? (
                  <div className="truncate text-xs text-muted-foreground">{action.subject}</div>
                ) : null}
              </div>
              <span className={`${statusBadge(action.status)} mr-1`}>{action.status}</span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <MessageDialog
          title={open.subject || `${open.channel} message`}
          subtitle={leadLabel(open.lead)}
          onClose={close}
        >
          <ActionDetail action={open} lead={oneLead(open.lead)} />
        </MessageDialog>
      ) : null}
    </>
  );
}
