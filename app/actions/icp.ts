'use server';

// app/actions/icp.ts
//
// Server actions behind the ICP form. Everything runs on the request-scoped
// (RLS) client, so a caller can only ever touch profiles in a workspace they
// own; the explicit workspace check below is there to return a clean message
// rather than a silent no-op.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { SIZE_BANDS, bandFor, sizeBandValues } from '@/lib/cadence/icp-shape';
import { supabaseServer } from '@/lib/supabase/server';
import type { Json } from '@/types/database';

export interface IcpActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const saveSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Absent means create. */
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Give the profile a name').max(120),
  industries: z.array(z.string().trim().min(1)).max(20),
  titles: z.array(z.string().trim().min(1)).max(30),
  geos: z.array(z.string().trim().min(1)).max(20),
  sizeBand: z.enum(sizeBandValues).optional(),
  excludeDomains: z.array(z.string().trim().min(1)).max(50).default([]),
  triggerTypes: z.array(z.string().trim().min(1)).max(20).default([]),
  offer: z.string().trim().max(2000),
  /** Make this the profile the agents read once it is saved. */
  makeActive: z.boolean().default(false),
});

export type SaveIcpInput = z.input<typeof saveSchema>;

export async function saveIcp(input: SaveIcpInput): Promise<IcpActionResult> {
  try {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid profile' };
    }
    const value = parsed.data;

    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'Unauthorised' };

    // RLS confirms ownership: a miss means the workspace is not theirs.
    const { data: ws } = await db
      .from('workspaces')
      .select('id')
      .eq('id', value.workspaceId)
      .maybeSingle();
    if (!ws) return { ok: false, error: 'Workspace not found' };

    // Keep any keys an older profile carries that this form does not edit.
    let existingFilters: Record<string, unknown> = {};
    if (value.id) {
      const { data: current } = await db
        .from('icp_profiles')
        .select('filters')
        .eq('id', value.id)
        .eq('workspace_id', value.workspaceId)
        .maybeSingle();
      if (!current) return { ok: false, error: 'Profile not found' };
      existingFilters =
        current.filters && typeof current.filters === 'object' && !Array.isArray(current.filters)
          ? (current.filters as Record<string, unknown>)
          : {};
    }

    const filters: Record<string, unknown> = { ...existingFilters };
    assign(filters, 'industries', value.industries);
    assign(filters, 'titles', value.titles);
    assign(filters, 'geos', value.geos);
    if (value.excludeDomains.length) filters.exclusions = { domains: value.excludeDomains };
    else delete filters.exclusions;

    if (value.sizeBand) {
      filters.size_band = value.sizeBand;
      // Mirror the band into employee_range so the Apollo filters, which predate
      // bands, keep working off the same profile.
      filters.employee_range = [...(bandFor(value.sizeBand) ?? SIZE_BANDS[0]).range];
    } else {
      delete filters.size_band;
      delete filters.employee_range;
    }

    const row = {
      workspace_id: value.workspaceId,
      name: value.name,
      offer: value.offer === '' ? null : value.offer,
      filters: filters as Json,
      trigger_types: value.triggerTypes,
    };

    let id: string;
    let activateBecauseFirst = false;

    if (value.id) {
      const { error } = await db
        .from('icp_profiles')
        .update(row)
        .eq('id', value.id)
        .eq('workspace_id', value.workspaceId);
      if (error) return { ok: false, error: error.message };
      id = value.id;
    } else {
      // The first profile in a workspace becomes the active one: a workspace
      // with a profile nobody activated is the bug this page exists to fix.
      const { count } = await db
        .from('icp_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', value.workspaceId);

      const { data: created, error } = await db
        .from('icp_profiles')
        .insert({ ...row, active: false })
        .select('id')
        .single();
      if (error || !created) {
        return { ok: false, error: error?.message ?? 'Could not create the profile' };
      }
      id = created.id;
      activateBecauseFirst = (count ?? 0) === 0;
    }

    if (value.makeActive || activateBecauseFirst) {
      const activated = await activate(db, value.workspaceId, id);
      if (!activated.ok) return activated;
    }

    revalidatePath('/icp');
    revalidatePath('/leads');
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

const activateSchema = z.object({
  workspaceId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function activateIcp(input: {
  workspaceId: string;
  id: string;
}): Promise<IcpActionResult> {
  try {
    const parsed = activateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'Invalid profile' };

    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { ok: false, error: 'Unauthorised' };

    const result = await activate(db, parsed.data.workspaceId, parsed.data.id);
    if (!result.ok) return result;

    revalidatePath('/icp');
    revalidatePath('/leads');
    return { ok: true, id: parsed.data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}

/**
 * Exactly one active profile per workspace, enforced by a partial unique index.
 * The index means the others have to be cleared before the chosen one is set,
 * not after, so this is two statements and the order matters.
 */
async function activate(
  db: Awaited<ReturnType<typeof supabaseServer>>,
  workspaceId: string,
  id: string
): Promise<IcpActionResult> {
  const { data: target } = await db
    .from('icp_profiles')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!target) return { ok: false, error: 'Profile not found' };

  const { error: clearErr } = await db
    .from('icp_profiles')
    .update({ active: false })
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .neq('id', id);
  if (clearErr) return { ok: false, error: clearErr.message };

  const { error } = await db
    .from('icp_profiles')
    .update({ active: true })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, id };
}

function assign(target: Record<string, unknown>, key: string, values: string[]) {
  if (values.length) target[key] = values;
  else delete target[key];
}
