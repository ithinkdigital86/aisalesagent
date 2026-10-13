'use client';

// The sequences page. Create and edit sequences, and read which leads are on
// which step of each one.
//
// The four-step cap is visible rather than enforced silently: the add button
// disappears at four and says why, because a rule a person only discovers by
// having a save refused is a worse rule.

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { saveSequence, setSequenceActive } from '@/app/actions/sequences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CHANNELS,
  MAX_STEPS,
  describeStop,
  formatDueDate,
  type SequenceStep,
} from '@/lib/cadence/sequence';

export interface SequenceRow {
  id: string;
  name: string;
  active: boolean;
  steps: SequenceStep[];
  sentCount: number;
  replyCount: number;
  meetingCount: number;
}

export interface EnrolledLead {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  sequenceId: string;
  step: number;
  stoppedReason: string | null;
  nextActionAt: string | null;
}

/** A sensible second touch: three days later, on the same channel. */
function blankStep(number: number): SequenceStep {
  return {
    step: number,
    channel: 'email',
    delay_days: number === 1 ? 0 : 3,
    requires_approval: false,
  };
}

function describeStep(step: SequenceStep): string {
  const when = step.delay_days === 0 ? 'immediately' : `after ${step.delay_days}d`;
  return `${step.channel} ${when}${step.requires_approval ? ', approval' : ''}`;
}

