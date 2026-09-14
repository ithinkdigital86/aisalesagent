// lib/cadence/business-profile.ts
//
// What the workspace's business is, in its owner's words. The ICP strategist
// reads this and nothing else when it proposes customer profiles, so the
// shape here is the whole of what the agent knows about the company. Anything
// the owner leaves blank, the agent has to work around, and describe() says so
// rather than hiding the gap.
//
// Not every field is the owner's words any more. A field can hold text
// accepted from the website reader (quote-checked against the site) or from
// the profile guesser (a model's guess from the company name and domain,
// checked against nothing). Each draftable field carries its origin so a
// profile built on guesses is never read as one built on research: the
// prompt marks those fields unverified, and so does every page that shows
// the profile.
//
// Free of Next and of any runtime Supabase import so the prompt file, and the
// tests, can load it straight under node.

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

/** Caps, stated on the form so the owner is not surprised by a rejection. */
export const BUSINESS_PROFILE_LIMITS = {
  companyName: 120,
  website: 200,
  description: 2000,
  pricingModel: 500,
  listItems: 20,
  listItem: 160,
} as const;

const list = z
  .array(z.string().trim().min(1).max(BUSINESS_PROFILE_LIMITS.listItem))
  .max(BUSINESS_PROFILE_LIMITS.listItems)
  .default([]);

// ---------------------------------------------------------------
// Field origins
// ---------------------------------------------------------------

/**
 * Where a field's text came from. Only 'inferred' is unverified: 'manual' is
 * the owner's own words and 'from_website' was checked against a quote from
 * the site before it reached the form.
 */
export const FIELD_ORIGINS = ['manual', 'from_website', 'inferred'] as const;
export type FieldOrigin = (typeof FIELD_ORIGINS)[number];

/** The fields either drafting path can propose, in form order. */
export const ORIGIN_FIELDS = [
  'description',
  'services',
  'industriesServed',
  'customerTypes',
  'problemsSolved',
  'differentiators',
  'exclusions',
] as const;
export type OriginField = (typeof ORIGIN_FIELDS)[number];

/** How the fields are named on the row, and in the prompt. */
export const ORIGIN_FIELD_COLUMNS: Record<OriginField, string> = {
  description: 'description',
  services: 'services',
  industriesServed: 'industries_served',
  customerTypes: 'customer_types',
  problemsSolved: 'problems_solved',
  differentiators: 'differentiators',
  exclusions: 'exclusions',
};

/** As the ICP page and the prompt name them. */
export const ORIGIN_FIELD_LABELS: Record<OriginField, string> = {
  description: 'description',
  services: 'services',
  industriesServed: 'industries served',
  customerTypes: 'customer types',
  problemsSolved: 'problems solved',
  differentiators: 'differentiators',
  exclusions: 'exclusions',
};

/** A field absent from the map is manual. */
export type FieldOrigins = Partial<Record<OriginField, FieldOrigin>>;

/**
 * The form's contract. Only the company name is required: an owner should be
 * able to save a half-written profile and come back to it, and the agent is
 * told which fields were left empty rather than being refused a run.
 */
export const businessProfileSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, 'Give the company a name')
    .max(BUSINESS_PROFILE_LIMITS.companyName),
  website: z.string().trim().max(BUSINESS_PROFILE_LIMITS.website).default(''),
  description: z.string().trim().max(BUSINESS_PROFILE_LIMITS.description).default(''),
  services: list,
  industriesServed: list,
  customerTypes: list,
  problemsSolved: list,
  differentiators: list,
  pricingModel: z.string().trim().max(BUSINESS_PROFILE_LIMITS.pricingModel).default(''),
  exclusions: list,
  /** Sent by the form; normalised on save so it never names an empty field. */
  fieldOrigins: z.partialRecord(z.enum(ORIGIN_FIELDS), z.enum(FIELD_ORIGINS)).default({}),
});

export type BusinessProfileInput = z.input<typeof businessProfileSchema>;

/** What a field holds, for deciding whether an origin still applies to it. */
type FieldValues = Partial<Record<OriginField, string | string[] | null | undefined>>;

function isEmpty(value: string | string[] | null | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return !value || value.trim() === '';
}

/**
 * The origins worth storing: a non-manual origin on a field that has text.
 * Manual is the default and is not written; an origin on an empty field is
 * dropped, because there is nothing for it to be the origin of, and a stale
 * "inferred" on a blank field would mark the owner's next words unverified.
 */
export function normaliseFieldOrigins(
  origins: FieldOrigins | null | undefined,
  values: FieldValues
): FieldOrigins {
  const kept: FieldOrigins = {};
  if (!origins) return kept;
  for (const field of ORIGIN_FIELDS) {
    const origin = origins[field];
    if (!origin || origin === 'manual') continue;
    if (isEmpty(values[field])) continue;
    kept[field] = origin;
  }
  return kept;
}

/** The map as stored on the row: snake_case keys, manual omitted. */
export function fieldOriginsToRow(origins: FieldOrigins): Record<string, FieldOrigin> {
  const row: Record<string, FieldOrigin> = {};
  for (const field of ORIGIN_FIELDS) {
    const origin = origins[field];
    if (origin && origin !== 'manual') row[ORIGIN_FIELD_COLUMNS[field]] = origin;
  }
  return row;
}

