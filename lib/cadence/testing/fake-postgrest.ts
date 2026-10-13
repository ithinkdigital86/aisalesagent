// lib/cadence/testing/fake-postgrest.ts
//
// An in-memory stand-in for the slice of supabase-js that the consent gate,
// the email adapter and the suppression writes use. Not a test file itself;
// the tests next to those modules import it.
//
// Two behaviours are modelled on Postgres closely enough to test against,
// because the faults they guard were in exactly those places:
//
//  - upsert picks its arbiter the way Postgres does. The onConflict columns
//    must match a unique index exactly, and a partial index only counts when
//    the statement repeats its predicate, which PostgREST never does. No match
//    is 42P10. A conflict on some other unique index is 23505.
//
//  - every statement runs whole when awaited, so an update filtered on the
//    old status behaves like the single UPDATE it stands for: of two callers,
//    only the first finds the row still matching.

import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

export interface FakeError {
  code: string;
  message: string;
}

export interface UniqueIndex {
  name: string;
  columns: string[];
  /** The index predicate as written after WHERE, or null for a plain index. */
  where: string | null;
}

type Filter = (row: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  indexes: Record<string, UniqueIndex[]> = {};
  private nextId = 1;

  constructor(tables: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(tables)) {
      this.tables[name] = rows.map((row) => ({ ...row }));
    }
  }

  id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

/** Hand the fake to code typed against the real client. */
export function asClient(db: FakeDb): SupabaseClient {
  return db as unknown as SupabaseClient;
}

/** Only `col is not null [and col is not null]` predicates occur here. */
function predicateHolds(where: string | null, row: Row): boolean {
  if (!where) return true;
  return [...where.matchAll(/(\w+)\s+is\s+not\s+null/gi)].every(
    ([, column]) => row[column] !== null && row[column] !== undefined
  );
}

function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((column) => b.includes(column));
}

/** Two rows collide on an index when both are covered and no key is null. */
function collides(index: UniqueIndex, a: Row, b: Row): boolean {
  if (!predicateHolds(index.where, a) || !predicateHolds(index.where, b)) return false;
  return index.columns.every((column) => {
    const left = a[column] ?? null;
    return left !== null && left === (b[column] ?? null);
  });
}

class FakeQuery implements PromiseLike<{ data: unknown; error: FakeError | null }> {
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: Row[] = [];
  private patch: Row = {};
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private returning = false;
  private singleRow = false;
  private rowLimit: number | null = null;
  // Plain fields rather than constructor parameter properties: Node runs this
  // under type-stripping, which does not rewrite them.
  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  /** Every column comes back; nothing under test reads one it did not ask for. */
  select() {
    this.returning = true;
    return this;
  }

  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.upsertOptions = options;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  /** PostgREST's `col.eq.value,col.eq.value`, which is all consent.ts sends. */
  or(expression: string) {
    const terms = expression.split(',').map((term) => {
      const [column, operator, ...rest] = term.split('.');
      if (operator !== 'eq') throw new Error(`fake or(): unsupported operator ${operator}`);
      return { column, value: rest.join('.') };
    });
    this.filters.push((row) => terms.some(({ column, value }) => row[column] === value));
    return this;
  }

  order() {
    return this;
  }

  limit(count: number) {
    this.rowLimit = count;
    return this;
  }

  single() {
    this.singleRow = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: FakeError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: FakeError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    let result: { data: unknown; error: FakeError | null };
    try {
      result = this.run();
    } catch (err) {
      return Promise.reject(err).then(onfulfilled, onrejected);
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private shape(rows: Row[]): { data: unknown; error: FakeError | null } {
    const limited = this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
    const copies = limited.map((row) => ({ ...row }));
    if (!this.singleRow) return { data: copies, error: null };
    if (copies.length !== 1) {
      return { data: null, error: { code: 'PGRST116', message: `${copies.length} rows for single()` } };
    }
    return { data: copies[0], error: null };
  }

  private run(): { data: unknown; error: FakeError | null } {
    const rows = this.db.rows(this.table);

    if (this.op === 'select') return this.shape(this.matching());

    if (this.op === 'update') {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.patch);
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }

    if (this.op === 'insert') {
      const added = this.payload.map((row) => ({ id: this.db.id(), ...row }));
      rows.push(...added);
      return this.returning ? this.shape(added) : { data: null, error: null };
    }

    // upsert
    const target = (this.upsertOptions.onConflict ?? '').split(',').map((c) => c.trim());
    const indexes = this.db.indexes[this.table] ?? [];
    const arbiter = indexes.find((index) => !index.where && sameColumns(index.columns, target));
    if (!arbiter) {
      return {
        data: null,
        error: {
          code: '42P10',
          message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
        },
      };
    }

    const written: Row[] = [];
    for (const incoming of this.payload) {
      const candidate = { id: this.db.id(), ...incoming };
      const existing = rows.find((row) => collides(arbiter, row, candidate));
      if (existing) {
        if (!this.upsertOptions.ignoreDuplicates) Object.assign(existing, incoming);
        continue;
      }
      const other = indexes.find((index) => rows.some((row) => collides(index, row, candidate)));
      if (other) {
        return {
          data: null,
          error: { code: '23505', message: `duplicate key value violates unique constraint "${other.name}"` },
        };
      }
      rows.push(candidate);
      written.push(candidate);
    }
    return this.returning ? this.shape(written) : { data: null, error: null };
  }
}
