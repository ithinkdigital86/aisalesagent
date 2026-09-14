// lib/cadence/sourcing/import.test.ts
//
// Run with `npm test`. The Supabase client is stubbed by the small fake below —
// enough of PostgREST's builder to answer the handful of calls this module
// makes, including the unique-violation the dedupe index raises.
//
// The cases worth pinning are all consent ones. An import that quietly writes a
// basis nobody declared, or writes one onto a channel a licensed list can never
// justify, is the failure this feature exists to prevent, and it is not visible
// from the UI until a message has already gone out.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { commitImport, ImportError, planImport } from './import.ts';

// ---------------------------------------------------------------
// A fake PostgREST
// ---------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = ['eq' | 'in', string, unknown];

interface FakeError {
  code: string;
  message: string;
}

class FakeDb {
  tables: Record<string, Row[]> = {
    leads: [],
    consent_records: [],
    sourcing_runs: [],
    suppression_list: [],
  };
  private nextId = 1;

  id(): string {
    return `id-${this.nextId++}`;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery implements PromiseLike<{ data: Row[] | Row | null; error: FakeError | null }> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private singleRow = false;
  // Plain fields rather than constructor parameter properties: Node runs this
  // under type-stripping, which does not rewrite them.
  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  select(): this {
    if (this.op === 'select') this.op = 'select';
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row): this {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push(['eq', column, value]);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push(['in', column, values]);
    return this;
  }

  single(): this {
    this.singleRow = true;
    return this;
  }

  maybeSingle(): this {
    this.singleRow = true;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([kind, column, value]) =>
      kind === 'eq' ? row[column] === value : (value as unknown[]).includes(row[column])
    );
  }

  /** The partial unique index: (workspace_id, dedupe_key) where dedupe_key is not null. */
  private collides(row: Row): boolean {
    if (!row.dedupe_key) return false;
    return this.db.tables.leads.some(
      (existing) =>
        existing.workspace_id === row.workspace_id && existing.dedupe_key === row.dedupe_key
    );
  }

  private run(): { data: Row[] | Row | null; error: FakeError | null } {
    const table = (this.db.tables[this.table] ??= []);

    if (this.op === 'insert') {
      // Postgres fails the whole statement on a unique violation, however many
      // rows it carried, which is what the per-row fallback exists to survive.
      if (this.table === 'leads') {
        const pending = new Set<string>();
        for (const row of this.payload) {
          const key = `${row.workspace_id}:${row.dedupe_key}`;
          if (this.collides(row) || (row.dedupe_key && pending.has(key))) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            };
          }
          if (row.dedupe_key) pending.add(key);
        }
      }
      const written = this.payload.map((row) => ({ id: this.db.id(), ...row }));
      table.push(...written);
      return { data: this.singleRow ? (written[0] ?? null) : written, error: null };
    }

    if (this.op === 'update') {
      for (const row of table) if (this.matches(row)) Object.assign(row, this.patch);
      return { data: null, error: null };
    }

    const found = table.filter((row) => this.matches(row));
    return { data: this.singleRow ? (found[0] ?? null) : found, error: null };
  }

  then<TResult1 = { data: Row[] | Row | null; error: FakeError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | Row | null; error: FakeError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: FakeDb) => db as any;

const WORKSPACE = 'ws-1';
const USER = 'user-1';

const CSV = [
  'First Name,Last Name,Title,Company,Email,# Employees,Industry,Country,Website,Apollo Contact Id',
  'Priya,Nair,Head of Growth,Acme,priya@acme.example,180,Fintech,India,acme.example,apollo-1',
  'Sam,Rivers,VP Marketing,Beta,sam@beta.example,40,SaaS,United States,beta.example,apollo-2',
].join('\n');

const DESCRIPTION =
  "Apollo export, saved search 'India fintech heads of growth', exported 14 September 2026";

// ---------------------------------------------------------------
// Planning
// ---------------------------------------------------------------