export function SequenceManager({
  workspaceId,
  sequences,
  enrolled,
}: {
  workspaceId: string;
  sequences: SequenceRow[];
  enrolled: EnrolledLead[];
}) {
  const router = useRouter();
  /** The sequence open in the editor: an id, 'new', or null for closed. */
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const bySequence = React.useMemo(() => {
    const map = new Map<string, EnrolledLead[]>();
    for (const lead of enrolled) {
      const list = map.get(lead.sequenceId) ?? [];
      list.push(lead);
      map.set(lead.sequenceId, list);
    }
    return map;
  }, [enrolled]);

  async function toggleActive(sequence: SequenceRow) {
    setBusy(true);
    try {
      const result = await setSequenceActive({
        workspaceId,
        sequenceId: sequence.id,
        active: !sequence.active,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not change the sequence');
        return;
      }
      toast.success(`${sequence.name} ${sequence.active ? 'paused' : 'switched on'}.`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {sequences.length} sequence{sequences.length === 1 ? '' : 's'}
        </span>
        <Button size="sm" disabled={busy || editing === 'new'} onClick={() => setEditing('new')}>
          New sequence
        </Button>
      </div>

      {editing === 'new' ? (
        <SequenceEditor
          workspaceId={workspaceId}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {sequences.length === 0 && editing !== 'new' ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No sequences yet. One step is a valid sequence; four is the most a lead will ever get.
        </div>
      ) : null}

      {sequences.map((sequence) =>
        editing === sequence.id ? (
          <SequenceEditor
            key={sequence.id}
            workspaceId={workspaceId}
            sequence={sequence}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <section key={sequence.id} className="rounded-lg border">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-foreground">{sequence.name}</h2>
                  {sequence.active ? null : (
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase text-secondary-foreground">
                      paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {sequence.steps.length} step{sequence.steps.length === 1 ? '' : 's'} ·{' '}
                  {sequence.sentCount} sent · {sequence.replyCount} replied
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => toggleActive(sequence)}
                >
                  {sequence.active ? 'Pause' : 'Switch on'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(sequence.id)}>
                  Edit
                </Button>
              </div>
            </header>

            <ol className="divide-y">
              {sequence.steps.map((step) => (
                <li
                  key={step.step}
                  className="flex items-center gap-4 px-4 py-2 text-sm text-muted-foreground"
                >
                  <span className="font-mono text-xs text-foreground">Step {step.step}</span>
                  <span>{describeStep(step)}</span>
                </li>
              ))}
              {sequence.steps.length === 0 ? (
                <li className="px-4 py-2 text-sm text-destructive">
                  This sequence has no readable steps. Edit it to add one.
                </li>
              ) : null}
            </ol>

            <EnrolledTable
              leads={bySequence.get(sequence.id) ?? []}
              stepCount={sequence.steps.length}
            />
          </section>
        )
      )}
    </div>
  );
}

function EnrolledTable({ leads, stepCount }: { leads: EnrolledLead[]; stepCount: number }) {
  if (leads.length === 0) {
    return (
      <div className="border-t px-4 py-3 text-sm text-muted-foreground">
        Nobody on this sequence yet. Select leads on the{' '}
        <Link href="/leads" className="text-foreground underline underline-offset-4">
          leads page
        </Link>{' '}
        and assign them.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border-t">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Lead</th>
            <th className="px-4 py-2 font-medium">Stage</th>
            <th className="px-4 py-2 font-medium">Step</th>
            <th className="px-4 py-2 font-medium">Next action</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {leads.map((lead) => (
            <tr key={lead.id}>
              <td className="px-4 py-2">
                <div className="font-medium text-foreground">{lead.name}</div>
                <div className="text-xs text-muted-foreground">{lead.company ?? '-'}</div>
              </td>
              <td className="px-4 py-2">
                <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary-foreground">
                  {lead.stage}
                </span>
              </td>
              <td className="px-4 py-2 font-mono text-xs">
                {lead.step} of {stepCount}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {lead.stoppedReason ? (
                  <span className="text-xs">{describeStop(lead.stoppedReason)}</span>
                ) : (
                  formatDueDate(lead.nextActionAt, { year: true })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SequenceEditor({
  workspaceId,
  sequence,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  sequence?: SequenceRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(sequence?.name ?? '');
  const [active, setActive] = React.useState(sequence?.active ?? true);
  const [steps, setSteps] = React.useState<SequenceStep[]>(
    sequence?.steps.length ? sequence.steps : [blankStep(1)]
  );
  const [saving, setSaving] = React.useState(false);

  function patchStep(index: number, patch: Partial<SequenceStep>) {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step))
    );
  }

  function addStep() {
    setSteps((current) =>
      current.length >= MAX_STEPS ? current : [...current, blankStep(current.length + 1)]
    );
  }

  /** Removing from the middle renumbers, so the saved steps stay 1..n. */
  function removeStep(index: number) {
    setSteps((current) =>
      current
        .filter((_, position) => position !== index)
        .map((step, position) => ({ ...step, step: position + 1 }))
    );
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveSequence({
        workspaceId,
        id: sequence?.id,
        name,
        active,
        steps,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the sequence');
        return;
      }
      toast.success(`${name} saved.`);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor="sequence-name">Name</Label>
          <Input
            id="sequence-name"
            value={name}
            placeholder="Cold email, three touches"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <div
              key={index}
              className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/20 px-3 py-3"
            >
              <span className="font-mono text-xs text-muted-foreground">Step {index + 1}</span>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Channel
                <select
                  value={step.channel}
                  onChange={(event) =>
                    patchStep(index, { channel: event.target.value as SequenceStep['channel'] })
                  }
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {index === 0 ? 'Days before sending' : 'Days after the step above'}
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={step.delay_days}
                  onChange={(event) =>
                    patchStep(index, {
                      delay_days: Math.max(0, Math.min(365, Number(event.target.value) || 0)),
                    })
                  }
                  className="w-32"
                />
              </label>

              <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={step.requires_approval}
                  onChange={(event) =>
                    patchStep(index, { requires_approval: event.target.checked })
                  }
                  className="size-4 accent-primary"
                />
                Needs approval
              </label>

              {steps.length > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => removeStep(index)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {steps.length < MAX_STEPS ? (
            <Button variant="outline" size="sm" onClick={addStep}>
              Add step
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              Four steps is the cap. A fifth message is where follow-up turns into complaints.
            </span>
          )}

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-primary"
            />
            Active
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || name.trim() === ''} onClick={save}>
              {saving ? 'Saving' : 'Save sequence'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
