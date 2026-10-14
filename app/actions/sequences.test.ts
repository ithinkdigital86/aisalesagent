// app/actions/sequences.test.ts
//
// Re-enrolling a lead whose run stopped. A rejected draft stops the run as
// step_rejected, but a person rejecting one draft is not always saying no to
// the lead, so putting that lead back on a sequence later must work and must
// start it over cleanly. The stops that are about the lead itself (a won,
// lost or booked stage, a suppression) are still refused.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { registerRouteLoader } from '../../lib/cadence/testing/route-loader.ts';
import {
  ACTION_DOUBLES,
  resetActionDoubles,
  useActionDb,
} from '../../lib/cadence/testing/action-doubles.ts';
import { addLead, addSequence, addWorkspace, cronDb, leadOf } from '../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader(ACTION_DOUBLES);
const { enrolLeads } = await import('./sequences.ts');

const WS = '10000000-0000-4000-8000-000000000001';
const SEQ = '20000000-0000-4000-8000-000000000001';
const LEAD = '30000000-0000-4000-8000-000000000001';

let db: FakeDb;

beforeEach(() => {
  db = cronDb();
  addWorkspace(db, WS);
  addSequence(db, WS, SEQ, [{ delay_days: 0 }, { delay_days: 3 }]);
  useActionDb(db);
});

afterEach(() => resetActionDoubles());

for (const reason of ['step_rejected', 'step_failed', 'step_expired', 'step_blocked', 'step_missing']) {
  test(`a lead stopped as ${reason} can be enrolled again, from step one`, async () => {
    addLead(db, WS, LEAD, {
      sequenceId: SEQ,
      sequenceStep: 2,
      stoppedReason: reason,
      nextActionAt: null,
    });

    const result = await enrolLeads({ workspaceId: WS, sequenceId: SEQ, leadIds: [LEAD] });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.enrolled, 1);
    assert.deepEqual(result.skipped, []);
    const lead = leadOf(db, LEAD);
    assert.equal(lead.sequence_stopped_reason, null);
    assert.equal(lead.sequence_step, 0);
    assert.equal(lead.assigned_sequence_id, SEQ);
    assert.ok(lead.next_action_at, 'due again');
  });
}

test('a lead whose stage ended the run is still refused', async () => {
  addLead(db, WS, LEAD, { stage: 'lost', sequenceId: SEQ, sequenceStep: 1, stoppedReason: 'stage:lost' });

  const result = await enrolLeads({ workspaceId: WS, sequenceId: SEQ, leadIds: [LEAD] });

  assert.equal(result.ok, false);
  assert.deepEqual(result.skipped, [{ leadId: LEAD, reason: 'lost' }]);
  assert.equal(leadOf(db, LEAD).sequence_stopped_reason, 'stage:lost');
});
