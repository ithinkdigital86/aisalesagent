// app/api/cron/auth.test.ts
//
// CRON_SECRET on all three cron routes. Each one runs across every workspace,
// so a request that gets past this check can draft, send or spend model calls
// for all of them. A refused request must do nothing at all: no database
// client, no model call, no email.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { registerRouteLoader } from '../../../lib/cadence/testing/route-loader.ts';
import { CRON_DOUBLES, agentCalls, resetDoubles, scriptAgents, useDb } from '../../../lib/cadence/testing/cron-doubles.ts';
import {
  SECRET,
  addLead,
  addWorkspace,
  cronDb,
  cronRequest,
  queueEmails,
  stubNetwork,
  type ResendStub,
} from '../../../lib/cadence/testing/cron-world.ts';
import type { FakeDb } from '../../../lib/cadence/testing/fake-postgrest.ts';

registerRouteLoader(CRON_DOUBLES);

const routes = {
  'sales-manager': (await import('./sales-manager/route.ts')).GET,
  'send-queue': (await import('./send-queue/route.ts')).GET,
  'follow-up': (await import('./follow-up/route.ts')).GET,
};

let db: FakeDb;
let resend: ResendStub;
let statements = 0;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  // One workspace with something for every route to act on: activity for the
  // review, a queued email, and a lead due for follow-up.
  db = cronDb();
  addWorkspace(db, 'ws');
  addLead(db, 'ws', 'lead');
  queueEmails(db, 'ws', 'lead', 1);
  statements = 0;
  db.faults.push(() => {
    statements += 1;
    return null;
  });
  useDb(db);
  scriptAgents(() => ({ ok: true, data: { next_action: 'wait', next_channel: 'none', wait_hours: 24, new_stage: 'contacted', sentiment: 'neutral' } }));
  resend = stubNetwork();
});

afterEach(() => {
  resend.restore();
  resetDoubles();
});

for (const [name, GET] of Object.entries(routes)) {
  describe(name, () => {
    const refused = async (request: Request) => {
      const response = await GET(request);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorised' });
      assert.equal(statements, 0, 'no statement reached the database');
      assert.equal(agentCalls.length, 0, 'no model call');
      assert.deepEqual(resend.sent, [], 'no email');
    };

    test('a request with no authorization header is refused', async () => {
      await refused(cronRequest(null));
    });

    test('a wrong secret is refused', async () => {
      await refused(cronRequest('Bearer not-the-secret'));
    });

    test('the right secret without the Bearer scheme is refused', async () => {
      await refused(cronRequest(SECRET));
    });

    test('with CRON_SECRET unset, "Bearer undefined" is refused', async () => {
      delete process.env.CRON_SECRET;
      await refused(cronRequest('Bearer undefined'));
    });

    test('with CRON_SECRET empty, an empty bearer token is refused', async () => {
      process.env.CRON_SECRET = '';
      await refused(cronRequest('Bearer '));
    });

    test('the right secret runs the cron', async () => {
      const response = await GET(cronRequest());
      assert.equal(response.status, 200);
      assert.ok(statements > 0);
    });
  });
}
