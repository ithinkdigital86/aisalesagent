// lib/cadence/suppression.test.ts
//
// Regression for the suppression write that never happened. The unique
// indexes on suppression_list were partial, every writer upserts with an
// onConflict PostgREST cannot qualify with a predicate, so Postgres raised
// 42P10 on every unsubscribe, bounce and complaint, and no caller looked.
//
// The index set is not typed out here. It is read from the migration files,
// replayed in order, so the test fails if a later migration brings a partial
// index back, and it shows the fault itself by replaying only up to 0008.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FakeDb, asClient, type UniqueIndex } from './testing/fake-postgrest.ts';
import { SuppressionWriteError, blockPendingActions, writeSuppression } from './suppression.ts';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** The unique indexes on one table after applying migrations up to `through`. */
function replayUniqueIndexes(table: string, through?: string): UniqueIndex[] {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => !through || file <= through);

  const indexes = new Map<string, UniqueIndex>();
  const statement =
    /create\s+unique\s+index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+(\w+)\s*\(([^)]*)\)\s*(?:where\s+([^;]+))?;|drop\s+index\s+(?:if\s+exists\s+)?(\w+)\s*;/gi;

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    for (const match of sql.matchAll(statement)) {
      const [, name, on, columns, where, dropped] = match;
      if (dropped) {
        indexes.delete(dropped);
      } else if (on === table) {
        indexes.set(name, {
          name,
          columns: columns.split(',').map((column) => column.trim()),
          where: where?.trim() ?? null,
        });
      }
    }
  }
  return [...indexes.values()];
}

function dbAt(through?: string): FakeDb {
  const db = new FakeDb();
  db.indexes.suppression_list = replayUniqueIndexes('suppression_list', through);
  return db;
}

const WS = 'ws-1';

// ---------------------------------------------------------------
// The fault, as it stood
// ---------------------------------------------------------------

test('before 0009 the upsert is refused with 42P10 and writeSuppression throws', async () => {
  const db = dbAt('0008_sequence_runner.sql');
  assert.ok(db.indexes.suppression_list.every((index) => index.where !== null), 'all three were partial');

  await assert.rejects(
    writeSuppression(asClient(db), { workspace_id: WS, email: 'a@x.com', reason: 'unsubscribed' }, 'workspace_id,email'),
    (err: unknown) => err instanceof SuppressionWriteError && err.code === '42P10'
  );
  assert.equal(db.rows('suppression_list').length, 0);
});

// ---------------------------------------------------------------
// After the migrations
// ---------------------------------------------------------------

test('the final migrations leave a plain unique index for every conflict target used', () => {
  const indexes = replayUniqueIndexes('suppression_list');
  for (const target of [['workspace_id', 'email'], ['workspace_id', 'phone']]) {
    const index = indexes.find(
      (i) => i.columns.length === target.length && target.every((c) => i.columns.includes(c))
    );
    assert.ok(index, `an index on (${target.join(', ')})`);
    assert.equal(index.where, null, `${index.name} must not be partial`);
  }
});

test('an unsubscribe writes the row, and a repeat is a no-op', async () => {
  const db = dbAt();
  const row = { workspace_id: WS, email: 'a@x.com', reason: 'unsubscribed' };

  await writeSuppression(asClient(db), row, 'workspace_id,email');
  await writeSuppression(asClient(db), row, 'workspace_id,email');

  assert.equal(db.rows('suppression_list').length, 1);
  assert.equal(db.rows('suppression_list')[0].email, 'a@x.com');
});

test('a phone-only suppression writes, and nulls do not collide with each other', async () => {
  const db = dbAt();
  await writeSuppression(asClient(db), { workspace_id: WS, phone: '+911', reason: 'hard_bounce' }, 'workspace_id,phone');
  await writeSuppression(asClient(db), { workspace_id: WS, phone: '+912', reason: 'hard_bounce' }, 'workspace_id,phone');
  await writeSuppression(asClient(db), { workspace_id: WS, email: 'b@x.com', reason: 'complaint' }, 'workspace_id,email');

  assert.equal(db.rows('suppression_list').length, 3);
});

test('any other database error throws rather than passing as success', async () => {
  const db = dbAt();
  db.indexes.suppression_list = [];

  await assert.rejects(
    writeSuppression(asClient(db), { workspace_id: WS, email: 'a@x.com', reason: 'unsubscribed' }, 'workspace_id,email'),
    SuppressionWriteError
  );
});

// ---------------------------------------------------------------
// Pending drafts
// ---------------------------------------------------------------

test('suppressing a lead blocks its unsent drafts and nothing else', async () => {
  const db = new FakeDb({
    actions: [
      { id: 'linkedin-draft', workspace_id: WS, lead_id: 'lead-1', status: 'awaiting_approval' },
      { id: 'queued-email', workspace_id: WS, lead_id: 'lead-1', status: 'queued' },
      { id: 'in-flight', workspace_id: WS, lead_id: 'lead-1', status: 'sending' },
      { id: 'already-sent', workspace_id: WS, lead_id: 'lead-1', status: 'sent' },
      { id: 'other-lead', workspace_id: WS, lead_id: 'lead-2', status: 'awaiting_approval' },
    ],
  });

  await blockPendingActions(asClient(db), WS, 'lead-1');

  const status = Object.fromEntries(db.rows('actions').map((a) => [a.id, [a.status, a.block_reason]]));
  assert.deepEqual(status['linkedin-draft'], ['blocked', 'lead_suppressed']);
  assert.deepEqual(status['queued-email'], ['blocked', 'lead_suppressed']);
  assert.deepEqual(status['in-flight'], ['sending', undefined]);
  assert.deepEqual(status['already-sent'], ['sent', undefined]);
  assert.deepEqual(status['other-lead'], ['awaiting_approval', undefined]);
});
