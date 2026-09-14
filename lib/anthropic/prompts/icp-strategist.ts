// lib/anthropic/prompts/icp-strategist.ts
//
// The ICP strategist reads the business profile and proposes ten customer
// profiles, each a different bet on who the business should sell to, then
// picks one and argues for it. Its output is advice: every profile it
// proposes is inserted inactive, and a human decides which, if any, the
// Qualifier scores against.
//
// The diversity requirement is enforced in the schema, not just asked for in
// the prompt. Ten variations of one segment pass every per-item check and are
// still worthless, so the array as a whole is refined: no two profiles may
// share an industry and a size band. A failure names the pair, and the
// runtime's corrective retry hands that back to the model.
//
// Relative imports, because this module is loaded straight by node --test.

import { z } from 'zod';

import { advisoryString, advisoryStringArray, essentialString } from '../schema.ts';
import {
  describeBusinessProfile,
  missingFields,
  UNVERIFIED_MARK,
  unverifiedFields,
  type BusinessProfile,
} from '../../cadence/business-profile.ts';
import { SIZE_BANDS, sizeBandValues } from '../../cadence/icp-shape.ts';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  /** Exactly this many, not "about". */
  profiles: 10,
  /** The fewest a salvaged batch is worth showing. */
  salvageMinimum: 3,
  name: 80,
  industry: 100,
  rationale: 800,
  offer: 600,
  recommendationReason: 1200,
  listItems: 8,
  listItem: 140,
} as const;

/**
 * The band, tolerant of case and spaces but strict on membership. Not
 * essentialEnum, which rewrites hyphens to underscores and would turn every
 * "51-200" into a rejection.
 */
const sizeBand = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, '') : value),
  z.enum(sizeBandValues)
);

/**
 * One proposal. Industry, size band and the rationale are essential: without
 * them the row cannot be scored against or explained to the owner. The lists
 * are advisory because a profile short one pain point is still a profile.
 */
export const profileItem = z.object({
  name: essentialString(LIMITS.name),
  industry: essentialString(LIMITS.industry),
  size_band: sizeBand,
  geography: advisoryStringArray(LIMITS.listItems, LIMITS.listItem),
  buyer_roles: advisoryStringArray(LIMITS.listItems, LIMITS.listItem),
  pain_points: advisoryStringArray(LIMITS.listItems, LIMITS.listItem),
  buying_triggers: advisoryStringArray(LIMITS.listItems, LIMITS.listItem),
  exclusions: advisoryStringArray(LIMITS.listItems, LIMITS.listItem),
  rationale: essentialString(LIMITS.rationale),
  offer: advisoryString(LIMITS.offer),
});

export type ProposedProfile = z.infer<typeof profileItem>;

/** The key two profiles must not share. Lower-cased and de-spaced so "SaaS" and "saas" collide. */
export function segmentKey(item: { industry: string; size_band: string }): string {
  return `${item.industry.trim().toLowerCase().replace(/[\s_-]+/g, ' ')}|${item.size_band}`;
}

/**
 * Pairs of profiles that are the same bet twice. Returns the offending
 * indices, 1-based to match how the prompt numbers them, so the complaint
 * the model reads is "profiles 3 and 7", not an array offset.
 */
export function duplicateSegments(
  items: Array<{ industry: string; size_band: string }>
): Array<{ first: number; second: number; key: string }> {
  const seen = new Map<string, number>();
  const duplicates: Array<{ first: number; second: number; key: string }> = [];
  items.forEach((item, index) => {
    const key = segmentKey(item);
    const earlier = seen.get(key);
    if (earlier === undefined) seen.set(key, index);
    else duplicates.push({ first: earlier + 1, second: index + 1, key });
  });
  return duplicates;
}

function distinct(items: ProposedProfile[], ctx: z.RefinementCtx) {
  for (const dup of duplicateSegments(items)) {
    ctx.addIssue({
      code: 'custom',
      message: `profiles ${dup.first} and ${dup.second} are the same segment (${dup.key.replace('|', ', ')}); make them different bets or replace one`,
    });
  }
  const names = new Set<string>();
  items.forEach((item, index) => {
    const name = item.name.trim().toLowerCase();
    if (names.has(name)) {
      ctx.addIssue({ code: 'custom', message: `profile ${index + 1} repeats the name "${item.name}"` });
    }
    names.add(name);
  });
}

