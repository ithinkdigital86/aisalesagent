// lib/cadence/sourcing/import.ts
//
// The database half of the CSV import: dedupe, suppression, insert, and the
// consent record the operator has to earn.
//
// Two rules this file exists to hold.
//
//  1. An imported lead gets no consent record unless a human declares a basis
//     for the list, in writing, in the same request. Absent that, leads land as
//     'sourced' with nothing in consent_records, and evaluateConsent blocks
//     every send against them with insufficient_consent. That is the correct
//     outcome, not a gap to be patched later with a bulk grant.
//
//  2. When a basis is declared, it is legitimate_b2b on email only. A list is
//     licensed B2B data; it is not written consent and it never unlocks voice
//     or SMS, in any jurisdiction. The declaration is stored on every record it
//     creates, along with who made it and when.
//
// planImport is what the preview calls and commitImport is what the import
// calls, and commitImport plans again rather than trusting anything the browser
// sends back, so a preview can never be edited into a different import.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Json } from '@/types/database';
// Extension-qualified so `npm test` can load this module directly under Node,
// the same way csv.ts reaches apollo.ts.
import { parseLeadCsv, type ImportedLead, type RejectedRow } from './csv.ts';

/** What sourcing_runs.source and leads.source say for a lead from a file. */
export const IMPORT_SOURCE = 'csv_import';

/**
 * A declaration shorter than this is not a description of where a list came
 * from, it is a shrug. Enforced here as well as in the route and the form,
 * because this is the layer that writes the record.
 */
export const MIN_SOURCE_DESCRIPTION = 20;

/** Rows per database round trip. Small enough to keep the `in` filters sane. */
const CHUNK = 100;

export class ImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ConsentAttestation {
  /** Where the list came from, the filter used, and the date. Free text. */
  sourceDescription: string;
  /** auth.users.id of the operator making the declaration. */
  attestedBy: string;
}

export interface SampleLead {
  row: number;
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  country: string | null;
  email: string | null;
}

export interface ImportSummary {
  /** Data rows in the file, excluding the header and blank lines. */
  total: number;
  /** Rows that normalised cleanly, before dedupe and suppression. */
  valid: number;
  /** Rows that will become new leads. */
  newCount: number;
  duplicateCount: number;
  /** The same person twice inside this one file. */
  duplicateInFile: number;
  /** Already a lead in this workspace, from this or any other source. */
  duplicateExisting: number;
  /** On the workspace suppression list. Never re-created. */
  suppressedCount: number;
  rejected: RejectedRow[];
  mapped: { field: string; header: string }[];
  unmappedHeaders: string[];
  sample: SampleLead[];
}

export interface ImportPlan {
  summary: ImportSummary;
  /** The rows commitImport will insert, in file order. */
  insertable: ImportedLead[];
}

export interface ImportOutcome {
  runId: string;
  summary: ImportSummary;
  inserted: number;
  /** Caught by the unique index at insert time rather than by the plan. */
  duplicatesOnInsert: number;
  failed: number;
  /** Consent records written. Zero unless a basis was declared. */
  consentRecords: number;
}

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Dedupe keys already present in this workspace. Queried in chunks because the
 * filter travels in the URL, and a five thousand row file would not fit in one.
 */
async function existingKeys(
  db: SupabaseClient,
  workspaceId: string,
  keys: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunked(keys)) {
    const { data, error } = await db
      .from('leads')
      .select('dedupe_key')
      .eq('workspace_id', workspaceId)
      .in('dedupe_key', batch);
    if (error) throw new ImportError('dedupe_lookup_failed', error.message);
    for (const row of data ?? []) {
      if (row.dedupe_key) found.add(row.dedupe_key as string);
    }
  }
  return found;
}

/**
 * The suppression list is checked at insert time, not only at send time: a lead
 * that can never be contacted is a row that should never have been created.
 */
async function suppressedIdentifiers(
  db: SupabaseClient,
  workspaceId: string,
  emails: string[],
  domains: string[]
): Promise<{ emails: Set<string>; domains: Set<string> }> {
  const hitEmails = new Set<string>();
  const hitDomains = new Set<string>();

  for (const batch of chunked(emails)) {
    const { data, error } = await db
      .from('suppression_list')
      .select('email')
      .eq('workspace_id', workspaceId)
      .in('email', batch);
    if (error) throw new ImportError('suppression_lookup_failed', error.message);
    for (const row of data ?? []) if (row.email) hitEmails.add(row.email as string);
  }

  for (const batch of chunked(domains)) {
    const { data, error } = await db
      .from('suppression_list')
      .select('domain')
      .eq('workspace_id', workspaceId)
      .in('domain', batch);
    if (error) throw new ImportError('suppression_lookup_failed', error.message);
    for (const row of data ?? []) if (row.domain) hitDomains.add(row.domain as string);
  }

  return { emails: hitEmails, domains: hitDomains };
}

