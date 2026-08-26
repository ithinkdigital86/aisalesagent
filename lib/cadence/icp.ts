// lib/cadence/icp.ts
//
// The ideal customer profile is the one piece of judgement the agents cannot
// infer for themselves. Everything that scores or writes to a lead reads the
// workspace's active profile through here, so there is exactly one definition
// of "active" and one shape for the filters blob.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';
import { SIZE_BANDS, bandFor, sizeBandValues, type IcpFiltersShape } from './icp-shape';

export { SIZE_BANDS, bandFor, sizeBandValues };
export type { IcpFiltersShape, SizeBand } from './icp-shape';

/**
 * Runtime guard for the filters blob. Unknown keys are preserved by the form so
 * an older profile does not lose data on save; anything unparseable is dropped
 * rather than trusted.
 */
export const icpFiltersSchema = z.object({
  industries: z.array(z.string().min(1)).optional(),
  titles: z.array(z.string().min(1)).optional(),
  seniorities: z.array(z.string().min(1)).optional(),
  geos: z.array(z.string().min(1)).optional(),
  size_band: z.enum(sizeBandValues).optional(),
  employee_range: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .optional(),
  exclusions: z.object({ domains: z.array(z.string().min(1)).optional() }).optional(),
});

/** The columns any agent-facing read of an ICP needs. */
export const ICP_COLUMNS = 'id, name, offer, filters, trigger_types, active, updated_at';

export interface ActiveIcp {
  id: string;
  name: string;
  offer: string | null;
  filters: IcpFiltersShape;
  trigger_types: string[];
}

/**
 * The workspace's active profile, or null when the owner has not set one yet.
 * Callers decide what a missing profile means: the Qualifier refuses to score
 * without one, the specialists just write without an offer paragraph.
 */
export async function loadActiveIcp(
  db: SupabaseClient<Database>,
  workspaceId: string
): Promise<ActiveIcp | null> {
  const { data } = await db
    .from('icp_profiles')
    .select('id, name, offer, filters, trigger_types')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    offer: data.offer,
    filters: parseFilters(data.filters),
    trigger_types: data.trigger_types ?? [],
  };
}

/** Tolerant read of the jsonb blob: a malformed profile must not throw. */
export function parseFilters(filters: Json | null | undefined): IcpFiltersShape {
  const parsed = icpFiltersSchema.safeParse(filters ?? {});
  return parsed.success ? (parsed.data as IcpFiltersShape) : {};
}

/**
 * The size band as plain numbers. `max` is null for the open-ended top band,
 * which has no real ceiling.
 */
export interface SizeBounds {
  min: number;
  max: number | null;
  /** Half the minimum, and double the maximum: the near-miss window. */
  nearMin: number;
  nearMax: number | null;
}

/** The band a profile asks for, or null when it does not constrain size. */
export function sizeBounds(icp: ActiveIcp | null | undefined): SizeBounds | null {
  if (!icp) return null;

  const band = bandFor(icp.filters.size_band);
  const range = band?.range ?? icp.filters.employee_range;
  if (!range) return null;

  const min = range[0];
  const max = band?.openEnded ? null : range[1];

  return {
    min,
    max,
    nearMin: Math.max(1, Math.floor(min / 2)),
    nearMax: max === null ? null : max * 2,
  };
}

export type SizeVerdict = 'inside' | 'near' | 'far' | 'unknown' | 'unconstrained';

/**
 * Where a company's headcount sits against the band, decided here rather than
 * in the model. Asking a model to compare two numbers it read out of a prompt
 * produced confident nonsense ("180 employees exceeds the 51-200 range"), and
 * an inclusive range comparison is not something worth spending a model call
 * on. The prompt quotes `line` and the model reports it.
 */
