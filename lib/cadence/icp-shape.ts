// lib/cadence/icp-shape.ts
//
// The parts of the ICP the browser needs: the size bands the form offers and
// the shape of the filters blob. Kept free of zod and of any database import so
// the client bundle stays small; the validation and loading live in ./icp.

/**
 * Company size bands, kept as a fixed list so the form, the Apollo filters and
 * the prompt all say the same thing. `range` is the employee_range the sourcing
 * gate already understands; the open-ended top band has no upper bound worth
 * pretending to, so it uses a number that reads as "and up".
 */
export const SIZE_BANDS = [
  { value: '1-10', label: '1 to 10 employees', range: [1, 10] as [number, number], openEnded: false },
  { value: '11-50', label: '11 to 50 employees', range: [11, 50] as [number, number], openEnded: false },
  {
    value: '51-200',
    label: '51 to 200 employees',
    range: [51, 200] as [number, number],
    openEnded: false,
  },
  {
    value: '201-1000',
    label: '201 to 1,000 employees',
    range: [201, 1000] as [number, number],
    openEnded: false,
  },
  {
    value: '1001+',
    label: 'Over 1,000 employees',
    // The upper number is a stand-in for "and up": openEnded is what callers
    // read, so nothing treats 100,000 as a real ceiling.
    range: [1001, 100_000] as [number, number],
    openEnded: true,
  },
] as const;

export type SizeBand = (typeof SIZE_BANDS)[number]['value'];

export const sizeBandValues = SIZE_BANDS.map((band) => band.value) as [SizeBand, ...SizeBand[]];

export function bandFor(value: string | null | undefined) {
  return SIZE_BANDS.find((band) => band.value === value) ?? null;
}

/**
 * The filters blob stored on icp_profiles.filters. Every field is optional
 * because a profile written before this shape existed, or by the sourcing form,
 * may only carry some of it.
 */
export interface IcpFiltersShape {
  industries?: string[];
  titles?: string[];
  seniorities?: string[];
  geos?: string[];
  size_band?: SizeBand;
  employee_range?: [number, number];
  exclusions?: { domains?: string[] };
}