/** 1-based, because that is how the prompt tells the model to count. */
const recommendedIndex = z.preprocess((value) => {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.round(parsed) : value;
}, z.number().int().min(1).max(LIMITS.profiles));

/**
 * The full answer: exactly ten distinct profiles and a pick among them. More
 * than ten is trimmed rather than rejected; fewer is a real failure, because
 * the point of the run is the spread.
 */
export const outputSchema = z
  .object({
    profiles: z.preprocess(
      (value) => (Array.isArray(value) ? value.slice(0, LIMITS.profiles) : value),
      z.array(profileItem).min(LIMITS.profiles).superRefine(distinct)
    ),
    recommended_index: recommendedIndex,
    recommendation_reason: essentialString(LIMITS.recommendationReason),
  })
  .superRefine((value, ctx) => {
    if (value.recommended_index > value.profiles.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['recommended_index'],
        message: `there is no profile ${value.recommended_index}; pick one of 1 to ${value.profiles.length}`,
      });
    }
  });

export type StrategistOutput = z.infer<typeof outputSchema>;

/**
 * Parsed only once the corrective retry is spent. Items that fail their own
 * schema are dropped, later duplicates of a segment are dropped, and the
 * recommendation is re-pointed at the profile it named if that survived, or
 * at the first one if not, with the reason prefixed so the owner can see the
 * pick was not the agent's. Fewer than three survivors is not worth showing.
 */
export const salvageSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const raw = (value as { profiles?: unknown; recommended_index?: unknown }).profiles;
    if (!Array.isArray(raw)) return value;

    const kept: ProposedProfile[] = [];
    const keptFrom: number[] = [];
    const seen = new Set<string>();
    const dropped: string[] = [];
    raw.slice(0, LIMITS.profiles).forEach((entry, index) => {
      const parsed = profileItem.safeParse(entry);
      if (!parsed.success) {
        dropped.push(`profile ${index + 1}: did not parse`);
        return;
      }
      const key = segmentKey(parsed.data);
      if (seen.has(key)) {
        dropped.push(`profile ${index + 1} (${parsed.data.name}): duplicate segment`);
        return;
      }
      seen.add(key);
      kept.push(parsed.data);
      keptFrom.push(index + 1);
    });

    const wanted = recommendedIndex.safeParse((value as { recommended_index?: unknown }).recommended_index);
    const position = wanted.success ? keptFrom.indexOf(wanted.data) : -1;
    const reason = (value as { recommendation_reason?: unknown }).recommendation_reason;
    const reasonText = typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : 'no reason given';

    return {
      ...value,
      profiles: kept,
      recommended_index: position === -1 ? 1 : position + 1,
      recommendation_reason:
        position === -1
          ? `The profile the agent recommended did not survive validation, so the first one is shown as the pick. Its original reason: ${reasonText}`
          : reasonText,
      dropped_profiles: dropped,
    };
  },
  z.object({
    profiles: z.array(profileItem).min(LIMITS.salvageMinimum),
    recommended_index: recommendedIndex,
    recommendation_reason: essentialString(LIMITS.recommendationReason),
    /** Human-readable one-liners: which proposals were lost and why. */
    dropped_profiles: advisoryStringArray(LIMITS.profiles, 200),
  })
);

