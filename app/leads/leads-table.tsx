'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

type Lead = {
  id: string;
  full_name: string | null;
  company_name: string | null;
  title: string | null;
  stage: string;
  fit_score: number | null;
  fit_reasoning: string | null;
  email: string | null;
};

const STAGES = [
  'sourced',
  'qualified',
  'parked',
  'contacted',
  'engaged',
  'meeting_booked',
  'won',
  'lost',
  'suppressed',
];

// The Qualifier route accepts at most 50 lead ids per call.
const MAX_QUALIFY = 50;
// Drafting spends an Opus call per lead, so keep a batch small.
const MAX_DRAFT = 10;

/** One failed lead in a batch, kept so the run can say what went wrong. */
type Failure = { leadId: string; label: string; reason: string };

function describeLead(lead: Lead | undefined, leadId: string): string {
  if (!lead) return leadId;
  return lead.full_name ?? lead.company_name ?? leadId;
}

/** Pull a readable reason out of whatever the route returned. */
function reasonFrom(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim() !== '') return error;
  }
  return fallback;
}

export function LeadsTable({
  workspaceId,
  leads,
  stage,
  sort,
}: {
  workspaceId: string;
  leads: Lead[];
  stage: string;
  sort: 'fit_asc' | 'fit_desc';
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState(false);
  const [drafting, setDrafting] = React.useState(false);
  const [draftingLinkedIn, setDraftingLinkedIn] = React.useState(false);
  const [failures, setFailures] = React.useState<Failure[]>([]);
  const [failedRun, setFailedRun] = React.useState<string | null>(null);

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const byId = React.useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const failedIds = React.useMemo(
    () => new Set(failures.map((failure) => failure.leadId)),
    [failures]
  );

  function report(run: string, found: Failure[], total: number, hint?: string) {
    setFailures(found);
    setFailedRun(found.length > 0 ? run : null);
    const ok = total - found.length;
    if (found.length === 0) {
      toast.success(`${run}: ${ok} of ${total} succeeded.${hint ? ` ${hint}` : ''}`);
    } else {
      toast.error(`${run}: ${ok} of ${total} succeeded, ${found.length} failed. See the list below.`);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === leads.length ? new Set() : new Set(leads.map((lead) => lead.id))
    );
  }

  function updateQuery(next: { stage?: string; sort?: string }) {
    const nextStage = next.stage ?? stage;
    const nextSort = next.sort ?? sort;
    const params = new URLSearchParams();
    if (nextStage && nextStage !== 'all') params.set('stage', nextStage);
    if (nextSort) params.set('sort', nextSort);
    const query = params.toString();
    router.push(query ? `/leads?${query}` : '/leads');
  }

  async function runQualifier() {
    const leadIds = [...selected];
    if (leadIds.length === 0) return;
    if (leadIds.length > MAX_QUALIFY) {
      toast.error(`Select at most ${MAX_QUALIFY} leads to qualify at once.`);
      return;
    }

    setPending(true);
    try {
      const response = await fetch('/api/agents/qualifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, leadIds }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(reasonFrom(payload, 'Qualifier failed'));
      }

      // The route scores each lead independently, so a batch can be part
      // successful. Name the ones that failed instead of reporting a count.
      const results: Array<{ leadId: string; ok: boolean; error?: string }> = Array.isArray(
        payload.data
      )
        ? payload.data
        : [];

      const found: Failure[] = results
        .filter((result) => !result.ok)
        .map((result) => ({
          leadId: result.leadId,
          label: describeLead(byId.get(result.leadId), result.leadId),
          reason: result.error ?? 'no reason given',
        }));

      report('Qualifier', found, leadIds.length);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  /**
   * One request per lead, so one lead failing must not hide the rest. Each
   * failure keeps the reason the route gave, which now names the offending
   * field rather than saying the shape was unexpected.
   */
  async function draft(options: {
    url: string;
    run: string;
    hint: string;
    setBusy: (value: boolean) => void;
  }) {
    const leadIds = [...selected];
    if (leadIds.length === 0) return;
    if (leadIds.length > MAX_DRAFT) {
      toast.error(`Draft at most ${MAX_DRAFT} at once.`);
      return;
    }

    options.setBusy(true);
    const found: Failure[] = [];
    try {
      for (const leadId of leadIds) {
        try {
          const response = await fetch(options.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceId, leadId }),
          });
          if (response.ok) continue;

          const payload = await response.json().catch(() => null);
          found.push({
            leadId,
            label: describeLead(byId.get(leadId), leadId),
            reason: reasonFrom(payload, `request failed with ${response.status}`),
          });
        } catch (err) {
          found.push({
            leadId,
            label: describeLead(byId.get(leadId), leadId),
            reason: err instanceof Error ? err.message : 'network error',
          });
        }
      }

      report(options.run, found, leadIds.length, options.hint);
      setSelected(new Set());
      router.refresh();
    } finally {
      options.setBusy(false);
    }
  }

  const draftEmails = () =>
    draft({
      url: '/api/agents/email-specialist',
      run: 'Email drafts',
      hint: 'Process the send queue from the dashboard to send.',
      setBusy: setDrafting,
    });

  const draftLinkedIn = () =>
    draft({
      url: '/api/agents/linkedin-specialist',
      run: 'LinkedIn drafts',
      hint: 'Review them in the approval queue.',
      setBusy: setDraftingLinkedIn,
    });

  const busy = pending || drafting || draftingLinkedIn;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Stage
          <select
            value={stage}
            onChange={(event) => updateQuery({ stage: event.target.value })}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="all">All stages</option>
            {STAGES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <Button
          variant="outline"
          size="sm"
          onClick={() => updateQuery({ sort: sort === 'fit_desc' ? 'fit_asc' : 'fit_desc' })}
        >
          Fit score {sort === 'fit_desc' ? 'high to low' : 'low to high'}
        </Button>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={draftEmails}
          >
            {drafting ? 'Drafting' : 'Draft emails'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || selected.size === 0}
            onClick={draftLinkedIn}
          >
            {draftingLinkedIn ? 'Drafting' : 'Draft LinkedIn'}
          </Button>
          <Button size="sm" disabled={busy || selected.size === 0} onClick={runQualifier}>
            {pending ? 'Running' : 'Run Qualifier'}
          </Button>
        </div>
      </div>

      {failures.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="text-sm font-medium text-foreground">
              {failedRun}: {failures.length} lead{failures.length === 1 ? '' : 's'} failed
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFailures([]);
                setFailedRun(null);
              }}
            >
              Dismiss
            </Button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {failures.map((failure) => (
              <li key={failure.leadId} className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{failure.label}</span>: {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No leads for this filter yet. Run{' '}
          <Link href="/sourcing" className="text-foreground underline underline-offset-4">
            sourcing
          </Link>{' '}
          to add some.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all leads"
                    className="size-4 accent-primary"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Fit</th>
                <th className="px-3 py-2 font-medium">Reasoning</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={
                    failedIds.has(lead.id) ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-muted/30'
                  }
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                      aria-label={`Select ${lead.full_name ?? 'lead'}`}
                      className="size-4 accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{lead.full_name ?? '-'}</div>
                    <div className="text-xs text-muted-foreground">{lead.company_name ?? '-'}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{lead.title ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                      {lead.stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">{lead.fit_score ?? '-'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <div className="max-w-[24rem] truncate" title={lead.fit_reasoning ?? ''}>
                      {lead.fit_reasoning ?? '-'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
