// app/api/business-profile/from-website/route.ts
//
// Reads a company website and returns draft entries for the business profile
// form, each with the quote from the site it rests on. It stores nothing:
// the form shows the entries as suggestions, the owner accepts them field by
// field, and saving the form is the only write. A read that fails, fails
// whole, with a reason the owner can act on and the pages that were read
// before it did, so a bad extraction is traceable and a failed one never
// half-fills the form.
//
// An API route rather than a server action because reading a site and then
// running the model can take the best part of a minute.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  countSuggestions,
  verifySuggestions,
  type ReaderOutput,
} from '@/lib/anthropic/prompts/website-reader';
import { BUSINESS_PROFILE_LIMITS } from '@/lib/cadence/business-profile';
import { runAgent, statusForFailure } from '@/lib/cadence/runtime';
import { readWebsite, SITE_READER_LIMITS, type SiteReadFailureKind } from '@/lib/cadence/site-reader';
import { supabaseServer } from '@/lib/supabase/server';

// Up to 30 seconds reading the site, then an Opus call over the text of it.
export const maxDuration = 120;

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  url: z.string().trim().min(1, 'Enter the website first').max(BUSINESS_PROFILE_LIMITS.website),
  companyName: z.string().trim().max(BUSINESS_PROFILE_LIMITS.companyName).optional(),
});

/** What the owner is shown about each page, without the text itself. */
function pageSummary(page: { url: string; title: string | null; text: string }) {
  return { url: page.url, title: page.title, chars: page.text.length };
}

/**
 * A bad address is the caller's to fix; anything else went wrong between our
 * server and theirs, and 422 says "understood, could not be done" without
 * sending anyone to look for an outage on this side.
 */
function statusForRead(kind: SiteReadFailureKind): number {
  return kind === 'invalid_url' || kind === 'blocked_host' ? 400 : 422;
}

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
    const { workspaceId, url, companyName } = parsed.data;

    // RLS confirms ownership, so a miss here means it is not theirs.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const read = await readWebsite(url);
    if (!read.ok) {
      return NextResponse.json(
        {
          error: read.detail,
          kind: read.kind,
          pages: read.pages.map(pageSummary),
          skipped: read.skipped,
        },
        { status: statusForRead(read.kind) }
      );
    }

    const run = await runAgent<ReaderOutput>(db, {
      agent: 'website_reader',
      workspaceId,
      extra: { pages: read.pages, companyName },
    });
    if (!run.ok || !run.data) {
      return NextResponse.json(
        {
          error: run.error ?? 'The website reader failed',
          failure: run.failure ?? null,
          pages: read.pages.map(pageSummary),
          skipped: read.skipped,
        },
        { status: statusForFailure(run.failure) }
      );
    }

    // The check that makes the no-invention rule a rule: a value whose quote
    // is not in the text the model was given does not reach the form.
    const { suggestions, unsupported } = verifySuggestions(run.data, read.pages);

    return NextResponse.json({
      data: {
        domain: read.domain,
        pages: read.pages.map(pageSummary),
        skipped: read.skipped,
        suggestions,
        count: countSuggestions(suggestions),
        unsupported,
        notes: run.data.notes,
        limits: { pages: SITE_READER_LIMITS.pages, seconds: SITE_READER_LIMITS.budgetMs / 1000 },
        elapsedMs: read.elapsedMs,
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