export function buildPrompt(input: unknown) {
  const i = input as { businessProfile?: BusinessProfile | null };
  const profile = i.businessProfile ?? null;

  const bands = SIZE_BANDS.map((band) => `"${band.value}" (${band.label})`).join(', ');

  const system = `You are the ICP strategist on an AI sales team. You are given a description of a business, written by its owner, and you propose ten ideal customer profiles: ten different answers to "who should this company be selling to". A human reads all ten, edits the ones worth keeping and activates one. Nothing you write is acted on until they do, so your job is to give them real choices and a clear opinion, not to please them.

What a profile is. Each one names a segment of buyers: an industry, a company size band, where they are, who inside the company buys, what those buyers are struggling with that this business fixes, what event makes them ready to buy, and who within the segment to leave alone. It also carries your case for it, written against the business profile: which service, which differentiator, which stated problem makes this segment a fit. A rationale that could be pasted under a different business is not a rationale.

Ten different bets, not one bet ten ways. Every profile must differ from every other in at least two of: industry, size band, geography, buyer role, the problem it is bought to fix. No two profiles may share both an industry and a size band; if the business serves one vertical, split it by sub-segment (name the sub-segment as the industry), by size, by geography and by buyer, and say what changes about the sale in each. Spread the ten across the size bands rather than clustering. Include at least two profiles that are not the obvious answer, with the rationale saying why the obvious answer is not the only one, and at least one where the buyer is not the most senior person in the company.

Stay inside what you were given. The business profile is the only thing you know about this company. Use its services, its stated problems and its differentiators by name. Do not credit it with capabilities it did not claim. Where a field says "not stated", say in the rationale that you are assuming, and what. Respect its exclusions absolutely: a segment the owner said they will not take on is not a profile, however good it looks.

Not every field is research. A field tagged ${UNVERIFIED_MARK} was guessed by a model from the company name and domain, because the website could not be read, and the owner has accepted it without yet checking it. Treat such a field as a hypothesis, not a fact: you may build on it, but a rationale that rests on it must say so in as many words ("rests on the unverified guess that it serves logistics firms"), and a recommendation that rests on one is provisional and must say what the owner should confirm before acting on it. Never restate a guessed field as something the company does.

Then pick one. Set recommended_index to the profile you would activate first, counting from 1, and in recommendation_reason argue for it from the business profile: which stated strength it uses most directly, why its buyers are reachable, why the sale is likely to close, and what the runner-up was and why it lost. Keep it honest: if the profile you were given is thin, say the recommendation is provisional and name what the owner should fill in.

Size bands. size_band must be exactly one of: ${bands}. Nothing else is accepted.

Return only a JSON object matching this shape, with no prose before or after it and no markdown fences:
{"profiles": [{"name": string, "industry": string, "size_band": ${sizeBandValues.map((v) => `"${v}"`).join('|')}, "geography": string[], "buyer_roles": string[], "pain_points": string[], "buying_triggers": string[], "exclusions": string[], "rationale": string, "offer": string}], "recommended_index": number, "recommendation_reason": string}

Field notes:
- name: a label a salesperson would use, such as "Mid-market logistics, India, ops leads". At most ${LIMITS.name} characters.
- industry: one industry or named sub-segment per profile, at most ${LIMITS.industry} characters. Not a list.
- geography: countries or regions, plain names. Empty means anywhere.
- buyer_roles: job titles as they appear on LinkedIn, so they can be searched for.
- pain_points: what the buyer is living with, in their words, not the vendor's.
- buying_triggers: observable events, such as "hiring a second support agent" or "raised a seed round", not states of mind.
- exclusions: who within this segment to skip, in plain language.
- rationale: at most ${LIMITS.rationale} characters. Names the parts of the business profile it rests on.
- offer: what this business sells to this segment, in two or three plain sentences, as an opening line to a cold email could quote it. At most ${LIMITS.offer} characters. No adjectives the business did not use about itself.

Hard limits. Anything longer is cut off, so put the point first:
- profiles: exactly ${LIMITS.profiles} entries. Fewer is rejected and the whole answer is regenerated.
- each list field: at most ${LIMITS.listItems} items, each at most ${LIMITS.listItem} characters
- recommended_index: a whole number from 1 to ${LIMITS.profiles}
- recommendation_reason: at most ${LIMITS.recommendationReason} characters`;

  const gaps = profile ? missingFields(profile) : [];
  const unverified = profile ? unverifiedFields(profile) : [];

  const user = `Business profile, as written by the owner${unverified.length ? ', except where a field is tagged as a guess' : ''}. It outranks anything you would otherwise assume about a company like this:
${profile ? describeBusinessProfile(profile) : 'No business profile was provided.'}

${
  gaps.length
    ? `Fields the owner left blank: ${gaps.join(', ')}. Where a profile depends on one of these, say so in its rationale and state the assumption you made.`
    : 'Every field was filled in.'
}
${
  unverified.length
    ? `
Fields holding unverified guesses: ${unverified.join(', ')}. These were proposed by a model from the company name and domain, not written by the owner and not read from the website, and the owner has not confirmed them. Where a profile rests on one, its rationale must say it rests on an unverified guess, and the recommendation must say what the owner should confirm first.`
    : ''
}
Propose ten ideal customer profiles and pick one.`;

  return { system, user };
}
