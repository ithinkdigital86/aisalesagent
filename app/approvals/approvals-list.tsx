'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type LeadRef = { full_name: string | null; company_name: string | null };

type ApprovalAction = {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  step_number: number | null;
  created_at: string;
  lead: LeadRef | LeadRef[] | null;
};

function leadName(lead: ApprovalAction['lead']): string {
  const one = Array.isArray(lead) ? lead[0] : lead;
  return one?.full_name ?? one?.company_name ?? 'Unknown lead';
}

export function ApprovalsList({ actions }: { actions: ApprovalAction[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, { subject: string; body: string }>>(
    () =>
      Object.fromEntries(
        actions.map((action) => [
          action.id,
          { subject: action.subject ?? '', body: action.body },
        ])
      )
  );

  function setDraft(id: string, key: 'subject' | 'body', value: string) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }));
  }

  async function call(
    id: string,
    intent: 'approve' | 'reject' | 'edit',
    extra?: { subject?: string; body?: string }
  ) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/actions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent, ...extra }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Action failed');
      }
      toast.success(
        intent === 'edit'
          ? 'Saved.'
          : intent === 'reject'
            ? 'Rejected.'
            : 'Approved.'
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPendingId(null);
    }
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nothing waiting for approval. Draft messages appear here when an agent needs a human, and
        for LinkedIn, Instagram, and voice.{' '}
        <Link href="/leads" className="text-foreground underline underline-offset-4">
          Go to leads
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {actions.map((action) => {
        const draft = drafts[action.id] ?? { subject: action.subject ?? '', body: action.body };
        const busy = pendingId === action.id;
        return (
          <Card key={action.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                    {action.channel}
                  </span>
                  <span className="text-sm font-medium">{leadName(action.lead)}</span>
                </div>
                {action.step_number ? (
                  <span className="text-xs text-muted-foreground">step {action.step_number}</span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {action.channel === 'email' ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`subject-${action.id}`}>Subject</Label>
                  <Input
                    id={`subject-${action.id}`}
                    value={draft.subject}
                    onChange={(e) => setDraft(action.id, 'subject', e.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <Label htmlFor={`body-${action.id}`}>Message</Label>
                <Textarea
                  id={`body-${action.id}`}
                  className="min-h-40 font-mono text-xs"
                  value={draft.body}
                  onChange={(e) => setDraft(action.id, 'body', e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => call(action.id, 'approve')}
                >
                  {busy ? 'Working' : action.channel === 'email' ? 'Approve and send' : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    call(action.id, 'edit', { subject: draft.subject, body: draft.body })
                  }
                >
                  Save edits
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => call(action.id, 'reject')}
                >
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