/** The map as read from the row. Anything unrecognised is treated as manual. */
export function fieldOriginsFromRow(raw: unknown): FieldOrigins {
  const origins: FieldOrigins = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return origins;
  const record = raw as Record<string, unknown>;
  for (const field of ORIGIN_FIELDS) {
    const value = record[ORIGIN_FIELD_COLUMNS[field]] ?? record[field];
    if (value === 'from_website' || value === 'inferred') origins[field] = value;
  }
  return origins;
}

/** The profile as the rest of the app reads it: camel-cased, nulls resolved. */
export interface BusinessProfile {
  id: string;
  companyName: string;
  website: string | null;
  description: string | null;
  services: string[];
  industriesServed: string[];
  customerTypes: string[];
  problemsSolved: string[];
  differentiators: string[];
  pricingModel: string | null;
  exclusions: string[];
  /** Where each draftable field's text came from. A field not listed is manual. */
  fieldOrigins: FieldOrigins;
  updatedAt: string;
}

/** The columns every read of the profile selects. */
export const BUSINESS_PROFILE_COLUMNS =
  'id, company_name, website, description, services, industries_served, customer_types, problems_solved, differentiators, pricing_model, exclusions, field_origins, updated_at';

/** The workspace's business profile, or null when the owner has not written one. */
export async function loadBusinessProfile(
  db: SupabaseClient<Database>,
  workspaceId: string
): Promise<BusinessProfile | null> {
  const { data } = await db
    .from('business_profiles')
    .select(BUSINESS_PROFILE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    companyName: data.company_name,
    website: data.website,
    description: data.description,
    services: data.services ?? [],
    industriesServed: data.industries_served ?? [],
    customerTypes: data.customer_types ?? [],
    problemsSolved: data.problems_solved ?? [],
    differentiators: data.differentiators ?? [],
    pricingModel: data.pricing_model,
    exclusions: data.exclusions ?? [],
    fieldOrigins: normaliseFieldOrigins(fieldOriginsFromRow(data.field_origins), {
      description: data.description,
      services: data.services,
      industriesServed: data.industries_served,
      customerTypes: data.customer_types,
      problemsSolved: data.problems_solved,
      differentiators: data.differentiators,
      exclusions: data.exclusions,
    }),
    updatedAt: data.updated_at,
  };
}

/** The origin of one field, manual unless the record says otherwise. */
export function originOf(profile: Pick<BusinessProfile, 'fieldOrigins'>, field: OriginField): FieldOrigin {
  return profile.fieldOrigins[field] ?? 'manual';
}

/**
 * The fields holding guessed text the owner has not vouched for, as labels.
 * Shown beside the missing fields on the ICP page, and named in the
 * strategist's prompt, because a profile built on guesses must not be read
 * as one built on research.
 */
export function unverifiedFields(profile: Pick<BusinessProfile, 'fieldOrigins'>): string[] {
  return ORIGIN_FIELDS.filter((field) => originOf(profile, field) === 'inferred').map(
    (field) => ORIGIN_FIELD_LABELS[field]
  );
}

/**
 * Which of the fields the agent leans on are still blank. The ICP page shows
 * these as a nudge before the owner spends a run on a thin profile, and the
 * prompt names them so the agent hedges where it is guessing.
 */
export function missingFields(profile: BusinessProfile): string[] {
  const missing: string[] = [];
  if (!profile.description?.trim()) missing.push('description');
  if (profile.services.length === 0) missing.push('services');
  if (profile.industriesServed.length === 0) missing.push('industries served');
  if (profile.customerTypes.length === 0) missing.push('customer types');
  if (profile.problemsSolved.length === 0) missing.push('problems solved');
  if (profile.differentiators.length === 0) missing.push('differentiators');
  if (!profile.pricingModel?.trim()) missing.push('pricing model');
  return missing;
}

/** The tag a guessed field carries in the prompt, so the model can tell it from research. */
export const UNVERIFIED_MARK = '[UNVERIFIED GUESS: not the owner\'s words and not from the website]';

/**
 * The profile as prose, for the prompt. Every field is rendered, filled or
 * not: an empty field written as "not stated" tells the model there is a gap
 * to reason around, where a missing line would leave it free to invent. A
 * field holding guessed text is tagged on its own line, so the model sees
 * the caveat next to the claim rather than in a footnote it may skip.
 */
export function describeBusinessProfile(profile: BusinessProfile): string {
  const mark = (field: OriginField) => (originOf(profile, field) === 'inferred' ? ` ${UNVERIFIED_MARK}` : '');
  const listLine = (label: string, field: OriginField, items: string[]) =>
    `${label}${items.length ? mark(field) : ''}: ${items.length ? items.join('; ') : 'not stated'}`;
  const textLine = (label: string, text: string | null, field?: OriginField) =>
    `${label}${field && text?.trim() ? mark(field) : ''}: ${text?.trim() || 'not stated'}`;

  return [
    `Company: ${profile.companyName}`,
    textLine('Website', profile.website),
    textLine('What the business does, in its own words', profile.description, 'description'),
    listLine('Services', 'services', profile.services),
    listLine('Industries served', 'industriesServed', profile.industriesServed),
    listLine('Kinds of customer', 'customerTypes', profile.customerTypes),
    listLine('Problems it solves', 'problemsSolved', profile.problemsSolved),
    listLine('What sets it apart', 'differentiators', profile.differentiators),
    textLine('Pricing model', profile.pricingModel),
    listLine('Who it will not take on', 'exclusions', profile.exclusions),
  ].join('\n');
}
