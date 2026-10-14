// app/api/cron/send-queue/route.ts
//
// Runs frequently. Two passes, in this order:
//
//  1. Sequences. Every lead whose next step is due gets that step drafted and
//     queued, or its run stopped. This goes first so a step queued now is
//     delivered by the pass below on the same tick rather than the next one.
//
//  2. Delivery. Queued email actions whose scheduled_for has passed: the
//     consent gate is re-run on each, then it sends, then the row is updated.
//
// Both passes skip a workspace whose kill switch is on, and delivery stops a
// workspace at its daily cap; see lib/cadence/send-controls.ts.

import { NextResponse } from 'next/server';

import { isCronRequest } from '@/lib/cadence/cron-auth';
import { deliverDueEmails } from '@/lib/cadence/send-queue';
import { runDueSequenceSteps } from '@/lib/cadence/sequence-runner';
import { supabaseService } from '@/lib/supabase/server';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const db = supabaseService();

  try {
    const sequences = await runDueSequenceSteps(db);
    const delivery = await deliverDueEmails(db);
    return NextResponse.json({ sequences, ...delivery });
  } catch (err) {
    // A read the limits depend on failed. Nothing more was sent; the next
    // tick tries again.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