/**
 * Parse, dedupe and suppression-check a file without writing anything. This is
 * what the preview shows, and what commitImport re-runs before it writes.
 *
 * A row that is both a duplicate and suppressed counts once, as a duplicate:
 * the person is already in the workspace, so what happens to them there is
 * already settled.
 */
export async function planImport(
  db: SupabaseClient,
  opts: { workspaceId: string; csv: string; defaultSource?: string }
): Promise<ImportPlan> {
  const parsed = parseLeadCsv(opts.csv, {
    defaultSource: opts.defaultSource ?? IMPORT_SOURCE,
  });

  // Same person twice in one file: the first occurrence is the one kept, so
  // the row numbers the preview shows stay the ones the operator can find.
  const seen = new Set<string>();
  const unique: ImportedLead[] = [];
  let duplicateInFile = 0;
  for (const lead of parsed.leads) {
    if (seen.has(lead.dedupe_key)) {
      duplicateInFile++;
      continue;
    }
    seen.add(lead.dedupe_key);
    unique.push(lead);
  }

  const already = await existingKeys(
    db,
    opts.workspaceId,
    unique.map((lead) => lead.dedupe_key)
  );
  const fresh = unique.filter((lead) => !already.has(lead.dedupe_key));
  const duplicateExisting = unique.length - fresh.length;

  const suppression = await suppressedIdentifiers(
    db,
    opts.workspaceId,
    Array.from(new Set(fresh.map((lead) => lead.email).filter((v): v is string => !!v))),
    Array.from(
      new Set(fresh.map((lead) => lead.company_domain).filter((v): v is string => !!v))
    )
  );

  const insertable = fresh.filter(
    (lead) =>
      !(lead.email && suppression.emails.has(lead.email)) &&
      !(lead.company_domain && suppression.domains.has(lead.company_domain))
  );

  const mapped = Object.entries(parsed.mapping.columns)
    .filter(([, index]) => index !== undefined)
    .map(([field, index]) => ({ field, header: parsed.headers[index as number] }));

  const summary: ImportSummary = {
    total: parsed.total,
    valid: parsed.leads.length,
    newCount: insertable.length,
    duplicateCount: duplicateInFile + duplicateExisting,
    duplicateInFile,
    duplicateExisting,
    suppressedCount: fresh.length - insertable.length,
    rejected: parsed.rejected,
    mapped,
    unmappedHeaders: parsed.mapping.unmapped.map((column) => column.header),
    sample: insertable.slice(0, 5).map((lead) => ({
      row: lead.row,
      full_name: lead.full_name,
      title: lead.title,
      company_name: lead.company_name,
      company_domain: lead.company_domain,
      country: lead.country,
      email: lead.email,
    })),
  };

  return { summary, insertable };
}

interface InsertedLead {
  id: string;
  email: string | null;
}

/**
 * Insert a batch, falling back to one row at a time if the batch trips the
 * dedupe index. The plan already removed the duplicates it could see; this
 * handles the ones that arrived between the plan and the insert, without
 * losing the rest of the batch to a single collision.
 *
 * 23505 is the unique-violation code, the same one the Apollo path reads.
 */
async function insertBatch(
  db: SupabaseClient,
  rows: Record<string, unknown>[]
): Promise<{ inserted: InsertedLead[]; duplicates: number; failed: number }> {
  const { data, error } = await db.from('leads').insert(rows).select('id, email');
  if (!error) {
    return {
      inserted: (data ?? []) as InsertedLead[],
      duplicates: 0,
      failed: 0,
    };
  }
  if (error.code !== '23505') throw new ImportError('insert_failed', error.message);

  const inserted: InsertedLead[] = [];
  let duplicates = 0;
  let failed = 0;

  for (const row of rows) {
    const { data: one, error: rowError } = await db
      .from('leads')
      .insert(row)
      .select('id, email')
      .single();
    if (!rowError && one) inserted.push(one as InsertedLead);
    else if (rowError?.code === '23505') duplicates++;
    else failed++;
  }

  return { inserted, duplicates, failed };
}

/**
 * Run the import for real.
 *
 * `consent` is the whole compliance surface of this feature. Null means the
 * leads land contactable by nobody, which is the default and the safe state.
 */
