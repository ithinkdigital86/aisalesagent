// app/api/sourcing/apollo/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { sourceFromApollo, type IcpFilters } from '@/lib/cadence/sourcing/apollo';
import { supabaseServer, supabaseService } from '@/lib/supabase/server';

const filtersSchema = z.object({
  industries: z.array(z.string().min(1)).optional(),
  employee_range: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .optional(),
  geos: z.array(z.string().min(1)).optional(),
  titles: z.array(z.string().min(1)).optional(),
  seniorities: z.array(z.string().min(1)).optional(),
  exclusions: z.object({ domains: z.array(z.string().min(1)).optional() }).optional(),
});

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(120),
  filters: filtersSchema,
  trigger_types: z.array(z.string().min(1)).max(20).optional().default([]),
  limit: z.number().int().min(1).max(100).optional().default(25),
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
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { workspaceId, name, filters, trigger_types, limit } = parsed.data;

    // RLS confirms ownership: a miss here means the workspace is not theirs.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    // Create the ICP profile under the caller's RLS client so ownership holds.
    const { data: icp, error: icpErr } = await db
      .from('icp_profiles')
      .insert({ workspace_id: workspaceId, name, filters, trigger_types })
      .select('id')
      .single();
    if (icpErr || !icp) {
      return NextResponse.json(
        { error: icpErr?.message ?? 'Could not create ICP profile' },
        { status: 400 }
      );
    }

    // Sourcing is a privileged system job: it reads the shared enrichment_cache
    // (service role only) and writes leads in bulk. Ownership is already
    // verified above, so running under the service role here is safe.
    const outcome = await sourceFromApollo(supabaseService(), {
      workspaceId,
      icpProfileId: icp.id as string,
      filters: filters as IcpFilters,
      limit,
    });

    return NextResponse.json({ data: { icpProfileId: icp.id, ...outcome } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
