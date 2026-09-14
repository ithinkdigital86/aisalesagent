// scripts/check.ts
//
// Preflight. Answers "is this checkout, this .env.local and the database it
// points at in a state a deploy can be trusted from?" and says what to do
// about whatever is not. Run with `npm run check`. Exits non-zero when any
// check fails, so it can sit in front of a deploy.
//
// It reads and it reports. Nothing here writes to the database, and nothing
// here prints the value of an environment variable, only its name. The one
// file it touches is tsconfig.tsbuildinfo, as a side effect of running tsc.
//
// Five checks:
//
//  1. Environment: every variable .env.local.example documents AND the code
//     actually reads is set and non-empty in .env.local. The "actually reads"
//     half comes from scanning the source for process.env.NAME, so a variable
//     the example lists for later (Twilio, Vapi) does not fail the check.
//
//  2. Migrations: each file in supabase/migrations is parsed for the tables,
//     columns and enum values it creates, and each of those is probed in the
//     live database. A migration is applied when everything it adds is there.
//
//  3. Draft quality: findAiTells over the last 20 email actions, so "are the
//     drafts any good" has a number. Tells in past drafts are not a reason to
//     block a deploy, so this warns rather than fails.
//
//  4. Consent integrity: leads with no consent record, blocked actions by
//     reason, and the one hard rule: a sent action must carry the basis the
//     gate approved it on.
//
//  5. Build health: tsc, npm test, npm run build. Last, because it is slow.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseEnv } from 'node:util';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { findAiTells } from '../lib/anthropic/prompts/content-creator.ts';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ENV_FILE = join(ROOT, '.env.local');
const ENV_EXAMPLE = join(ROOT, '.env.local.example');

/** How many recent email drafts the quality check reads. */
const DRAFT_SAMPLE = 20;

// ---------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------

type Status = 'pass' | 'warn' | 'fail' | 'skip';

interface CheckResult {
  name: string;
  status: Status;
}

const results: CheckResult[] = [];

function tag(status: Status): string {
  return { pass: '[ok]  ', warn: '[warn]', fail: '[FAIL]', skip: '[skip]' }[status];
}

function heading(title: string) {
  console.log('');
  console.log(title);
}

function line(status: Status, text: string) {
  console.log(`  ${tag(status)} ${text}`);
}

function note(text: string) {
  console.log(`         ${text}`);
}

function fix(text: string) {
  console.log(`         -> ${text}`);
}

function record(name: string, status: Status) {
  results.push({ name, status });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------
// 1. Environment
// ---------------------------------------------------------------

/** Variable names declared in a dotenv file, whether or not they have a value. */
function declaredKeys(path: string): string[] {
  const keys: string[] = [];
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** Source files under the app, not under node_modules or a build output. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === 'scripts') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every NAME the code reads as process.env.NAME, with where it reads it. */
function envReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  for (const file of sourceFiles(ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const name = match[1];
      if (!reads.has(name)) reads.set(name, new Set());
      reads.get(name)!.add(relative(ROOT, file).replaceAll('\\', '/'));
    }
  }
  return reads;
}

