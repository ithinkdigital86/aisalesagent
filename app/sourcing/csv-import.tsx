'use client';

// app/sourcing/csv-import.tsx
//
// Upload, preview, then import. Nothing is written until the preview has been
// shown, so the operator always sees the row count, the new count and the
// duplicate count before committing.
//
// The consent block is the part that matters. By default the box is unticked,
// the import creates no consent records at all, and the leads land sourced and
// uncontactable — which is the correct resting state for a bought or exported
// list, not a defect to be worked around. Ticking the box is a legal
// declaration, so it is worded as one and it requires a written description of
// the list before the import will run.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Kept in step with MIN_SOURCE_DESCRIPTION in lib/cadence/sourcing/import.ts. */
const MIN_SOURCE_DESCRIPTION = 20;

/**
 * Kept in step with MAX_CSV_CHARS in the route. Checked here too so an
 * oversized file gets a sentence rather than a rejected request.
 */
const MAX_CSV_BYTES = 3_000_000;

const SOURCE_PLACEHOLDER =
  "Apollo export, saved search 'India fintech, heads of growth, 51-200 staff', filtered to verified work emails, exported 14 September 2026";

type RejectedRow = { row: number; reason: string; detail?: string };

type SampleLead = {
  row: number;
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  country: string | null;
  email: string | null;
};

type Summary = {
  total: number;
  valid: number;
  newCount: number;
  duplicateCount: number;
  duplicateInFile: number;
  duplicateExisting: number;
  suppressedCount: number;
  rejected: RejectedRow[];
  mapped: { field: string; header: string }[];
  unmappedHeaders: string[];
  sample: SampleLead[];
};

type Outcome = {
  runId: string;
  inserted: number;
  duplicatesOnInsert: number;
  failed: number;
  consentRecords: number;
};

const FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  full_name: 'Name',
  title: 'Title',
  company_name: 'Company',
  company_domain: 'Domain',
  employee_count: 'Employees',
  industry: 'Industry',
  country: 'Country',
  email: 'Email',
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
  source: 'Source',
  source_record_id: 'Source record id',
};

const REASON_LABELS: Record<string, string> = {
  column_count_mismatch: 'more values than columns, the quoting is broken',
  invalid_email: 'the email address is not usable',
  role_address: 'a shared inbox, not a person',
  no_identity: 'no email, and no name with a company domain',
};

function describe(rejected: RejectedRow): string {
  const label = REASON_LABELS[rejected.reason] ?? rejected.reason;
  return rejected.detail ? `${label} (${rejected.detail})` : label;
}

