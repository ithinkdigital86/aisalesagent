'use server';

// app/actions/sending.ts
//
// The dashboard's controls over unattended sending: the kill switch and the
// two limits (migration 0011). Both run on the request-scoped (RLS) client,
// so only the workspace's owner can change them.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { supabaseServer } from '@/lib/supabase/server';

export interface SendingActionResult {
  ok: boolean;
  error?: string;
}

/** Every page that shows the sending state. */
function revalidateSendingPages() {
  for (const path of ['/', '/leads', '/approvals', '/sequences']) revalidatePath(path);
}

const pauseSchema = z.object({
  workspaceId: z.string().uuid(),
  paused: z.boolean(),
});

/**
 * Turn the kill switch on or off. On takes effect at the next claim: a row
 * already claimed finishes, nothing after it starts. Off lets everything
 * that waited go on the next pass, within the daily cap.
 */
export async function setSendingPaused(input: {
  workspaceId: string;
  paused: boolean;
}): Promise<SendingActionResult> {
  try {
    const parsed = pauseSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid request' };

    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'Unauthorised' };

    // Turning it off leaves the last pause's time and author in place, as
    // the record of when sending was last stopped and by whom.
    const patch = parsed.data.paused
      ? { sending_paused: true, sending_paused_at: new Date().toISOString(), sending_paused_by: user.id }
      : { sending_paused: false };

    const { data, error } = await db
      .from('workspaces')
      .update(patch)
      .eq('id', parsed.data.workspaceId)
      .select('id');
    if (error) return { ok: false, error: error.message };
    // RLS turns someone else's workspace into zero rows, not an error.
    if (!data?.length) return { ok: false, error: 'Workspace not found' };

    revalidateSendingPages();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

const limitsSchema = z.object({
  workspaceId: z.string().uuid(),
  dailySendCap: z
    .number({ message: 'The daily cap must be a number' })
    .int('The daily cap must be a whole number')
    .min(0, 'The daily cap cannot be negative')
    .max(10000, 'The daily cap can be at most 10000'),
  minFitScore: z
    .number({ message: 'The minimum fit score must be a number' })
    .int('The minimum fit score must be a whole number')
    .min(0, 'The minimum fit score is between 0 and 100')
    .max(100, 'The minimum fit score is between 0 and 100'),
});

export async function saveSendingLimits(input: {
  workspaceId: string;
  dailySendCap: number;
  minFitScore: number;
}): Promise<SendingActionResult> {
  try {
    const parsed = limitsSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid limits' };
    }

    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'Unauthorised' };

    const { data, error } = await db
      .from('workspaces')
      .update({
        daily_send_cap: parsed.data.dailySendCap,
        min_fit_score: parsed.data.minFitScore,
      })
      .eq('id', parsed.data.workspaceId)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: 'Workspace not found' };

    revalidateSendingPages();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}