export async function commitImport(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    csv: string;
    fileName?: string | null;
    defaultSource?: string;
    consent: ConsentAttestation | null;
  }
): Promise<ImportOutcome> {
  const consent = opts.consent;
  if (consent) {
    const description = consent.sourceDescription.trim();
    if (description.length < MIN_SOURCE_DESCRIPTION) {
      throw new ImportError(
        'source_description_too_short',
        `The source description has to be at least ${MIN_SOURCE_DESCRIPTION} characters.`
      );
    }
    if (!consent.attestedBy) {
      throw new ImportError('no_attester', 'A consent declaration needs a user behind it.');
    }
  }

  const plan = await planImport(db, {
    workspaceId: opts.workspaceId,
    csv: opts.csv,
    defaultSource: opts.defaultSource,
  });

  // The run row is the audit trail for the import: what was uploaded, how it
  // was read, and whether a basis was claimed over it.
  const { data: run, error: runError } = await db
    .from('sourcing_runs')
    .insert({
      workspace_id: opts.workspaceId,
      source: IMPORT_SOURCE,
      filters_used: {
        file_name: opts.fileName ?? null,
        mapped_columns: plan.summary.mapped,
        unmapped_headers: plan.summary.unmappedHeaders,
        rejected_rows: plan.summary.rejected.length,
        consent_granted: consent ? 'legitimate_b2b:email' : 'none',
        consent_source_description: consent?.sourceDescription.trim() ?? null,
        attested_by: consent?.attestedBy ?? null,
      } as unknown as Json,
      returned_count: plan.summary.total,
    })
    .select('id')
    .single();

  if (runError || !run) {
    throw new ImportError('run_create_failed', runError?.message ?? 'Could not start the import.');
  }
  const runId = run.id as string;

  const rows = plan.insertable.map((lead) => ({
    workspace_id: opts.workspaceId,
    sourcing_run_id: runId,
    dedupe_key: lead.dedupe_key,
    full_name: lead.full_name,
    title: lead.title,
    company_name: lead.company_name,
    company_domain: lead.company_domain,
    employee_count: lead.employee_count,
    industry: lead.industry,
    country: lead.country,
    email: lead.email,
    phone: lead.phone,
    linkedin_url: lead.linkedin_url,
    source: lead.source,
    source_record_id: lead.source_record_id,
    // Imported leads are sourced and nothing more. Contactability is the
    // consent gate's call, and with no consent record it says no.
    stage: 'sourced' as const,
    // The original CSV row, so a lead can always be traced to what created it.
    raw: { import: { row: lead.row, file_name: opts.fileName ?? null, values: lead.raw } },
  }));

  const insertedLeads: InsertedLead[] = [];
  let duplicatesOnInsert = 0;
  let failed = 0;

  try {
    for (const batch of chunked(rows)) {
      const result = await insertBatch(db, batch);
      insertedLeads.push(...result.inserted);
      duplicatesOnInsert += result.duplicates;
      failed += result.failed;
    }
  } catch (err) {
    await db
      .from('sourcing_runs')
      .update({ error: err instanceof Error ? err.message : 'unknown' })
      .eq('id', runId);
    throw err;
  }

  let consentRecords = 0;
  if (consent) {
    consentRecords = await grantDeclaredBasis(db, {
      workspaceId: opts.workspaceId,
      leads: insertedLeads,
      sourceDescription: consent.sourceDescription.trim(),
      attestedBy: consent.attestedBy,
    });
  }

  await db
    .from('sourcing_runs')
    .update({
      returned_count: plan.summary.total,
      inserted_count: insertedLeads.length,
      duplicate_count: plan.summary.duplicateCount + duplicatesOnInsert,
      // suppressed_count on a run means "skipped, for any reason", which is how
      // the Apollo path fills it. The split between suppressed and rejected is
      // kept on filters_used for anyone who needs it.
      suppressed_count: plan.summary.suppressedCount + plan.summary.rejected.length,
      credits_used: 0,
    })
    .eq('id', runId);

  return {
    runId,
    summary: plan.summary,
    inserted: insertedLeads.length,
    duplicatesOnInsert,
    failed,
    consentRecords,
  };
}

/**
 * Write the declared basis onto every imported lead that has an address to use
 * it on. Email only, and never any other channel: a licensed list is not
 * consent to call or text anyone, and the gate would refuse it anyway.
 *
 * The declaration text, the operator's id and the moment they made the claim
 * all land on every record, because a basis nobody signed is not evidence.
 */
async function grantDeclaredBasis(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    leads: InsertedLead[];
    sourceDescription: string;
    attestedBy: string;
  }
): Promise<number> {
  const withEmail = opts.leads.filter((lead) => !!lead.email);
  if (!withEmail.length) return 0;

  const attestedAt = new Date().toISOString();
  let written = 0;

  for (const batch of chunked(withEmail)) {
    const { data, error } = await db
      .from('consent_records')
      .insert(
        batch.map((lead) => ({
          workspace_id: opts.workspaceId,
          lead_id: lead.id,
          basis: 'legitimate_b2b' as const,
          channels: ['email' as const],
          source_description: opts.sourceDescription,
          attested_by: opts.attestedBy,
          attested_at: attestedAt,
        }))
      )
      .select('id');
    if (error) throw new ImportError('consent_insert_failed', error.message);
    written += (data ?? []).length;
  }

  return written;
}