function checkEnvironment(): NodeJS.Dict<string> | null {
  heading('Environment');

  if (!existsSync(ENV_EXAMPLE)) {
    line('fail', '.env.local.example is missing, so there is nothing to check against');
    record('Environment', 'fail');
    return null;
  }
  if (!existsSync(ENV_FILE)) {
    line('fail', '.env.local does not exist');
    fix('copy .env.local.example to .env.local and fill it in (LOCAL_SETUP.md, step 3)');
    record('Environment', 'fail');
    return null;
  }

  const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  const documented = declaredKeys(ENV_EXAMPLE);
  const reads = envReads();

  const required = documented.filter((name) => reads.has(name));
  const unused = documented.filter((name) => !reads.has(name));
  const missing = required.filter((name) => !(env[name] ?? '').trim());
  // A value the code reads that the example never mentions is a variable a
  // fresh checkout cannot know to set. Platform-injected ones are expected.
  const undocumented = [...reads.keys()].filter(
    (name) => !documented.includes(name) && !name.startsWith('VERCEL_')
  );

  if (missing.length === 0) {
    line('pass', `all ${plural(required.length, 'variable')} the code reads are set in .env.local`);
  } else {
    line('fail', `${missing.length} of ${plural(required.length, 'variable')} the code reads are missing or empty in .env.local:`);
    for (const name of missing) {
      note(`${name}  (read by ${[...reads.get(name)!].join(', ')})`);
    }
    fix('set each one in .env.local; .env.local.example says where the value comes from');
  }
  if (unused.length) {
    note(`not read by the code, so not required: ${unused.join(', ')}`);
  }
  if (undocumented.length) {
    line('warn', `read by the code but not listed in .env.local.example: ${undocumented.join(', ')}`);
    fix('add them to .env.local.example so a fresh checkout knows to set them');
  }

  record('Environment', missing.length ? 'fail' : undocumented.length ? 'warn' : 'pass');
  return env;
}

// ---------------------------------------------------------------
// Database client
// ---------------------------------------------------------------

/** Untyped on purpose: the migration probe addresses tables by parsed name. */
type Db = SupabaseClient;

