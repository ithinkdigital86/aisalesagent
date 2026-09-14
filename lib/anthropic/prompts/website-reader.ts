// lib/anthropic/prompts/website-reader.ts
//
// The website reader turns the text of a company's website into suggestions
// for the business profile form: a description and the six list fields. It
// is an autofill, not an author. Every suggestion goes to the owner as a
// suggestion, accepted field by field, and nothing it writes reaches the
// database until the owner saves the form.
//
// The rule is the content creator's: no claim the source does not support.
// Here it is enforced rather than asked for. Every value carries `evidence`,
// a verbatim quote from the page text, and verifySuggestions checks the quote
// against that text mechanically. A value whose quote is not there is
// dropped and reported, so a paraphrased quote loses the item and the owner
// is told how many were lost. A field the pages do not speak to is returned
// empty, and empty is a correct answer.
//
// Relative imports, because this module is loaded straight by node --test.

import { z } from 'zod';

import { advisoryObjectArray, advisoryString, advisoryStringArray } from '../schema.ts';
import type { ReadPage } from '../../cadence/site-reader.ts';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  description: 1200,
  listItems: 12,
  listItem: 160,
  /** A quote long enough to be a statement, short enough to be one. */
  evidence: 300,
  evidenceMin: 12,
  notes: 500,
} as const;

/** One suggested value and the quote it rests on. */
export interface Suggestion {
  value: string;
  evidence: string;
}

/** The list fields, named as the form names them. */
export const LIST_FIELDS = [
  'services',
  'industriesServed',
  'customerTypes',
  'problemsSolved',
  'differentiators',
  'exclusions',
] as const;

export type ListField = (typeof LIST_FIELDS)[number];
export type SuggestionField = 'description' | ListField;

/** The model's field names, which follow the other prompts in being snake case. */
const MODEL_KEYS: Record<ListField, string> = {
  services: 'services',
  industriesServed: 'industries_served',
  customerTypes: 'customer_types',
  problemsSolved: 'problems_solved',
  differentiators: 'differentiators',
  exclusions: 'exclusions',
};

/**
 * A value with its quote. Both advisory: an item with no value is dropped by
 * the transform below rather than failing the run, and a missing quote is
 * caught by verifySuggestions, which is the check that matters.
 */
const claim = z.object({
  value: advisoryString(LIMITS.listItem),
  evidence: advisoryString(LIMITS.evidence),
});

const claimList = advisoryObjectArray(claim, LIMITS.listItems).transform((items) =>
  items.filter((item) => item.value !== '')
);

/** The description may be null, an object, or (from a careless model) a bare string. */
const description = z.preprocess(
  (value) => {
    if (typeof value === 'string') return { value, evidence: '' };
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  },
  z
    .object({
      value: advisoryString(LIMITS.description),
      evidence: advisoryString(LIMITS.evidence),
    })
    .nullable()
    .transform((item) => (item && item.value !== '' ? item : null))
);

/**
 * Nothing here is essential in the schema's sense: an answer with every
 * field empty is the correct answer for a site that says nothing usable.
 * What can still fail the run is the JSON itself, which the runtime retries.
 */
export const outputSchema = z.object({
  description,
  services: claimList,
  industries_served: claimList,
  customer_types: claimList,
  problems_solved: claimList,
  differentiators: claimList,
  exclusions: claimList,
  /** What the pages did not say, for the owner. Free text, never acted on. */
  notes: advisoryString(LIMITS.notes),
  /** Which pages the model leaned on. Display only. */
  pages_used: advisoryStringArray(12, 300),
});

export type ReaderOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------

/**
 * Text as compared: lower-cased, accents folded, everything that is not a
 * letter or digit collapsed to one space. A quote with curly quotes, an
 * em dash or a line break where the page had a space still matches; a quote
 * with a different word does not.
 */
