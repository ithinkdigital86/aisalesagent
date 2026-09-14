'use server';

// app/actions/business-profile.ts
//
// One server action behind the business profile form. The profile is one row
// per workspace, so saving is an upsert on workspace_id; the request-scoped
// (RLS) client means a caller can only ever write their own.
//
// The form also sends where each drafted field's text came from (typed,
// accepted from the website, or accepted from the guesser). That is stored
// with the row, normalised so an origin never names an empty field, because
// the ICP strategist and the ICP page read it to tell research from guesses.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  businessProfileSchema,
  fieldOriginsToRow,
  normaliseFieldOrigins,
  type BusinessProfileInput,
} from '@/lib/cadence/business-profile';
import { supabaseServer } from '@/lib/supabase/server';

export interface BusinessProfileActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const saveSchema = businessProfileSchema.extend({
  workspaceId: z.string().uuid(),
});

export type SaveBusinessProfileInput = BusinessProfileInput & { workspaceId: string };

export async function saveBusinessProfile(
  input: SaveBusinessProfileInput
): Promise<BusinessProfileActionResult> {
  try {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid profile' };
    }
    const value = parsed.data;
    const origins = normaliseFieldOrigins(value.fieldOrigins, value);

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

    const { data, error } = await db
      .from('business_profiles')
      .upsert(
        {
          workspace_id: value.workspaceId,
          company_name: value.companyName,
          website: value.website === '' ? null : value.website,
          description: value.description === '' ? null : value.description,
          services: value.services,
          industries_served: value.industriesServed,
          customer_types: value.customerTypes,
          problems_solved: value.problemsSolved,
          differentiators: value.differentiators,
          pricing_model: value.pricingModel === '' ? null : value.pricingModel,
          exclusions: value.exclusions,
          field_origins: fieldOriginsToRow(origins),
        },
        { onConflict: 'workspace_id' }
      )
      .select('id')
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the profile' };

    revalidatePath('/icp');
    revalidatePath('/icp/business');
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown_error' };
  }
}
