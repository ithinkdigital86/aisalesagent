// lib/anthropic/prompts/profile-guesser.ts
//
// The second tier of the business profile autofill, for a site the reader
// could not read: a JavaScript shell with no text once the scripts are gone,
// or a host that did not answer. Where the website reader transcribes, this
// guesses. It is given the company name, the domain and whatever scraps one
// look at the homepage recovered (a title, a meta description), and it
// proposes the same fields the reader would have, from those and from what
// the name and domain suggest about the company.
//
// None of it is evidence. There is no quote to check, so the reader's
// verification does not apply, and the rules that replace it are the
// caller's: nothing from this path fills a field on its own, each guess is
// accepted one at a time, and every field that takes one is marked
// "inferred" and shown as unverified wherever the profile is read. What the
// prompt can do is make each guess honest: a short "why" the owner can
// judge, and nothing dressed up as fact.
//
// Relative imports, because this module is loaded straight by node --test.

import { z } from 'zod';

import { advisoryObjectArray, advisoryString } from '../schema.ts';
import type { SiteScraps } from '../../cadence/site-reader.ts';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  description: 1200,
  listItems: 8,
  listItem: 160,
  /** Why the guess: one clause the owner can judge, not an essay. */
  why: 200,
  notes: 500,
} as const;

/** One guessed value and the reasoning it rests on. Not evidence. */
export interface Guess {
  value: string;
  why: string;
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
export type GuessField = 'description' | ListField;

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
 * A value with its reasoning. Both advisory: an item with no value is
 * dropped by the transform rather than failing the run, and a missing "why"
 * is shown as such. There is nothing to verify a guess against, so nothing
 * here can make one fail.
 */
const guess = z.object({
  value: advisoryString(LIMITS.listItem),
  why: advisoryString(LIMITS.why),
});

const guessList = advisoryObjectArray(guess, LIMITS.listItems).transform((items) =>
  items.filter((item) => item.value !== '')
);

/** The description may be null, an object, or (from a careless model) a bare string. */
const description = z.preprocess(
  (value) => {
    if (typeof value === 'string') return { value, why: '' };
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  },
  z
    .object({
      value: advisoryString(LIMITS.description),
      why: advisoryString(LIMITS.why),
    })
    .nullable()
    .transform((item) => (item && item.value !== '' ? item : null))
);

/**
 * Nothing here is essential: a company the model knows nothing about gets
 * an answer with most fields empty, and that is the right answer. What can
 * still fail the run is the JSON itself, which the runtime retries.
 */
export const outputSchema = z.object({
  description,
  services: guessList,
  industries_served: guessList,
  customer_types: guessList,
  problems_solved: guessList,
  differentiators: guessList,
  exclusions: guessList,
  /** What the model could not guess at, for the owner. Free text, never acted on. */
  notes: advisoryString(LIMITS.notes),
});

export type GuesserOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------

/** The guesses as the form receives them, by form field name. */
export interface ProfileGuesses {
  description: Guess | null;
  services: Guess[];
  industriesServed: Guess[];
  customerTypes: Guess[];
  problemsSolved: Guess[];
  differentiators: Guess[];
  exclusions: Guess[];
}

/** Text as compared for duplicates: lower-cased, punctuation gone. */
function valueKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The model's answer by form field name, the same idea twice in one field
 * collapsed to one. There is no verification step: every guess that has a
 * value reaches the form, as a guess.
 */
export function collectGuesses(output: GuesserOutput): ProfileGuesses {
  const dedupe = (items: Guess[]): Guess[] => {
    const kept: Guess[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = valueKey(item.value);
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      kept.push(item);
    }
    return kept;
  };

  const guesses: ProfileGuesses = {
    description: output.description,
    services: [],
    industriesServed: [],
    customerTypes: [],
    problemsSolved: [],
    differentiators: [],
    exclusions: [],
  };
  for (const field of LIST_FIELDS) {
    guesses[field] = dedupe(output[MODEL_KEYS[field] as keyof GuesserOutput] as Guess[]);
  }
  return guesses;
}

/** How many guesses there are across every field. */
export function countGuesses(guesses: ProfileGuesses): number {
  return (guesses.description ? 1 : 0) + LIST_FIELDS.reduce((sum, field) => sum + guesses[field].length, 0);
}

// ---------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------

export interface GuesserInput {
  companyName: string;
  /** The site's host, minus www. Null when the owner gave no website. */
  domain: string | null;
  /** What one look at the homepage recovered, if anything. */
  scraps: SiteScraps | null;
}

/** The scraps as the model reads them, each labelled with what it is. */
export function renderScraps(scraps: SiteScraps | null): string {
  if (!scraps) return 'Nothing. The site could not be read at all.';
  const lines: string[] = [];
  if (scraps.title) lines.push(`Page title: ${scraps.title}`);
  if (scraps.description) lines.push(`Meta description: ${scraps.description}`);
  if (scraps.text.trim() !== '') lines.push(`Text on the page (little of it):\n${scraps.text.trim()}`);
  return lines.length ? lines.join('\n') : 'Nothing usable: the page came back without a title, description or text.';
}

export function buildPrompt(input: unknown): { system: string; user: string } {
  const { companyName, domain, scraps } = input as GuesserInput;

  const system = `You draft guesses for a company's business profile form when its website could not be read. You are given the company's name, its web domain, and at most a title and a one-line description recovered from the site. From those, and from what a name and domain like this usually mean, you propose entries for the same fields the owner would otherwise have filled in from the site.

What this is. Every entry you write is a guess. The owner is told so: your entries are shown as guesses, not as facts about their company, they accept each one by hand, and every field that takes one is marked unverified until they check it. So your job is not to be complete, and not to sound sure. It is to give the owner a plausible starting point they can correct quickly, and to say what each guess rests on.

Rules:
- If you know this company (a well-known name, a domain you recognise), draw on what you know, and say so in "why". If you do not, say so, and guess from the name, the domain and the recovered text only. Do not pretend a guess is knowledge.
- Prefer the recovered text over the name. A meta description that says what the company does outranks anything the name suggests.
- Be specific enough to be useful and vague enough to be honest. "Outbound email campaigns" if the description says so; "B2B lead generation" if only the name suggests it; nothing if neither does.
- Every entry carries "why": one clause, at most ${LIMITS.why} characters, saying what the guess rests on. "The meta description says it runs outbound email for founders." "Guess from the name; 'ship' and '.io' suggest developer tooling." "Common for agencies of this kind; unconfirmed." The owner reads it to decide whether to accept the guess.
- Fewer, better guesses. A field you have nothing to go on for is returned empty: null for the description, [] for a list. Empty is a correct answer.
- Never the same idea in two fields, and never the same idea twice in one.

Write each value the way the owner would type it into their own form: a plain noun phrase or a short sentence, without "they", "the company" or the company's name.

Fields:
- description: what the business probably does and for whom, in one to three sentences. Hedged where you are guessing ("appears to", "likely"). At most ${LIMITS.description} characters. Null if you have nothing to go on.
- services: what it probably sells or delivers, one per entry.
- industries_served: sectors it probably serves. Only where something points to them.
- customer_types: the kinds of organisation or buyer it probably works with, such as "founder-led agencies" or "in-house marketing teams". Kinds, not job titles.
- problems_solved: the customer's problems it probably fixes, in the customer's words.
- differentiators: usually empty. A claim about what sets a company apart cannot be guessed from its name; include one only if the recovered text states it.
- exclusions: who it probably does not work with. Usually empty.
- notes: one to three sentences for the owner on how much you had to go on and what they should check first. At most ${LIMITS.notes} characters. Always say something here.

Return only a JSON object matching this shape, with no prose before or after it and no markdown fences:
{"description": {"value": string, "why": string} | null, "services": [{"value": string, "why": string}], "industries_served": [{"value": string, "why": string}], "customer_types": [{"value": string, "why": string}], "problems_solved": [{"value": string, "why": string}], "differentiators": [{"value": string, "why": string}], "exclusions": [{"value": string, "why": string}], "notes": string}

Hard limits. Anything longer is cut off, so put the point first:
- each list: at most ${LIMITS.listItems} entries, each value at most ${LIMITS.listItem} characters
- each why: at most ${LIMITS.why} characters`;

  const user = `Company name, as the owner wrote it: "${companyName.trim()}". Do not rename it, and do not repeat the name inside the values.
Domain: ${domain ?? 'not given'}

Recovered from the homepage:
${renderScraps(scraps)}

Draft guesses for the business profile fields, with a "why" for each, and leave empty what you have nothing to go on for.`;

  return { system, user };
}
