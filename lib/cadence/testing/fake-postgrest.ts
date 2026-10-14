// lib/cadence/testing/fake-postgrest.ts
//
// An in-memory stand-in for the slice of supabase-js that the consent gate,
// the email adapter, the suppression writes and the cron routes use. Not a
// test file itself; the tests next to those modules import it.
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
//
//  - rpc('claim_email_send') is the function from migration 0013, written
//    out again here, and runs whole in the same way, which is what the lock
//    on the workspace row buys the real one.

import type { SupabaseClient } from '@supabase/supabase-js';

import { dueOn } from '../sequence.ts';

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

/** What a fault sees of the statement about to run. */
export interface Statement {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert';
  /** The values of every eq() filter on it, by column. */
  eq: Record<string, unknown>;
  /** The rows an insert or upsert carries; empty otherwise. */
  rows: Row[];
}

/** Returns an error to fail the statement with, or null to let it run. */
export type Fault = (statement: Statement) => FakeError | null;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  indexes: Record<string, UniqueIndex[]> = {};
  /** Checked before every statement, for testing what callers do with an error. */
  faults: Fault[] = [];
  /** Column defaults an insert fills in, by table, as the real columns have. */
  defaults: Record<string, Row> = {};
  private nextId = 1;

  constructor(tables: Record<string, Row[]> = {}) {
    for (const [name, rows] of Object.entries(tables)) {
      this.tables[name] = rows.map((row) => ({ ...row }));
    }
  }

  id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }

  private lastStamp = 0;

  /** A created_at for an inserted row: now, and later than the last one. */
  stamp(): string {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return new Date(this.lastStamp).toISOString();
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /** The clock claim_email_send reads. Tests move it to age a window. */
  now: () => Date = () => new Date();

  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: FakeError | null }> {
    const call = () => {
      if (name !== 'claim_email_send') {
        return { data: null, error: { code: 'PGRST202', message: `no function ${name}` } };
      }
      return { data: this.claimEmailSend(args.p_action_id as string), error: null };
    };
    return { then: (onfulfilled, onrejected) => Promise.resolve().then(call).then(onfulfilled, onrejected) };
  }

  /** migration 0013's claim_email_send. Defaults are the column defaults. */
  private claimEmailSend(actionId: string): string {
    const action = this.rows('actions').find((row) => row.id === actionId);
    if (!action) return 'not_found';
    if (action.status !== 'queued' || action.channel !== 'email') return 'already_claimed';

    const workspace = this.rows('workspaces').find((row) => row.id === action.workspace_id);
    if (workspace?.sending_paused === true) return 'sending_paused';
    const cap = (workspace?.daily_send_cap as number | undefined) ?? 50;

    const now = this.now();
    // Midnight today in India, as the SQL reads it.
    const since = new Date(dueOn(now, 0)).getTime();
    const at = (value: unknown) => (typeof value === 'string' ? new Date(value).getTime() : NaN);
    const used = this.rows('actions').filter(
      (row) =>
        row.workspace_id === action.workspace_id &&
        row.channel === 'email' &&
        (at(row.sent_at) >= since || (row.status === 'sending' && at(row.updated_at) >= since))
    ).length;
    if (used >= cap) return 'daily_cap_reached';

    action.status = 'sending';
    action.updated_at = now.toISOString();
    return 'claimed';
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

/** NaN for a null, so a null passes no comparison, as in SQL. */
function compare(left: unknown, right: string | number): number {
  if (left === null || left === undefined) return Number.NaN;
  if (typeof right === 'number') return Number(left) - right;
  return new Date(String(left)).getTime() - new Date(right).getTime();
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
  private equals: Record<string, unknown> = {};
  private returning = false;
  private singleRow = false;
  private maybe = false;
  private counting = false;
  private headOnly = false;
  private rowLimit: number | null = null;
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  // Plain fields rather than constructor parameter properties: Node runs this
  // under type-stripping, which does not rewrite them.
  private db: FakeDb;
  private table: string;

  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }

  /** Every column comes back; nothing under test reads one it did not ask for. */
  select(_columns?: string, options: { count?: 'exact'; head?: boolean } = {}) {
    this.returning = true;
    this.counting = options.count === 'exact';
    this.headOnly = options.head === true;
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
    this.equals[column] = value;
    return this;
  }

  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  /** Comparisons on ISO timestamps and numbers, the only ones used here. */
  gte(column: string, value: string | number) {
    this.filters.push((row) => compare(row[column], value) >= 0);
    return this;
  }

  lte(column: string, value: string | number) {
    this.filters.push((row) => compare(row[column], value) <= 0);
    return this;
  }

  lt(column: string, value: string | number) {
    this.filters.push((row) => compare(row[column], value) < 0);
    return this;
  }

  /** `not(col, 'is', null)` and `not(col, 'in', '(a,b)')`. */
  not(column: string, operator: 'is' | 'in', value: null | string) {
    if (operator === 'is') {
      this.filters.push((row) => (row[column] ?? null) !== value);
    } else {
      const values = String(value).replace(/^\(|\)$/g, '').split(',');
      this.filters.push((row) => !values.includes(String(row[column])));
    }
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  /**
   * PostgREST's `col.eq.value`, `col.is.null` and `col.not.is.null` terms,
   * joined by commas: what consent.ts and the follow-up cron send.
   */
  or(expression: string) {
    const terms: Filter[] = expression.split(',').map((term) => {
      const [column, operator, ...rest] = term.split('.');
      const value = rest.join('.');
      if (operator === 'eq') return (row) => row[column] === value;
      if (operator === 'is' && value === 'null') return (row) => (row[column] ?? null) === null;
      if (operator === 'not' && value === 'is.null') return (row) => (row[column] ?? null) !== null;
      throw new Error(`fake or(): unsupported term ${term}`);
    });
    this.filters.push((row) => terms.some((holds) => holds(row)));
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.ordering.push({ column, ascending: options.ascending ?? true });
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

  maybeSingle() {
    this.singleRow = true;
    this.maybe = true;
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

  /** Nulls last either way, which is PostgREST's default for ascending. */
  private matching(): Row[] {
    const rows = this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
    if (this.ordering.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const { column, ascending } of this.ordering) {
        const left = a[column] ?? null;
        const right = b[column] ?? null;
        if (left === right) continue;
        if (left === null) return 1;
        if (right === null) return -1;
        const sign = (left as string | number) < (right as string | number) ? -1 : 1;
        return ascending ? sign : -sign;
      }
      return 0;
    });
  }

  private shape(rows: Row[]): { data: unknown; error: FakeError | null; count?: number } {
    if (this.counting && this.headOnly) return { data: null, error: null, count: rows.length };
    const limited = this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
    const copies = limited.map((row) => ({ ...row }));
    if (!this.singleRow) return { data: copies, error: null };
    if (this.maybe && copies.length === 0) return { data: null, error: null };
    if (copies.length !== 1) {
      return { data: null, error: { code: 'PGRST116', message: `${copies.length} rows for single()` } };
    }
    return { data: copies[0], error: null };
  }

  private run(): { data: unknown; error: FakeError | null } {
    const statement: Statement = { table: this.table, op: this.op, eq: this.equals, rows: this.payload };
    for (const fault of this.db.faults) {
      const error = fault(statement);
      if (error) return { data: null, error };
    }

    const rows = this.db.rows(this.table);

    if (this.op === 'select') return this.shape(this.matching());

    if (this.op === 'update') {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.patch);
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }

    if (this.op === 'insert') {
      // created_at is the column default every table has. Stamped strictly
      // increasing, as microsecond timestamps effectively are, so "newest
      // first" is never a tie between two rows written in one millisecond.
      const defaults = this.db.defaults[this.table] ?? {};
      const added = this.payload.map((row) => ({
        id: this.db.id(),
        created_at: this.db.stamp(),
        ...defaults,
        ...row,
      }));
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