export function CsvImport({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [csv, setCsv] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [reading, setReading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const [grant, setGrant] = React.useState(false);
  const [sourceDescription, setSourceDescription] = React.useState('');

  const described = sourceDescription.trim().length;
  const consentReady = !grant || described >= MIN_SOURCE_DESCRIPTION;

  function reset() {
    setFileName(null);
    setCsv(null);
    setSummary(null);
    setGrant(false);
    setSourceDescription('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_CSV_BYTES) {
      reset();
      toast.error(
        `That file is ${(file.size / 1_000_000).toFixed(1)}MB. Split it into parts under 3MB and import them one at a time.`
      );
      return;
    }

    setReading(true);
    setSummary(null);
    setOutcome(null);

    try {
      const text = await file.text();
      setFileName(file.name);
      setCsv(text);

      const response = await fetch('/api/sourcing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'preview',
          workspaceId,
          fileName: file.name,
          csv: text,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not read that file');
      setSummary(payload.data as Summary);
    } catch (err) {
      reset();
      toast.error(err instanceof Error ? err.message : 'Could not read that file');
    } finally {
      setReading(false);
    }
  }

  async function onImport() {
    if (!csv || !summary) return;
    setImporting(true);

    try {
      const response = await fetch('/api/sourcing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'commit',
          workspaceId,
          fileName,
          csv,
          consent: { grant, sourceDescription },
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'The import failed');

      const result = payload.data as Outcome;
      setOutcome(result);
      toast.success(
        result.consentRecords > 0
          ? `${result.inserted} leads imported, ${result.consentRecords} with a B2B email basis`
          : `${result.inserted} leads imported with no consent basis`
      );
      reset();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Import a CSV</CardTitle>
        <CardDescription>
          An Apollo people export, or any file with an email column, or a name and a company
          domain. Columns are matched by header name and the file is checked against the leads
          already in this workspace before anything is written.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="csv-file">CSV file</Label>
          <input
            ref={inputRef}
            id="csv-file"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            disabled={reading || importing}
            className="file:text-foreground border-input flex w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none file:mr-3 file:inline-flex file:h-7 file:cursor-pointer file:items-center file:rounded file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          />
          {reading ? (
            <p className="text-sm text-muted-foreground">Reading the file…</p>
          ) : null}
        </div>

        {outcome && !summary ? (
          <div className="rounded-lg border px-4 py-3 text-sm">
            <p className="font-medium">
              {outcome.inserted} leads imported
              {outcome.duplicatesOnInsert > 0
                ? `, ${outcome.duplicatesOnInsert} more turned out to be duplicates`
                : ''}
              {outcome.failed > 0 ? `, ${outcome.failed} failed` : ''}.
            </p>
            <p className="text-muted-foreground">
              {outcome.consentRecords > 0
                ? `${outcome.consentRecords} consent records written on the basis you declared. They are contactable by email only.`
                : 'No consent records were written, so these leads cannot be sent to. The consent gate will block every attempt until a basis exists.'}
            </p>
          </div>
        ) : null}

        {summary ? (
          <>
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Preview{fileName ? ` — ${fileName}` : ''}
              </h3>

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
                <Stat label="Rows" value={summary.total} />
                <Stat label="New" value={summary.newCount} emphasis />
                <Stat label="Duplicates" value={summary.duplicateCount} />
                <Stat label="Rejected" value={summary.rejected.length} />
              </dl>

              <p className="text-sm text-muted-foreground">
                {summary.duplicateCount > 0
                  ? `${summary.duplicateExisting} already in this workspace, ${summary.duplicateInFile} repeated inside the file. `
                  : ''}
                {summary.suppressedCount > 0
                  ? `${summary.suppressedCount} skipped as suppressed. `
                  : ''}
                {summary.newCount === 0
                  ? 'Nothing in this file would be added.'
                  : `${summary.newCount} rows would become leads at stage "sourced".`}
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">Columns</h3>
              <ul className="flex flex-wrap gap-2 text-xs">
                {summary.mapped.map((column) => (
                  <li key={column.field} className="rounded border px-2 py-1">
                    <span className="font-mono text-muted-foreground">{column.header}</span>
                    <span className="mx-1 text-muted-foreground">→</span>
                    <span className="font-medium">
                      {FIELD_LABELS[column.field] ?? column.field}
                    </span>
                  </li>
                ))}
              </ul>
              {summary.unmappedHeaders.length ? (
                <p className="text-xs text-muted-foreground">
                  Kept on the lead but not mapped to a column:{' '}
                  <span className="font-mono">{summary.unmappedHeaders.join(', ')}</span>
                </p>
              ) : null}
            </section>

            {summary.sample.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  First {summary.sample.length} of the new leads
                </h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Title</th>
                        <th className="px-3 py-2 font-medium">Company</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.sample.map((lead) => (
                        <tr key={lead.row} className="border-b last:border-0">
                          <td className="px-3 py-2">{lead.full_name ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {lead.title ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {lead.company_name ?? lead.company_domain ?? '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{lead.email ?? '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {lead.country ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {summary.rejected.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Rejected rows ({summary.rejected.length})
                </h3>
                <ul className="divide-y rounded-lg border text-sm">
                  {summary.rejected.slice(0, 20).map((rejected) => (
                    <li key={rejected.row} className="flex gap-3 px-3 py-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        line {rejected.row}
                      </span>
                      <span className="text-muted-foreground">{describe(rejected)}</span>
                    </li>
                  ))}
                </ul>
                {summary.rejected.length > 20 ? (
                  <p className="text-xs text-muted-foreground">
                    {summary.rejected.length - 20} more not shown. Fix them in the file and
                    upload it again; nothing here blocks the rest of the import.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Consent</h3>

              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">
                  Ticking the box below is a legal declaration.
                </p>
                <p className="mt-1 text-muted-foreground">
                  You are stating, on the record and under your own user account, that this list
                  is licensed business-to-business data, that the addresses are work addresses,
                  and that you have a lawful basis to email these people. The text you write is
                  stored on every consent record this import creates and is the evidence you
                  would produce if the basis were ever challenged. It is not consent to call or
                  text anyone, and it never will be.
                </p>
                <p className="mt-1 text-muted-foreground">
                  Leave it unticked and the leads are still imported. They land at stage
                  &ldquo;sourced&rdquo; with no consent record, and the consent gate blocks every
                  send against them.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={grant}
                  onChange={(event) => setGrant(event.target.checked)}
                  disabled={importing}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                />
                <span>
                  <span className="font-medium">
                    I declare a legitimate B2B basis for this list, on email only.
                  </span>
                  <span className="block text-muted-foreground">
                    Recorded against your user account with the time you ticked it.
                  </span>
                </span>
              </label>

              {grant ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="source-description">
                    Where this list came from, the filter used, and the date
                  </Label>
                  <Textarea
                    id="source-description"
                    value={sourceDescription}
                    onChange={(event) => setSourceDescription(event.target.value)}
                    placeholder={SOURCE_PLACEHOLDER}
                    disabled={importing}
                    aria-invalid={described > 0 && described < MIN_SOURCE_DESCRIPTION}
                  />
                  <p
                    className={
                      described < MIN_SOURCE_DESCRIPTION
                        ? 'text-xs text-destructive'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {described < MIN_SOURCE_DESCRIPTION
                      ? `${MIN_SOURCE_DESCRIPTION - described} more characters needed. Name the source, the filter and the date.`
                      : 'Stored on every consent record from this import.'}
                  </p>
                </div>
              ) : null}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={onImport}
                disabled={importing || reading || !consentReady || summary.newCount === 0}
              >
                {importing
                  ? 'Importing'
                  : grant
                    ? `Import ${summary.newCount} leads with a B2B email basis`
                    : `Import ${summary.newCount} leads with no consent basis`}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={importing}>
                Cancel
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={
          emphasis ? 'text-2xl font-semibold tabular-nums' : 'text-2xl tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}