export function normaliseForMatch(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `quote` appears verbatim, give or take punctuation, in `text`. */
export function quoteAppears(quote: string, text: string): boolean {
  const needle = normaliseForMatch(quote);
  if (needle.length < LIMITS.evidenceMin) return false;
  return normaliseForMatch(text).includes(needle);
}

/** The suggestions as the form receives them, by form field name. */
export interface WebsiteSuggestions {
  description: Suggestion | null;
  services: Suggestion[];
  industriesServed: Suggestion[];
  customerTypes: Suggestion[];
  problemsSolved: Suggestion[];
  differentiators: Suggestion[];
  exclusions: Suggestion[];
}

/** A suggestion that was dropped because the pages did not contain its quote. */
export interface UnsupportedSuggestion {
  field: SuggestionField;
  value: string;
  evidence: string;
}

/**
 * Splits the model's answer into suggestions whose quote is in the page text
 * and suggestions whose quote is not. Only the first set reaches the form.
 * The haystack is every page joined, normalised once, so a quote that spans
 * two lines still matches.
 */
export function verifySuggestions(
  output: ReaderOutput,
  pages: ReadPage[]
): { suggestions: WebsiteSuggestions; unsupported: UnsupportedSuggestion[] } {
  const haystack = normaliseForMatch(pages.map((page) => page.text).join('\n'));
  const supported = (item: Suggestion) => {
    const needle = normaliseForMatch(item.evidence);
    return needle.length >= LIMITS.evidenceMin && haystack.includes(needle);
  };

  const unsupported: UnsupportedSuggestion[] = [];
  const keep = (field: SuggestionField, items: Suggestion[]): Suggestion[] => {
    const kept: Suggestion[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (!supported(item)) {
        unsupported.push({ field, value: item.value, evidence: item.evidence });
        continue;
      }
      // The same idea twice, differently punctuated, is one suggestion.
      const key = normaliseForMatch(item.value);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
    }
    return kept;
  };

  const suggestions: WebsiteSuggestions = {
    description: output.description ? (keep('description', [output.description])[0] ?? null) : null,
    services: [],
    industriesServed: [],
    customerTypes: [],
    problemsSolved: [],
    differentiators: [],
    exclusions: [],
  };
  for (const field of LIST_FIELDS) {
    suggestions[field] = keep(field, output[MODEL_KEYS[field] as keyof ReaderOutput] as Suggestion[]);
  }
  return { suggestions, unsupported };
}

/** How many suggestions there are across every field. */
export function countSuggestions(suggestions: WebsiteSuggestions): number {
  return (
    (suggestions.description ? 1 : 0) + LIST_FIELDS.reduce((sum, field) => sum + suggestions[field].length, 0)
  );
}

// ---------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------

export interface ReaderInput {
  pages: ReadPage[];
  /** What the owner has already called the company, if anything. */
  companyName?: string;
}

/** The pages as the model reads them, numbered so pages_used can name them. */
export function renderPages(pages: ReadPage[]): string {
  return pages
    .map((page, index) => {
      const title = page.title ? ` (${page.title})` : '';
      return `--- Page ${index + 1}: ${page.url}${title} ---\n${page.text}`;
    })
    .join('\n\n');
}

export function buildPrompt(input: unknown): { system: string; user: string } {
  const { pages, companyName } = input as ReaderInput;

  const system = `You read the text of a company's own website and draft entries for its business profile form. The owner sees every entry as a suggestion beside the field it belongs to, and accepts or ignores each one. Nothing you write is saved until they accept it, so your job is to be exact, not complete.

The rule that outranks every other: only what the pages say. You are given the text of a few pages and nothing else. A field the pages do not speak to is returned empty: null for the description, [] for a list. Empty is a correct answer. Do not infer an industry from a customer's name, a customer type from the tone of the writing, a problem from a service, or a differentiator from a slogan. Do not add adjectives the site did not use about itself. If the site is vague, your entries are vague; if the site is silent, your entries are absent.

Evidence. Every value carries "evidence": a passage copied word for word from the page text, between ${LIMITS.evidenceMin} and ${LIMITS.evidence} characters, containing the statement the value rests on. It is checked mechanically against the page text, punctuation and capitalisation aside, and a value whose quote is not found in the text is thrown away. So copy, do not paraphrase, do not stitch two sentences together, and do not quote a heading when the sentence under it is what says it. One value, one quote.

Write each value the way the owner would type it into their own form: a plain noun phrase or a short sentence, in the site's own terms, without "they", "the company" or the company's name. "Outbound email campaigns", not "They offer outbound email campaigns". Never the same idea in two fields, and never the same idea twice in one.

Fields:
- description: what the business does and for whom, in two to four sentences drawn from the pages. At most ${LIMITS.description} characters. Its evidence is the single passage the description leans on most. Null if the pages never actually say what the business does.
- services: what it sells or delivers, one per entry, named the way the site names them.
- industries_served: only industries or sectors the site says it serves. A customer's name is not an industry.
- customer_types: the kinds of organisation or buyer it says it works with, such as "founder-led agencies" or "in-house marketing teams". Kinds, not job titles.
- problems_solved: the customer's problems the site says it fixes, in the site's words, not the service that fixes them.
- differentiators: what the site claims sets it apart, stated as the claim: "every message is reviewed by a person before it is sent". Not slogans.
- exclusions: who the site says it does not work with or what it does not do. Rarely stated; usually [].
- notes: one to three sentences for the owner on what the pages did not say or said only loosely, so they know what to fill in by hand. At most ${LIMITS.notes} characters. Empty string if nothing needs saying.
- pages_used: the page numbers or URLs you drew on.

Return only a JSON object matching this shape, with no prose before or after it and no markdown fences:
{"description": {"value": string, "evidence": string} | null, "services": [{"value": string, "evidence": string}], "industries_served": [{"value": string, "evidence": string}], "customer_types": [{"value": string, "evidence": string}], "problems_solved": [{"value": string, "evidence": string}], "differentiators": [{"value": string, "evidence": string}], "exclusions": [{"value": string, "evidence": string}], "notes": string, "pages_used": string[]}

Hard limits. Anything longer is cut off, so put the point first:
- each list: at most ${LIMITS.listItems} entries, each value at most ${LIMITS.listItem} characters
- each evidence quote: at most ${LIMITS.evidence} characters`;

  const user = `${
    companyName?.trim()
      ? `The owner calls the company "${companyName.trim()}". Do not rename it, and do not repeat the name inside the values.`
      : 'The owner has not named the company yet.'
  }

Page text, ${pages.length} page${pages.length === 1 ? '' : 's'}, navigation and scripts removed:

${renderPages(pages)}

Draft the business profile entries these pages support, with a verbatim quote for each, and leave empty what they do not.`;

  return { system, user };
}