function connect(env: NodeJS.Dict<string> | null): Db | null {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env?.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function skipDatabaseChecks(names: string[]) {
  for (const name of names) {
    heading(name);
    line('skip', 'needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
    record(name, 'skip');
  }
}

/** Fetch every row of a query, a page at a time. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

// ---------------------------------------------------------------
// 2. Migrations
// ---------------------------------------------------------------

interface Column {
  table: string;
  column: string;
  /** Base type name, lower-cased, without size or array suffix: 'text', 'agent_slug'. */
  type: string;
}

interface EnumValue {
  type: string;
  value: string;
}

interface Migration {
  file: string;
  columns: Column[];
  enumValues: EnumValue[];
}

/** The parts of a migration that can be checked for from the outside. */
function parseMigration(file: string, sql: string): Migration {
  const text = sql.replace(/--[^\n]*/g, '');
  const columns: Column[] = [];
  const enumValues: EnumValue[] = [];

  // create table [if not exists] name ( ... )
  const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(/gi;
  for (const match of text.matchAll(createTable)) {
    const table = match[1].toLowerCase();
    const body = balanced(text, match.index + match[0].length);
    for (const entry of splitTopLevel(body)) {
      const tokens = entry.trim().split(/\s+/);
      if (tokens.length < 2) continue;
      const first = tokens[0].toLowerCase();
      if (['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude', 'like'].includes(first)) continue;
      columns.push({ table, column: first.replace(/"/g, ''), type: baseType(tokens[1]) });
    }
  }

  // alter table name add column [if not exists] col type, add column ...
  const alterTable = /alter\s+table\s+(?:only\s+)?"?(\w+)"?([^;]*);/gi;
  for (const match of text.matchAll(alterTable)) {
    const table = match[1].toLowerCase();
    const addColumn = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+([\w"]+)/gi;
    for (const col of match[2].matchAll(addColumn)) {
      columns.push({ table, column: col[1].toLowerCase(), type: baseType(col[2]) });
    }
  }

  // alter type name add value [if not exists] 'value'
  const alterType = /alter\s+type\s+"?(\w+)"?\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']+)'/gi;
  for (const match of text.matchAll(alterType)) {
    enumValues.push({ type: match[1].toLowerCase(), value: match[2] });
  }

  return { file, columns, enumValues };
}

/** The text between the '(' before `start` and its matching ')'. */
function balanced(text: string, start: number): string {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function baseType(token: string): string {
  return token.toLowerCase().replace(/"/g, '').replace(/[([].*$/, '');
}

/** True when the error says the table itself is not there. */
function isMissingTable(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|relation .* does not exist/i.test(error.message)
  );
}

/** True when the error says a column is not there. */
function isMissingColumn(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    /could not find the .* column|column .* does not exist/i.test(error.message)
  );
}

/**
 * Which of a table's columns the live database is missing. One request for
 * the whole table; only on a miss does it go column by column to name them.
 * `null` means the table itself is missing.
 */
async function missingColumns(db: Db, table: string, columns: string[]): Promise<string[] | null> {
  const all = await db.from(table).select(columns.join(',')).limit(0);
  if (!all.error) return [];
  if (isMissingTable(all.error)) return null;
  if (!isMissingColumn(all.error)) throw new Error(`${table}: ${all.error.message}`);

  const missing: string[] = [];
  for (const column of columns) {
    const one = await db.from(table).select(column).limit(0);
    if (!one.error) continue;
    if (isMissingColumn(one.error)) missing.push(column);
    else throw new Error(`${table}.${column}: ${one.error.message}`);
  }
  return missing;
}

/**
 * Whether an enum carries a value, by filtering a column of that type on it.
 * Postgres rejects a value the enum does not have before it reads a row.
 */
async function hasEnumValue(db: Db, at: Column, value: string): Promise<boolean> {
  const { error } = await db.from(at.table).select(at.column).eq(at.column, value).limit(0);
  if (!error) return true;
  if (error.code === '22P02' || /invalid input value for enum/i.test(error.message)) return false;
  throw new Error(`${at.table}.${at.column} = '${value}': ${error.message}`);
}

async function checkMigrations(db: Db) {
  heading('Migrations');

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const migrations = files.map((file) =>
    parseMigration(file, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  );
  // Enum values are probed through a column of that type, which an earlier
  // migration will have created.
  const allColumns = migrations.flatMap((m) => m.columns);

  const reach = await db.from('workspaces').select('id').limit(0);
  if (reach.error && !isMissingTable(reach.error)) {
    line('fail', `cannot query the database: ${reach.error.message}`);
    fix('check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local match the Supabase project (Settings -> API)');
    record('Migrations', 'fail');
    return false;
  }

  const width = Math.max(...files.map((f) => f.length));
  let failed = 0;

  for (const migration of migrations) {
    const problems: string[] = [];
    const byTable = new Map<string, string[]>();
    for (const col of migration.columns) {
      if (!byTable.has(col.table)) byTable.set(col.table, []);
      byTable.get(col.table)!.push(col.column);
    }

    try {
      for (const [table, columns] of byTable) {
        const missing = await missingColumns(db, table, columns);
        if (missing === null) problems.push(`table ${table} missing`);
        else if (missing.length) problems.push(`${table} missing ${missing.map((c) => `.${c}`).join(', ')}`);
      }
      for (const { type, value } of migration.enumValues) {
        const at = allColumns.find((c) => c.type === type);
        if (!at) {
          problems.push(`enum ${type} value '${value}' not checkable: no column of that type in any migration`);
          continue;
        }
        if (!(await hasEnumValue(db, at, value))) problems.push(`enum ${type} missing value '${value}'`);
      }
    } catch (err) {
      line('fail', `${migration.file.padEnd(width)}  could not be checked: ${errorMessage(err)}`);
      failed++;
      continue;
    }

    const checked = `${plural(byTable.size, 'table')}, ${plural(migration.columns.length, 'column')}` +
      (migration.enumValues.length ? `, ${plural(migration.enumValues.length, 'enum value')}` : '');

    if (byTable.size === 0 && migration.enumValues.length === 0) {
      line('warn', `${migration.file.padEnd(width)}  adds no tables, columns or enum values, so cannot be checked from here`);
    } else if (problems.length === 0) {
      line('pass', `${migration.file.padEnd(width)}  applied (${checked})`);
    } else {
      failed++;
      line('fail', `${migration.file.padEnd(width)}  NOT applied: ${problems.join('; ')}`);
      fix(`run supabase/migrations/${migration.file} in the Supabase SQL Editor`);
    }
  }

  if (failed) {
    note('migrations are cumulative: run the missing ones in file-name order');
  }
  record('Migrations', failed ? 'fail' : 'pass');
  return failed === 0;
}

// ---------------------------------------------------------------
// 3. Draft quality
// ---------------------------------------------------------------

interface DraftRow {
  id: string;
  subject: string | null;
  body: string;
  leads: { company_name: string | null } | null;
}

/** The adapter appends an unsubscribe footer on send; it is not the draft. */
function stripUnsubscribe(body: string): string {
  return body.replace(/\n\nUnsubscribe: \S+\s*$/, '');
}

async function checkDraftQuality(db: Db) {
  heading(`Draft quality (last ${DRAFT_SAMPLE} email actions)`);

  const { data, error } = await db
    .from('actions')
    .select('id, subject, body, leads(company_name)')
    .eq('channel', 'email')
    .order('created_at', { ascending: false })
    .limit(DRAFT_SAMPLE);

  if (error) {
    line('fail', `could not read actions: ${error.message}`);
    record('Draft quality', 'fail');
    return;
  }

  const drafts = (data ?? []) as unknown as DraftRow[];
  if (drafts.length === 0) {
    line('skip', 'no email actions in the database yet');
    record('Draft quality', 'skip');
    return;
  }

  const perRule = new Map<string, number>();
  let clean = 0;
  let withTells = 0;
  for (const draft of drafts) {
    const tells = findAiTells(
      { subject: draft.subject ?? undefined, body: stripUnsubscribe(draft.body) },
      { companyName: draft.leads?.company_name ?? null }
    );
    if (tells.length === 0) {
      clean++;
      continue;
    }
    withTells++;
    for (const tell of tells) perRule.set(tell.rule, (perRule.get(tell.rule) ?? 0) + 1);
  }

  const status: Status = withTells === 0 ? 'pass' : 'warn';
  line(status, `${clean} of ${drafts.length} clean`);
  if (withTells) {
    const rules = [...perRule.entries()].sort((a, b) => b[1] - a[1]);
    const width = Math.max(...rules.map(([rule]) => rule.length));
    note(`${withTells} carry tells; broken rules across the set:`);
    for (const [rule, count] of rules) note(`  ${rule.padEnd(width)}  ${count}`);
    fix('read the drafts on the queue page; if one rule dominates, the prompt in lib/anthropic/prompts/content-creator.ts needs a tighter example for it');
  }
  record('Draft quality', status);
}

// ---------------------------------------------------------------
// 4. Consent integrity
// ---------------------------------------------------------------

interface ConsentRow {
  lead_id: string;
  revoked_at: string | null;
  expires_at: string | null;
}

async function checkConsentIntegrity(db: Db) {
  heading('Consent integrity');

  try {
    const leads = await fetchAll<{ id: string }>((from, to) =>
      db.from('leads').select('id').range(from, to)
    );
    const consents = await fetchAll<ConsentRow>((from, to) =>
      db.from('consent_records').select('lead_id, revoked_at, expires_at').range(from, to)
    );

    const now = Date.now();
    const anyRecord = new Set<string>();
    const liveRecord = new Set<string>();
    for (const c of consents) {
      anyRecord.add(c.lead_id);
      const expired = c.expires_at !== null && new Date(c.expires_at).getTime() < now;
      if (c.revoked_at === null && !expired) liveRecord.add(c.lead_id);
    }
    const noRecord = leads.filter((l) => !anyRecord.has(l.id)).length;
    const onlyDead = leads.filter((l) => anyRecord.has(l.id) && !liveRecord.has(l.id)).length;

    line('pass', `${plural(leads.length, 'lead')}: ${noRecord} with no consent record, ${onlyDead} with only revoked or expired records`);
    if (noRecord) {
      note('a lead with no record is blocked at the gate, not sent; record a basis to unblock it (CSV import attests one, an inbound enquiry records one)');
    }

    const blocked = await fetchAll<{ block_reason: string | null }>((from, to) =>
      db.from('actions').select('block_reason').eq('status', 'blocked').range(from, to)
    );
    const byReason = new Map<string, number>();
    for (const b of blocked) {
      const reason = b.block_reason ?? '(no reason recorded)';
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    line('pass', `${plural(blocked.length, 'blocked action')}${blocked.length ? ', by reason:' : ''}`);
    const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
    const width = Math.max(0, ...reasons.map(([reason]) => reason.length));
    for (const [reason, count] of reasons) note(`  ${reason.padEnd(width)}  ${count}`);

    // The gate writes consent_basis before anything sends. A sent row without
    // one bypassed the gate, and that is the one thing this check must catch.
    const unbased = await db
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent')
      .is('consent_basis', null);
    if (unbased.error) throw new Error(unbased.error.message);
    const count = unbased.count ?? 0;
    if (count === 0) {
      line('pass', 'every sent action carries the consent basis it was approved on');
      record('Consent integrity', 'pass');
    } else {
      line('fail', `${plural(count, 'sent action')} with no consent basis recorded`);
      fix('something sent without going through evaluateConsent; find the rows with status = sent and consent_basis is null and trace which code path wrote them');
      record('Consent integrity', 'fail');
    }
  } catch (err) {
    line('fail', `could not read consent data: ${errorMessage(err)}`);
    record('Consent integrity', 'fail');
  }
}

// ---------------------------------------------------------------
// 5. Build health
// ---------------------------------------------------------------

function runStep(label: string, command: string, args: string[]): boolean {
  const started = Date.now();
  const proc = spawnSync(command, args, {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = proc.status === 0;

  if (ok) {
    line('pass', `${label.padEnd(14)} passed (${seconds}s)`);
    return true;
  }

  const reason = proc.error ? errorMessage(proc.error) : `exit code ${proc.status}`;
  line('fail', `${label.padEnd(14)} failed (${seconds}s, ${reason})`);
  const output = `${proc.stdout ?? ''}\n${proc.stderr ?? ''}`
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);
  const tail = output.slice(-25);
  if (output.length > tail.length) note(`... ${output.length - tail.length} earlier lines omitted`);
  for (const l of tail) note(l);
  fix(`run \`${[command, ...args].join(' ')}\` for the full output`);
  return false;
}

function checkBuildHealth() {
  heading('Build health');
  const tsc = runStep('tsc', 'npx', ['tsc', '--noEmit']);
  const test = runStep('npm test', 'npm', ['test']);
  const build = runStep('npm run build', 'npm', ['run', 'build']);
  record('Build health', tsc && test && build ? 'pass' : 'fail');
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  console.log('Cadence preflight');

  const env = checkEnvironment();
  const db = connect(env);

  if (!db) {
    skipDatabaseChecks(['Migrations', 'Draft quality', 'Consent integrity']);
  } else {
    const applied = await checkMigrations(db);
    if (applied) {
      await checkDraftQuality(db);
      await checkConsentIntegrity(db);
    } else {
      // Reading actions and consent_records against a half-migrated schema
      // would report the schema gap a second time, in confusing words.
      for (const name of ['Draft quality', 'Consent integrity']) {
        heading(name);
        line('skip', 'skipped until every migration is applied');
        record(name, 'skip');
      }
    }
  }

  checkBuildHealth();

  heading('Summary');
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`  ${r.name.padEnd(width)}  ${r.status === 'fail' ? 'FAIL' : r.status}`);

  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  console.log('');
  if (failed) {
    console.log(`${plural(failed, 'check')} failed.`);
    process.exit(1);
  }
  console.log(warned ? `All checks passed, ${plural(warned, 'warning')}.` : 'All checks passed.');
}

main().catch((err) => {
  console.error(`preflight crashed: ${errorMessage(err)}`);
  process.exit(1);
});
