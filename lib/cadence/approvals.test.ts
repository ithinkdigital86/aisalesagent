// lib/cadence/approvals.test.ts
//
// Regression for approvals that bypassed consent. Approving a LinkedIn,
// Instagram or voice draft marked it sent with no gate in between, so a draft
// written before the lead unsubscribed was recorded as sent to a suppressed
// lead. Email was never affected: approval only queues it, and the send path
// runs the gate.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FakeDb, asClient } from './testing/fake-postgrest.ts';
import { approvalPatch } from './approvals.ts';

const WS = 'ws-1';
const LEAD = 'lead-1';
const NOW = '2026-10-13T09:00:00.000Z';

function world(lead: Record<string, unknown> = {}, extra: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  return new FakeDb({
    leads: [
      {
        id: LEAD,
        workspace_id: WS,
        email: 'lead@acme.com',
        phone: '+15550100',
        company_domain: 'acme.com',
        country: 'US',
        stage: 'contacted',
        ...lead,
      },
    ],
    workspaces: [{ id: WS, jurisdictions: ['US'], dlt_registered: false }],
    consent_records: [],
    suppression_list: [],
    ...extra,
  });
}

function approve(db: FakeDb, channel: 'email' | 'linkedin' | 'instagram' | 'voice') {
  return approvalPatch(asClient(db), { workspace_id: WS, lead_id: LEAD, channel }, NOW);
}

test('a LinkedIn draft for a lead suppressed after it was written is blocked, not sent', async () => {
  const patch = await approve(world({ stage: 'suppressed' }), 'linkedin');
  assert.deepEqual(patch, { status: 'blocked', block_reason: 'lead_suppressed' });
});

test('an Instagram draft whose address is on the suppression list is blocked', async () => {
  const db = world({}, { suppression_list: [{ workspace_id: WS, email: 'lead@acme.com', reason: 'unsubscribed' }] });
  const patch = await approve(db, 'instagram');
  assert.deepEqual(patch, { status: 'blocked', block_reason: 'suppressed:unsubscribed' });
});

test('a voice draft without written consent is blocked in the US', async () => {
  const patch = await approve(world(), 'voice');
  assert.equal(patch.status, 'blocked');
  assert.match((patch as { block_reason: string }).block_reason, /^insufficient_consent:US:voice/);
});

test('a LinkedIn draft for a clean lead is approved and records the basis', async () => {
  const patch = await approve(world(), 'linkedin');
  assert.deepEqual(patch, { status: 'sent', sent_at: NOW, consent_basis: 'none' });
});

test('email is queued without a gate here, because the send path runs it', async () => {
  const patch = await approve(world({ stage: 'suppressed' }), 'email');
  assert.deepEqual(patch, { status: 'queued', scheduled_for: NOW });
});