export function compareSize(
  employeeCount: number | null | undefined,
  icp: ActiveIcp | null | undefined
): { verdict: SizeVerdict; line: string } {
  const bounds = sizeBounds(icp);
  if (!bounds) {
    return {
      verdict: 'unconstrained',
      line: 'The profile sets no company size band, so size is not scored.',
    };
  }

  const band = describeBand(bounds);
  if (typeof employeeCount !== 'number' || !Number.isFinite(employeeCount)) {
    return {
      verdict: 'unknown',
      line: `Employee count unknown, band is ${band}. Size cannot be compared, so score it as neither a match nor a miss.`,
    };
  }

  const n = Math.round(employeeCount);
  const belowMin = n < bounds.min;
  const aboveMax = bounds.max !== null && n > bounds.max;

  if (!belowMin && !aboveMax) {
    return {
      verdict: 'inside',
      line: `${n} employees vs band ${band}: INSIDE the band. Full size marks. Do not describe this company as too small or too large.`,
    };
  }

  if (belowMin) {
    const near = n >= bounds.nearMin;
    return {
      verdict: near ? 'near' : 'far',
      line: near
        ? `${n} employees vs band ${band}: NEAR MISS, below the minimum of ${bounds.min} but at or above the near-miss floor of ${bounds.nearMin}. Partial size marks.`
        : `${n} employees vs band ${band}: FAR OUTSIDE, below the near-miss floor of ${bounds.nearMin}. Low size marks.`,
    };
  }

  const nearMax = bounds.nearMax as number;
  const near = n <= nearMax;
  return {
    verdict: near ? 'near' : 'far',
    line: near
      ? `${n} employees vs band ${band}: NEAR MISS, above the maximum of ${bounds.max} but at or below the near-miss ceiling of ${nearMax}. Partial size marks.`
      : `${n} employees vs band ${band}: FAR OUTSIDE, above the near-miss ceiling of ${nearMax}. Low size marks.`,
  };
}

/** "51 to 200" or "1001 and above", never a fake ceiling. */
function describeBand(bounds: SizeBounds): string {
  return bounds.max === null ? `${bounds.min} and above` : `${bounds.min} to ${bounds.max}`;
}

/**
 * The profile as prose, for the prompts. JSON.stringify of the raw row leaked
 * database shape into the context window and read as noise; this reads as the
 * brief a human would have written.
 */
export function describeIcp(icp: ActiveIcp | null | undefined): string {
  if (!icp) return 'No profile has been set for this workspace.';

  const f = icp.filters;
  const lines = [`Profile name: ${icp.name}`];

  if (f.industries?.length) lines.push(`Industries: ${f.industries.join(', ')}`);
  if (f.titles?.length) lines.push(`Role titles we sell to: ${f.titles.join(', ')}`);
  if (f.seniorities?.length) lines.push(`Seniorities: ${f.seniorities.join(', ')}`);

  // Spell the band out as numbers, with every window precomputed. A label alone
  // ("51 to 200 employees") left the boundaries to be inferred, and they were
  // inferred wrongly.
  const bounds = sizeBounds(icp);
  if (bounds) {
    lines.push(
      bounds.max === null
        ? `Company size band: ${bounds.min} employees or more. Inside the band means an employee count of at least ${bounds.min}, with no upper limit.`
        : `Company size band: ${bounds.min} to ${bounds.max} employees. Inside the band means an employee count of at least ${bounds.min} and at most ${bounds.max}, both ends included.`
    );
    lines.push(
      bounds.max === null
        ? `Size windows, already worked out: inside is ${bounds.min} and above; near miss is ${bounds.nearMin} to ${bounds.min - 1}; far outside is below ${bounds.nearMin}.`
        : `Size windows, already worked out: inside is ${bounds.min} to ${bounds.max}; near miss is ${bounds.nearMin} to ${bounds.min - 1} or ${bounds.max + 1} to ${bounds.nearMax}; far outside is below ${bounds.nearMin} or above ${bounds.nearMax}.`
    );
  }
  if (f.geos?.length) lines.push(`Geography: ${f.geos.join(', ')}`);
  if (f.exclusions?.domains?.length) {
    lines.push(`Excluded domains: ${f.exclusions.domains.join(', ')}`);
  }
  if (icp.trigger_types.length) {
    lines.push(`Buying triggers that make a lead urgent: ${icp.trigger_types.join(', ')}`);
  }
  lines.push(`What we sell them: ${icp.offer?.trim() || 'not described'}`);

  return lines.join('\n');
}
