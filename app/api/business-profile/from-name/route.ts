// app/api/business-profile/from-name/route.ts
//
// The fallback for a website the reader could not read. Returns guesses for
// the business profile form made from the company name, the domain, and
// whatever one more look at the homepage recovers (a title, a meta
// description). Nothing here is checked against anything: there is no page
// text for a quote to be found in, so the reader's verification does not
// apply, and every guess is returned as a guess.
//
// It stores nothing. The form shows each guess with its reasoning, the owner
// accepts them one at a time, and a field that takes one is saved with
// origin 'inferred' so everything that reads the profile can see it is
// unverified.
//
// An API route rather than a server action for the same reason as the
// reader: one fetch and an Opus call can take the best part of a minute.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { collectGuesses, countGuesses, type GuesserOutput } from '@/lib/anthropic/prompts/profile-guesser';
import { BUSINESS_PROFILE_LIMITS } from '@/lib/cadence/business-profile';
import { runAgent, statusForFailure } from '@/lib/cadence/runtime';
import { normaliseSiteUrl, readSiteScraps, siteDomain } from '@/lib/cadence/site-reader';
import { supabaseServer } from '@/lib/supabase/server';

// Up to eight seconds on the homepage, then an Opus call over very little.
export const maxDuration = 90;

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  companyName: z
    .string()
    .trim()
    .min(1, 'Enter the company name first: the guesses are made from it')
    .max(BUSINESS_PROFILE_LIMITS.companyName),
  url: z.string().trim().max(BUSINESS_PROFILE_LIMITS.website).optional(),
});

export async function POST(request: Request) {
  try {
    const db = await supabaseServer();

    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      );
    }
    const { workspaceId, companyName, url } = parsed.data;

    // RLS confirms ownership, so a miss here means it is not theirs.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // The domain is what the model guesses from, so a website that is not a
    // web address is refused rather than passed through as a string. No
    // website at all is allowed: the name alone is something to go on.
    let domain: string | null = null;
    if (url && url !== '') {
      const home = normaliseSiteUrl(url);
      if (!home) {
        return NextResponse.json(
          { error: 'Enter the website as a web address, such as example.com' },
          { status: 400 }
        );
      }
      domain = siteDomain(home);
    }

    // One more look at the homepage. It failed the full read, so this is
    // expected to return little or nothing, and nothing is fine.
    const scraps = url && url !== '' ? await readSiteScraps(url) : null;

    const run = await runAgent<GuesserOutput>(db, {
      agent: 'profile_guesser',
      workspaceId,
      extra: { companyName, domain: scraps?.domain ?? domain, scraps },
    });
    if (!run.ok || !run.data) {
      return NextResponse.json(
        { error: run.error ?? 'The profile guesser failed', failure: run.failure ?? null },
        { status: statusForFailure(run.failure) }
      );
    }

    const guesses = collectGuesses(run.data);

    return NextResponse.json({
      data: {
        origin: 'inferred' as const,
        companyName,
        domain: scraps?.domain ?? domain,
        // What the owner is shown about the one look at the homepage, so
        // they can see how little the guesses had to go on.
        scraps: scraps
          ? { title: scraps.title, description: scraps.description, chars: scraps.text.length }
          : null,
        guesses,
        count: countGuesses(guesses),
        notes: run.data.notes,
      },
      salvage: run.salvage ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error' },
      { status: 500 }
    );
  }
}
