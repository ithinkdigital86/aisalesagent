'use client';

// components/messages/message-dialog.tsx
//
// Read-only viewing of a drafted or sent message. Nothing here writes: the
// approval queue stays the only place a draft can be changed.

import * as React from 'react';

import { Button } from '@/components/ui/button';

export type LeadRef = {
  full_name: string | null;
  company_name: string | null;
  title?: string | null;
  email?: string | null;
  stage?: string | null;
};

/** Everything the viewer needs about one outbound attempt. */
export type MessageAction = {
  id: string;
  channel: string;
  status: string;
  agent: string | null;
  step_number: number | null;
  subject: string | null;
  body: string;
  /**
   * Style rules the draft still broke after its corrective retry, as the
   * runtime recorded them. [] is checked and clean. null is never checked: an
   * action from before the review existed, or an agent that declares none.
   * Typed loosely because it arrives as a jsonb column, and narrowed on read.
   */
  ai_tells?: unknown;
  block_reason: string | null;
  created_at: string;
  scheduled_for: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_body: string | null;
  reply_sentiment: string | null;
};

/**
 * The join comes back as an object or a one-element array, depending on how
 * PostgREST resolves the relationship.
 */
export function oneLead(lead: LeadRef | LeadRef[] | null | undefined): LeadRef | null {
  const one = Array.isArray(lead) ? lead[0] : lead;
  return one ?? null;
}

export function leadLabel(lead: LeadRef | LeadRef[] | null | undefined): string {
  const one = oneLead(lead);
  return one?.full_name ?? one?.company_name ?? 'Unknown lead';
}

export function statusBadge(status: string): string {
  const base = 'shrink-0 rounded-md px-2 py-0.5 font-mono text-xs ';
  if (status === 'sent') return `${base}bg-primary text-primary-foreground`;
  if (status === 'blocked' || status === 'failed') return `${base}bg-destructive/10 text-destructive`;
  if (status === 'awaiting_approval') return `${base}border`;
  return `${base}bg-secondary text-secondary-foreground`;
}

/** Rendered client-side only, after a click, so the viewer's own locale is safe. */
function formatWhen(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** One rule a draft breaks, in the shape the runtime writes it. */
type AiTell = { rule: string; found: string };

/**
 * The jsonb column as a list, or null when the draft was never checked. A
 * malformed entry is dropped rather than rendered as "undefined".
 */
function readTells(value: unknown): AiTell[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (item): item is AiTell =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as AiTell).rule === 'string' &&
      typeof (item as AiTell).found === 'string'
  );
}

/**
 * The webhook writes a bounce into the same column the consent gate uses for a
 * block, prefixed so the two can still be told apart.
 */
function reasonLabel(reason: string): string {
  return reason.startsWith('bounce:') ? 'Bounce reason' : 'Block reason';
}

/** Modal shell. Escape or the backdrop closes it; the body scrolls, not the page. */
export function MessageDialog({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85svh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate font-display text-lg font-semibold tracking-tight">{title}</h2>
            {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** A body long enough to stretch the panel scrolls inside its own box. */
function LongText({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 font-sans text-sm leading-relaxed">
      {text}
    </pre>
  );
}

/** The lead a message was written for. */
export function LeadCard({ lead }: { lead: LeadRef }) {
  const line = [lead.title, lead.company_name].filter(Boolean).join(' · ');
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Lead</div>
      <div className="mt-1 text-sm font-medium">
        {lead.full_name ?? lead.company_name ?? 'Unknown lead'}
      </div>
      {line ? <div className="text-sm text-muted-foreground">{line}</div> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
        {lead.email ? <span className="break-all">{lead.email}</span> : null}
        {lead.stage ? (
          <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
            {lead.stage}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** One action in full: subject, body, status, timings, reason, reply. */
export function ActionDetail({
  action,
  lead,
}: {
  action: MessageAction;
  lead?: LeadRef | null;
}) {
  const replied = Boolean(action.replied_at || action.reply_body);
  const tells = readTells(action.ai_tells);
  return (
    <article className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
          {action.channel}
        </span>
        <span className={statusBadge(action.status)}>{action.status}</span>
        {action.step_number ? (
          <span className="font-mono text-xs text-muted-foreground">step {action.step_number}</span>
        ) : null}
        {action.agent ? (
          <span className="font-mono text-xs text-muted-foreground">{action.agent}</span>
        ) : null}
      </div>

      {lead ? <LeadCard lead={lead} /> : null}

      {action.channel === 'email' ? (
        <Field label="Subject">
          <span className="break-words">{action.subject || '—'}</span>
        </Field>
      ) : null}

      <Field label="Message">
        <LongText text={action.body} />
      </Field>

      {tells && tells.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400">
            {tells.length === 1 ? 'Reads as machine-written' : `Reads as machine-written (${tells.length})`}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The draft still broke these rules after its rewrite. It was kept rather than binned,
            so read it before it goes out.
          </p>
          <ul className="mt-2 space-y-1.5">
            {tells.map((tell, index) => (
              <li key={`${tell.rule}-${index}`} className="text-sm">
                <span className="text-muted-foreground">{tell.rule}: </span>
                <span className="break-words font-mono text-xs">“{tell.found}”</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Queued</dt>
          <dd className="mt-0.5 font-mono text-xs">{formatWhen(action.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Scheduled</dt>
          <dd className="mt-0.5 font-mono text-xs">{formatWhen(action.scheduled_for)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Sent</dt>
          <dd className="mt-0.5 font-mono text-xs">{formatWhen(action.sent_at)}</dd>
        </div>
      </dl>

      {action.block_reason ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-destructive">
            {reasonLabel(action.block_reason)}
          </div>
          <p className="mt-1 break-words text-sm text-muted-foreground">{action.block_reason}</p>
        </div>
      ) : null}

      {replied ? (
        <div className="rounded-md border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Reply</span>
            {action.reply_sentiment ? (
              <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                {action.reply_sentiment}
              </span>
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">
              {formatWhen(action.replied_at)}
            </span>
          </div>
          <div className="mt-2">
            {action.reply_body ? (
              <LongText text={action.reply_body} />
            ) : (
              <p className="text-sm text-muted-foreground">
                A reply was recorded, but its text was not captured.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}
