// app/api/agents/icp-strategist/route.ts
//
// Runs the ICP strategist for a workspace and stores what it proposed: one
// icp_generations row and ten icp_profiles rows pointing at it, every one of
// them inactive. Nothing here, and nothing downstream of here, activates a
// generated profile. That is a button on the ICP page and a human presses it.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { StrategistOutput } from '@/lib/anthropic/prompts/icp-strategist';
import { loadBusinessProfile } from '@/lib/cadence/business-profile';
import { SIZE_BANDS, bandFor } from '@/lib/cadence/icp-shape';
import { runAgent, statusForFailure } from '@/lib/cadence/runtime';
import { supabaseServer } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

// An Opus run over ten profiles takes around 90 seconds at medium effort,
// and the corrective retry can double that. Same allowance as the crons.
export const maxDuration = 300;

const bodySchema = z.object({ workspaceId: z.string().uuid() });

/** What the salvage parse adds when it had to drop proposals. */
type Output = StrategistOutput & { dropped_profiles?: string[] };

export async function POST(request: Request) {
  try {
    const db = await supabaseServer();

    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { workspaceId } = parsed.data;

    // RLS confirms ownership, so a miss here means it is not theirs.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // The agent reads the business profile through its context scope. It is
    // loaded here too, before any model call, so an empty one is a clean 400
    // rather than ten profiles invented from a company name.
    const businessProfile = await loadBusinessProfile(db, workspaceId);
    if (!businessProfile) {
      return NextResponse.json(
        {
          error:
            'No business profile. Describe the business on the ICP page before generating suggestions.',
        },
        { status: 400 }
      );
    }

    const run = await runAgent<Output>(db, { agent: 'icp_strategist', workspaceId });
    if (!run.ok || !run.data) {
      return NextResponse.json(
        { error: run.error ?? 'ICP strategist run failed', failure: run.failure ?? null },
        { status: statusForFailure(run.failure) }
      );
    }
    const output = run.data;

    // The generation row first, so the profiles have something to point at.
    // Its recommendation is filled in once the profiles exist and have ids.
    const { data: generation, error: generationErr } = await db
      .from('icp_generations')
      .insert({
        workspace_id: workspaceId,
        agent_run_id: run.runId ?? null,
        business_profile_snapshot: businessProfile as unknown as Json,
        recommendation_reason: output.recommendation_reason,
      })
      .select('id')
      .single();
    if (generationErr || !generation) {
      return NextResponse.json(
        { error: generationErr?.message ?? 'Could not record the generation' },
        { status: 500 }
      );
    }

    // active is set to false explicitly, not left to the column default,
    // which is true. A generated profile is a suggestion until a person says
    // otherwise, and this is the line that makes that so.
    const rows = output.profiles.map((profile) => {
      const band = bandFor(profile.size_band) ?? SIZE_BANDS[0];
      return {
        workspace_id: workspaceId,
        name: profile.name,
        offer: profile.offer.trim() === '' ? null : profile.offer,
        filters: {
          industries: [profile.industry],
          titles: profile.buyer_roles,
          geos: profile.geography,
          size_band: profile.size_band,
          // Mirrored so the Apollo filters, which predate bands, read the
          // same profile the Qualifier does.
          employee_range: [...band.range],
        } as Json,
        trigger_types: profile.buying_triggers,
        pain_points: profile.pain_points,
        exclusions: profile.exclusions,
        rationale: profile.rationale,
        origin: 'generated',
        generation_id: generation.id,
        active: false,
      };
    });

    const { data: inserted, error: insertErr } = await db
      .from('icp_profiles')
      .insert(rows)
      .select('id, name');
    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: insertErr?.message ?? 'Could not store the proposed profiles' },
        { status: 500 }
      );
    }

    // Insert order is preserved for a single multi-row insert, so the agent's
    // 1-based index maps straight onto the returned rows. Matched by name as a
    // check, and left unset rather than guessed if the two disagree.
    const pick = output.profiles[output.recommended_index - 1];
    const recommended = inserted[output.recommended_index - 1];
    const recommendedId = pick && recommended && recommended.name === pick.name ? recommended.id : null;

    if (recommendedId) {
      await db
        .from('icp_generations')
        .update({ recommended_icp_id: recommendedId })
        .eq('id', generation.id)
        .eq('workspace_id', workspaceId);
    }

    return NextResponse.json({
      data: {
        generationId: generation.id,
        count: inserted.length,
        recommendedId,
        droppedProfiles: output.dropped_profiles ?? [],
      },
      // A salvaged run is a success with something missing from it. Say so.
      salvage: run.salvage ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