test('the preview counts rows, new leads and duplicates before anything is written', async () => {
  const db = new FakeDb();
  // Already sourced from Apollo, under the same key an import would produce.
  db.tables.leads.push({
    id: 'existing',
    workspace_id: WORKSPACE,
    dedupe_key: 'sam@beta.example',
  });

  const plan = await planImport(asClient(db), { workspaceId: WORKSPACE, csv: CSV });

  assert.equal(plan.summary.total, 2);
  assert.equal(plan.summary.valid, 2);
  assert.equal(plan.summary.newCount, 1);
  assert.equal(plan.summary.duplicateCount, 1);
  assert.equal(plan.summary.duplicateExisting, 1);
  assert.equal(plan.summary.duplicateInFile, 0);
  assert.equal(plan.insertable[0].email, 'priya@acme.example');
  // A preview writes nothing.
  assert.equal(db.tables.leads.length, 1);
  assert.equal(db.tables.sourcing_runs.length, 0);
});

test('the same person twice in one file counts once', async () => {
  const db = new FakeDb();
  const csv = [
    'Email,First Name,Last Name',
    'priya@acme.example,Priya,Nair',
    'Priya@Acme.Example,Priya,Nair',
  ].join('\n');

  const plan = await planImport(asClient(db), { workspaceId: WORKSPACE, csv });

  assert.equal(plan.summary.newCount, 1);
  assert.equal(plan.summary.duplicateInFile, 1);
});

test('a suppressed address is never re-created as a lead', async () => {
  const db = new FakeDb();
  db.tables.suppression_list.push({
    workspace_id: WORKSPACE,
    email: 'sam@beta.example',
    reason: 'unsubscribed',
  });

  const plan = await planImport(asClient(db), { workspaceId: WORKSPACE, csv: CSV });

  assert.equal(plan.summary.suppressedCount, 1);
  assert.equal(plan.summary.newCount, 1);
  assert.deepEqual(
    plan.insertable.map((lead) => lead.email),
    ['priya@acme.example']
  );
});

test('a rejected row is reported and does not stop the rest of the file', async () => {
  const db = new FakeDb();
  const csv = [
    'Email,First Name',
    'priya@acme.example,Priya',
    'broken-address,Nobody',
    'sam@beta.example,Sam',
  ].join('\n');

  const plan = await planImport(asClient(db), { workspaceId: WORKSPACE, csv });

  assert.equal(plan.summary.total, 3);
  assert.equal(plan.summary.newCount, 2);
  assert.deepEqual(
    plan.summary.rejected.map((row) => [row.row, row.reason]),
    [[3, 'invalid_email']]
  );
});

// ---------------------------------------------------------------
// Committing: consent
// ---------------------------------------------------------------

test('an import with no declaration writes no consent record at all', async () => {
  const db = new FakeDb();

  const outcome = await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv: CSV,
    fileName: 'apollo-export.csv',
    consent: null,
  });

  assert.equal(outcome.inserted, 2);
  assert.equal(outcome.consentRecords, 0);
  // This is the whole point: nothing in consent_records means the gate refuses
  // every send against these leads.
  assert.equal(db.tables.consent_records.length, 0);
  assert.deepEqual(
    db.tables.leads.map((lead) => lead.stage),
    ['sourced', 'sourced']
  );
});

test('a declaration writes one legitimate_b2b email record per lead, signed and dated', async () => {
  const db = new FakeDb();
  const before = Date.now();

  const outcome = await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv: CSV,
    fileName: 'apollo-export.csv',
    consent: { sourceDescription: DESCRIPTION, attestedBy: USER },
  });

  assert.equal(outcome.consentRecords, 2);
  assert.equal(db.tables.consent_records.length, 2);

  for (const record of db.tables.consent_records) {
    assert.equal(record.workspace_id, WORKSPACE);
    assert.equal(record.basis, 'legitimate_b2b');
    // Never voice, never SMS. A licensed list cannot justify either.
    assert.deepEqual(record.channels, ['email']);
    assert.equal(record.source_description, DESCRIPTION);
    assert.equal(record.attested_by, USER);
    assert.ok(new Date(record.attested_at as string).getTime() >= before);
  }

  const leadIds = new Set(db.tables.leads.map((lead) => lead.id));
  for (const record of db.tables.consent_records) {
    assert.ok(leadIds.has(record.lead_id));
  }
});

