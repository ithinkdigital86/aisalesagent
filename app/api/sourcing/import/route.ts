// app/api/sourcing/import/route.ts
//
// CSV lead import. One endpoint, two modes: 'preview' reads the file and
// reports what would happen, 'commit' does it. Both parse from the uploaded
// text every time — the browser never sends back a plan for the server to
// trust, so a preview cannot be edited into a different import.
//
// A route handler rather than a server action because a server action body is
// capped at 1MB by default, and a few thousand rows of an Apollo export is
// comfortably more than that.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { CsvImportError } from '@/lib/cadence/sourcing/csv';
import {
  commitImport,
  ImportError,
  MIN_SOURCE_DESCRIPTION,
  planImport,
} from '@/lib/cadence/sourcing/import';
import { supabaseServer } from '@/lib/supabase/server';

// Thousands of rows go in one row at a time when the dedupe index trips, so
// give the import room to finish rather than half-importing on a timeout.
export const maxDuration = 300;

/**
 * Comfortably inside the 4.5MB platform request body limit, with room for what
 * JSON encoding adds to the raw text.
 */
const MAX_CSV_CHARS = 3_000_000;

const base = z.object({
  workspaceId: z.string().uuid(),
  fileName: z.string().max(255).nullish(),
  csv: z
    .string()
    .min(1, 'The file is empty')
    .max(MAX_CSV_CHARS, 'That file is too large. Split it and import the parts.'),
});

const bodySchema = z.discriminatedUnion('mode', [
  base.extend({ mode: z.literal('preview') }),
  base.extend({
    mode: z.literal('commit'),
    /**
     * The compliance surface. `grant: false` is the default and means exactly
     * what it says: the leads are created with no consent record at all, and
     * the consent gate refuses every send against them until something else
     * gives them a basis.
     */
    consent: z
      .object({
        grant: z.boolean(),
        sourceDescription: z.string().max(2000).default(''),
      })
      .default({ grant: false, sourceDescription: '' }),
  }),
]);

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
    const body = parsed.data;

    // RLS confirms ownership: a miss here means the workspace is not theirs.
    const { data: workspace } = await db
      .from('workspaces')
      .select('id')
      .eq('id', body.workspaceId)
      .maybeSingle();
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (body.mode === 'preview') {
      const plan = await planImport(db, {
        workspaceId: body.workspaceId,
        csv: body.csv,
      });
      return NextResponse.json({ data: plan.summary });
    }

    // Granting a basis is a declaration, so it needs both halves: the tick, and
    // a description of the list long enough to mean something. Checked here as
    // well as in the form, because the form is not the security boundary.
    const description = body.consent.sourceDescription.trim();
    if (body.consent.grant && description.length < MIN_SOURCE_DESCRIPTION) {
      return NextResponse.json(
        {
          error: `Describe where this list came from in at least ${MIN_SOURCE_DESCRIPTION} characters before declaring a basis.`,
        },
        { status: 400 }
      );
    }

    const outcome = await commitImport(db, {
      workspaceId: body.workspaceId,
      csv: body.csv,
      fileName: body.fileName ?? null,
      consent: body.consent.grant
        ? { sourceDescription: description, attestedBy: user.id }
        : null,
    });

    return NextResponse.json({ data: outcome });
  } catch (err) {
    if (err instanceof CsvImportError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof ImportError) {
      const clientFault =
        err.code === 'source_description_too_short' || err.code === 'no_attester';
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: clientFault ? 400 : 500 }
      );
    }
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