test('a description shorter than the minimum is refused before anything is written', async () => {
  const db = new FakeDb();

  await assert.rejects(
    () =>
      commitImport(asClient(db), {
        workspaceId: WORKSPACE,
        csv: CSV,
        consent: { sourceDescription: 'bought it', attestedBy: USER },
      }),
    (err: unknown) => err instanceof ImportError && err.code === 'source_description_too_short'
  );

  assert.equal(db.tables.leads.length, 0);
  assert.equal(db.tables.sourcing_runs.length, 0);
});

test('a declaration with nobody behind it is refused', async () => {
  const db = new FakeDb();

  await assert.rejects(
    () =>
      commitImport(asClient(db), {
        workspaceId: WORKSPACE,
        csv: CSV,
        consent: { sourceDescription: DESCRIPTION, attestedBy: '' },
      }),
    (err: unknown) => err instanceof ImportError && err.code === 'no_attester'
  );

  assert.equal(db.tables.consent_records.length, 0);
});

test('a lead with no email gets no consent record, even under a declaration', async () => {
  const db = new FakeDb();
  const csv = ['Name,Website', 'Priya Nair,acme.example'].join('\n');

  const outcome = await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv,
    consent: { sourceDescription: DESCRIPTION, attestedBy: USER },
  });

  assert.equal(outcome.inserted, 1);
  assert.equal(outcome.consentRecords, 0);
});

// ---------------------------------------------------------------
// Committing: provenance and collisions
// ---------------------------------------------------------------

test('every imported lead carries where it came from', async () => {
  const db = new FakeDb();

  await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv: CSV,
    fileName: 'apollo-export.csv',
    consent: null,
  });

  const run = db.tables.sourcing_runs[0];
  assert.equal(run.source, 'csv_import');
  assert.equal(run.inserted_count, 2);

  const lead = db.tables.leads.find((row) => row.email === 'priya@acme.example')!;
  assert.equal(lead.source, 'csv_import');
  assert.equal(lead.source_record_id, 'apollo-1');
  assert.equal(lead.sourcing_run_id, run.id);
  assert.equal(lead.company_domain, 'acme.example');
  assert.equal(lead.country, 'IN');
  assert.equal(lead.employee_count, 180);

  const raw = lead.raw as { import: { row: number; file_name: string; values: Row } };
  assert.equal(raw.import.file_name, 'apollo-export.csv');
  assert.equal(raw.import.row, 2);
  assert.equal(raw.import.values['Apollo Contact Id'], 'apollo-1');
});

test('the run records what the declaration was, so the import can be audited', async () => {
  const db = new FakeDb();

  await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv: CSV,
    fileName: 'apollo-export.csv',
    consent: { sourceDescription: DESCRIPTION, attestedBy: USER },
  });

  const filters = db.tables.sourcing_runs[0].filters_used as Record<string, unknown>;
  assert.equal(filters.file_name, 'apollo-export.csv');
  assert.equal(filters.consent_granted, 'legitimate_b2b:email');
  assert.equal(filters.consent_source_description, DESCRIPTION);
  assert.equal(filters.attested_by, USER);
});

test('a run with no declaration says so on the record', async () => {
  const db = new FakeDb();

  await commitImport(asClient(db), { workspaceId: WORKSPACE, csv: CSV, consent: null });

  const filters = db.tables.sourcing_runs[0].filters_used as Record<string, unknown>;
  assert.equal(filters.consent_granted, 'none');
  assert.equal(filters.consent_source_description, null);
  assert.equal(filters.attested_by, null);
});

test('a duplicate that appears between the preview and the insert loses only itself', async () => {
  const db = new FakeDb();
  const plan = await planImport(asClient(db), { workspaceId: WORKSPACE, csv: CSV });
  assert.equal(plan.summary.newCount, 2);

  // Something else creates one of them after the preview was taken.
  db.tables.leads.push({
    id: 'raced',
    workspace_id: WORKSPACE,
    dedupe_key: 'priya@acme.example',
  });

  const outcome = await commitImport(asClient(db), {
    workspaceId: WORKSPACE,
    csv: CSV,
    consent: null,
  });

  assert.equal(outcome.inserted, 1);
  assert.equal(outcome.failed, 0);
  assert.equal(
    db.tables.leads.filter((lead) => lead.email === 'sam@beta.example').length,
    1
  );
});
