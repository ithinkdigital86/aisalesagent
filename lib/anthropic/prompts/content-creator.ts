// lib/anthropic/prompts/content-creator.ts

import { z } from 'zod';

import { advisoryInt, advisoryString } from '../schema.ts';
import { describeIcp, type ActiveIcp } from '../../cadence/icp.ts';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  subject: 120,
  rationale: 500,
  anchor: 200,
  /** First-touch email body target, interpolated into the email channel rules. */
  emailWordsMin: 60,
  emailWordsMax: 90,
  /** Email subject line target, in words. */
  subjectWordsMin: 3,
  subjectWordsMax: 6,
  /**
   * Every message must carry at least one sentence shorter than this. Even
   * sentence length is the rhythm tell, and a hard floor is the only part of
   * "vary sentence length" that can be counted rather than judged.
   */
  shortSentenceWords: 8,
} as const;

/**
 * The copy itself. If this is wrong the run is worthless, so it stays strict.
 *
 * subject is optional because only email uses one, but when it is present it
 * is strict on length: a recipient sees it, so an overlong subject must be
 * rewritten by the corrective retry rather than silently cut off mid-word.
 * null and undefined both mean "no subject", which is how the non-email
 * channels answer.
 */
export const essentialSchema = z.object({
  body: z.string().trim().min(1),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.subject)
    .nullish()
    .transform((text) => text ?? undefined),
});

/**
 * Metadata. It is logged and displayed but never sent, so an overlong
 * rationale gets truncated rather than binning an Opus call.
 */
export const advisoryShape = {
  opening_line_rationale: advisoryString(LIMITS.rationale),
  personalisation_anchor: advisoryString(LIMITS.anchor, 'none'),
  word_count: advisoryInt(0, 10_000, 0),
};

export const outputSchema = essentialSchema.extend(advisoryShape).transform((draft) => ({
  ...draft,
  // The model miscounts often and it is only ever a display value, so a
  // missing or nonsense count is recomputed rather than rejected.
  word_count: draft.word_count > 0 ? draft.word_count : countWords(draft.body),
}));

function countWords(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// ---------------------------------------------------------------
// Anti-AI-tells
// ---------------------------------------------------------------
//
// The lists below are the single source for both halves of the rule: they are
// interpolated into the prompt text, and findAiTells checks a draft against the
// same strings. Add a banned phrase in one place and both move together, the
// way LIMITS already works for the length caps.
//
// These are tells, not taste. A prospect who has read fifty generated emails
// this quarter recognises them faster than they read the sentence, and one of
// them in the first line costs the reply regardless of how good the rest is.

/** Openers that mark a message as machine-written before the second line. */
export const BANNED_OPENERS = [
  'I hope this email finds you well',
  'I wanted to reach out',
  'I came across your',
  'quick question',
] as const;

/** Vocabulary and connective tissue that reads as generated prose. */
export const BANNED_PHRASES = [
  'delve',
  'leverage',
  'robust',
  'seamless',
  "in today's landscape",
  "it's worth noting",
  'that said',
  'furthermore',
  'moreover',
] as const;

/** Closings the appended signature already covers. */
export const BANNED_SIGN_OFFS = [
  'Looking forward to hearing from you',
  'Best regards',
] as const;

/**
 * Compound nouns and verbs coined to make an ordinary thing sound like a
 * method. Each one has appeared in a recent draft. A reader who has to
 * translate "next best touch" into "the next email" has stopped reading the
 * email, and a phrase that would need explaining to the recipient's colleague
 * is a coinage whether or not it is on this list.
 */
export const JARGON_COINAGES = [
  'next best touch',
  'systemizing',
  'systemising',
  'capture and approvals',
] as const;

/**
 * Written-out forms and the contraction each one should have been. A model
 * told that contractions are "fine and preferred" still writes "I am" and
 * "does not", because that is what careful prose looks like, and the
 * carefulness is the tell. Both halves of each pair reach the prompt; the left
 * half is what findAiTells looks for.
 */
export const EXPANDED_FORMS = [
  ['I am', "I'm"],
  ['you are', "you're"],
  ['it is', "it's"],
  ['that is', "that's"],
  ['there is', "there's"],
  ['we are', "we're"],
  ['they are', "they're"],
  ['I will', "I'll"],
  ['you will', "you'll"],
  ['do not', "don't"],
  ['does not', "doesn't"],
  ['did not', "didn't"],
  ['is not', "isn't"],
  ['are not', "aren't"],
  ['was not', "wasn't"],
  ['were not', "weren't"],
  ['has not', "hasn't"],
  ['have not', "haven't"],
  ['will not', "won't"],
  ['would not', "wouldn't"],
  ['could not', "couldn't"],
  ['should not', "shouldn't"],
  ['cannot', "can't"],
  ['can not', "can't"],
] as const;

/** One thing found in a draft that should not be there. */
export interface AiTell {
  /** Which rule was broken, phrased the way the prompt phrases it. */
  rule: string;
  /** The offending text, quoted back so a human can see it. */
  found: string;
}

/**
 * "A, B, and C" and "A, B and C" closing a sentence. Two items and a
 * conjunction is a sentence; three is a pattern. It is anchored to the end of
 * the sentence, and a salutation is taken off first, so an ordinary clause that
 * happens to hold a comma and an "and" is not read as an enumeration.
 *
 * This catches only the form where a conjunction does the joining at the close.
 * The comma run below catches the rest, including the same list buried
 * mid-sentence where this anchor cannot see it.
 */
const RULE_OF_THREE =
  /[^,.!?;:]{2,40},\s+[^,.!?;:]{2,40},?\s+and\s+[^,.!?;:]{2,40}[.!?]?$/i;

/**
 * The comma form of the same tell: three or more short comma-separated pieces
 * inside one sentence, anywhere in it, with or without a conjunction on the
 * last. "buried in form text, email replies, and partner notes" is the
 * pattern, and so is "reps lose context, warm interest cools, deals stall".
 *
 * A piece longer than this is a clause doing real work rather than a list item,
 * so it breaks the run. The cost of reading it that way is the occasional
 * sentence with two short leading adverbials getting flagged, which inside a
 * sixty-word cold email is a sentence worth rewriting anyway.
 */
const TRIAD_ITEMS = 3;
const TRIAD_ITEM_MAX_CHARS = 48;

const SALUTATION = /^(?:hi|hey|hello|dear)\b[^,]{0,30},\s*/i;

/** "not just faster, but cheaper" and its variants. */
const NOT_JUST_BUT = /\bnot (?:just|only)\b[^.!?]{0,80}\bbut\b/i;

/**
 * "If I'm off, tell me. If I'm close, is it X?" Offering the reader two
 * readings of your own guess is a menu, not a hypothesis. One of these is an
 * honest admission and stays legal; the pair is the tell.
 */
const HEDGE =
  /\bif\s+(?:i'?m|i am|that'?s|this is|it'?s|you'?re)\b[^.!?]{0,40}?\b(?:off|wrong|close|right|mistaken|on the money)\b/gi;

const DASHES = /[—–]/;

/** Rule names built from a limit, kept beside the limit they quote. */
const ONE_QUESTION = 'exactly one question, at the end, nothing after it';
const SHORT_SENTENCE = `at least one sentence under ${LIMITS.shortSentenceWords} words`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One alternation over every written-out form, longest first, so that "that is
 * not" is reported as a single offence rather than as "that is" and "is not".
 */
const EXPANDED_FORM_PATTERN = new RegExp(
  `\\b(?:${EXPANDED_FORMS.map(([written]) => written)
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')})\\b`,
  'gi'
);

/**
 * A phrase is present if it appears as written. Single words are matched on
 * word boundaries so "leverage" is caught but "leveraged" in a quoted trigger
 * headline is not a separate offence, and multi-word phrases are matched as
 * substrings because that is how they are written.
 */
function contains(haystack: string, phrase: string): boolean {
  const pattern = /\s/.test(phrase)
    ? new RegExp(escapeRegExp(phrase), 'i')
    : new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
  return pattern.test(haystack);
}

/** Sentences, near enough for counting and for finding the last one. */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Words in one sentence, ignoring stray punctuation tokens like a lone dash. */
function wordsIn(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => /[a-z0-9]/i.test(token)).length;
}

/** The first run of three or more list-shaped pieces in a sentence, if any. */
function commaRun(sentence: string): string | null {
  let run: string[] = [];
  for (const piece of sentence.split(',').map((part) => part.trim())) {
    const listItem =
      piece.length >= 2 && piece.length <= TRIAD_ITEM_MAX_CHARS && /[a-z]/i.test(piece);
    if (!listItem) {
      run = [];
      continue;
    }
    run.push(piece);
    if (run.length >= TRIAD_ITEMS) return run.join(', ');
  }
  return null;
}

/**
 * Every tell in a draft, or an empty array. This is what the tests assert on,
 * and it is deliberately mechanical: it catches the strings and constructions
 * the prompt bans outright, not the judgement calls beside them ("do not open
 * two consecutive emails the same way", "build the observation on this lead's
 * own data") which need the rest of the sequence, or the lead record, to
 * assess.
 */
export function findAiTells(draft: { subject?: string; body: string }): AiTell[] {
  const tells: AiTell[] = [];
  const body = draft.body ?? '';
  const all = [draft.subject ?? '', body].filter(Boolean).join('\n');

  const dash = DASHES.exec(all);
  if (dash) tells.push({ rule: 'no em dashes or en dashes', found: dash[0] });

  for (const opener of BANNED_OPENERS) {
    if (contains(all, opener)) tells.push({ rule: 'banned opener', found: opener });
  }
  for (const phrase of BANNED_PHRASES) {
    if (contains(all, phrase)) tells.push({ rule: 'banned phrasing', found: phrase });
  }
  for (const signOff of BANNED_SIGN_OFFS) {
    if (contains(all, signOff)) tells.push({ rule: 'no sign-off pleasantries', found: signOff });
  }
  for (const coinage of JARGON_COINAGES) {
    if (contains(all, coinage)) tells.push({ rule: 'no jargon coinages', found: coinage });
  }

  const notJust = NOT_JUST_BUT.exec(all);
  if (notJust) tells.push({ rule: 'no "not just X, but Y"', found: notJust[0] });

  const parts = sentences(body);
  const clauses = parts.map((part) => part.replace(SALUTATION, ''));

  // Both shapes of the one tell, reported once: the conjunction form the
  // anchored regex sees, and the comma run that can sit anywhere in a sentence.
  const three =
    clauses.map((clause) => RULE_OF_THREE.exec(clause)?.[0]).find(Boolean) ??
    clauses.map((clause) => commaRun(clause)).find(Boolean);
  if (three) tells.push({ rule: 'no rule-of-three lists', found: three.trim() });

  // The one allowed question is the close, so a question anywhere before the
  // final sentence is a transition dressed up as one.
  for (const part of parts.slice(0, -1)) {
    if (part.includes('?')) {
      tells.push({ rule: 'no rhetorical questions as transitions', found: part });
      break;
    }
  }

  // And there is exactly one of them, with nothing behind it. A second ask,
  // even a polite "let me know", splits the reply the message is asking for.
  const trimmed = body.trim();
  const asked = (trimmed.match(/\?/g) ?? []).length;
  if (asked === 0) {
    tells.push({ rule: ONE_QUESTION, found: parts[parts.length - 1] ?? trimmed });
  } else if (asked > 1) {
    tells.push({ rule: ONE_QUESTION, found: parts.find((part) => part.includes('?')) ?? trimmed });
  } else if (!trimmed.endsWith('?')) {
    tells.push({ rule: ONE_QUESTION, found: trimmed.slice(trimmed.lastIndexOf('?') + 1).trim() });
  }

  const hedges = trimmed.match(HEDGE) ?? [];
  if (hedges.length > 1) {
    tells.push({ rule: 'no hedging pairs, one hypothesis', found: hedges.join(' / ') });
  }

  const seen = new Set<string>();
  for (const match of all.match(EXPANDED_FORM_PATTERN) ?? []) {
    const key = match.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tells.push({ rule: 'contractions, not written-out forms', found: match });
  }

  // Absence, not presence: nothing short anywhere means every sentence is the
  // same length, which is the rhythm tell. The nearest miss is quoted back.
  if (parts.length > 0 && !parts.some((part) => wordsIn(part) < LIMITS.shortSentenceWords)) {
    const shortest = parts.reduce((a, b) => (wordsIn(b) < wordsIn(a) ? b : a));
    tells.push({ rule: SHORT_SENTENCE, found: shortest });
  }

  return tells;
}

/**
 * findAiTells against an output that has already been through outputSchema,
 * in the shape the registry's reviewOutput hook is called with. The runtime
 * does not know what an agent produces, so the narrowing happens here: an
 * output with no usable body is not a clean draft, it is nothing to review,
 * and the schema has already rejected that case before this runs.
 */
export function reviewDraft(output: unknown): AiTell[] {
  if (typeof output !== 'object' || output === null) return [];
  const draft = output as { subject?: unknown; body?: unknown };
  if (typeof draft.body !== 'string') return [];
  return findAiTells({
    subject: typeof draft.subject === 'string' ? draft.subject : undefined,
    body: draft.body,
  });
}

/** The banned lists as the prompt states them, one rule per line. */
function bannedRules(): string {
  const quote = (items: readonly string[], last = ', ') => {
    const quoted = items.map((item) => `"${item}"`);
    return quoted.length < 2
      ? quoted.join('')
      : `${quoted.slice(0, -1).join(', ')}${last}${quoted[quoted.length - 1]}`;
  };
  return `- No em dashes or en dashes anywhere. Use commas, full stops, or separate sentences.
- Never open with any of these: ${quote(BANNED_OPENERS)}.
- Never use any of these: ${quote(BANNED_PHRASES)}.
- No sign-off pleasantries: not ${quote(BANNED_SIGN_OFFS, ' or ')}, and not any variant of them. The signature is appended separately, so the message ends on your question.
- No jargon coinages: not ${quote(JARGON_COINAGES)}, and nothing else in that register. If the phrase would need explaining to the person's colleague, it is a coinage. Say the plain thing it stands for.`;
}

/** The contraction rule, with the swaps spelled out rather than implied. */
function contractionRule(): string {
  const swaps = EXPANDED_FORMS.slice(0, 4)
    .map(([written, short]) => `"${written}" is "${short}"`)
    .join(', ');
  return `- Contractions are expected, not merely allowed: ${swaps}, "does not" is "doesn't", and the same for every other pair. Writing one out in full is the tell. "I am", "you are", "it is" and "does not" read as a machine being careful rather than a person typing, and they are checked.`;
}

const CHANNEL_RULES: Record<string, string> = {
  email: `Subject line: ${LIMITS.subjectWordsMin} to ${LIMITS.subjectWordsMax} words, lowercase, no colons, no title case, reads like a note from a colleague rather than a campaign.
It must be specific to this company, this person's role, or the trigger you are writing about, specific enough that it could not be pasted onto any other prospect. Name the thing. A subject naming their new office, their hiring push, or the job they actually do beats one naming a category.
Write it to be opened, not to summarise the email. It is a reason to look, not an abstract of what is inside, and it must not simply restate your first line.
No generic openers: not "quick question", not "idea for you", not "following up", not your company name paired with a benefit claim.
Body: ${LIMITS.emailWordsMin} to ${LIMITS.emailWordsMax} words. This is a ceiling, not a target to fill, and it is counted.
One idea and one question. Nothing else. No second paragraph of setup, no scene-setting preamble, no restating the offer, no bullet lists, no signature block, that gets appended later.
Cut every sentence that is not the observation, the idea, or the question.
That range is for a first touch. On any later step in the sequence go shorter still, under ${LIMITS.emailWordsMin} words, and refer back to the previous message in a clause rather than recapping it.
An unsubscribe line is appended automatically, so do not write one.`,

  linkedin: `Under 300 characters, because the connection-request note is capped and long DMs go unread.
No links, they suppress reach and read as spam.
This will be sent by a human from their own account, so write it in first person as that person.`,

  instagram: `Under 400 characters, conversational, lowercase-leaning.
This is a reply inside an existing conversation, never a cold approach, so reference what they said.
No pitch in the first message. Ask one question.`,

  voice: `Write a call opening of 25 to 40 words, to be spoken.
The first sentence must disclose that this is an AI assistant and name the calling company. This is a legal requirement, not a stylistic choice.
The second sentence states why you are calling, referencing their enquiry.
End with a yes or no question that is easy to answer.
Short words. No subordinate clauses. It has to survive being heard once.`,
};

/**
 * Finished messages the prompt shows as the target. The first is the best
 * draft this system has produced. The other two are written to the same
 * standard, one anchored on a trigger and one a later step in a sequence, so
 * the model sees each branch of the rules landed rather than described.
 *
 * Every example has to clear findAiTells and the email length rule, and the
 * tests hold them to that. A target that breaks a counted rule teaches the
 * model to break it, and the corrective retry then bounces the imitation.
 */
export const WORKED_EXAMPLES = [
  {
    step: 1,
    note: 'First touch with nothing specific to anchor on, so personalisation_anchor is "none". It names the guess as a guess once, then describes their week as if it could see it, and never says what the guess rests on.',
    body:
      "This is a cold email, so I'll be direct about the guess I'm making. At a 120 person software company, the marketing team is usually spread across brand and content, and outbound ends up as someone's third priority. Someone books a call and it lands in the CRM with no context. Sales quietly stops trusting marketing's leads. Who owns outbound end to end on your side?",
  },
  {
    step: 1,
    note: 'First touch built on a trigger, four support agent roles opened in June. The trigger is the first line, the rest is what it implies, and it stops once the question is asked.',
    body:
      "You've had four support agent roles open since June. Hiring in a block like that usually means the queue got away from the team a couple of months earlier and headcount was the only lever within reach. New agents take a quarter to get fast. The queue doesn't wait. My guess is most of the backlog is the same eight questions asked in slightly different words. Is that what it looks like from where you sit?",
  },
  {
    step: 2,
    note: 'Step 2 to the same person, no reply to the first. It opens on a different observation, refers back to the first message in a clause rather than recapping it, and stays well under the first-touch length.',
    body:
      "Your help centre hasn't changed since March, which I noticed after writing to you about the support roles. That's the part that worries me more than the hiring. Every new agent is being trained to answer questions a page could have. Which of those questions comes up most?",
  },
] as const;

/** The examples as the prompt presents them: the target, not a template. */
function workedExamples(): string {
  const shown = WORKED_EXAMPLES.map(
    (example, n) => `Example ${n + 1}. ${example.note}\n"${example.body}"`
  ).join('\n\n');
  return `What the target reads like. The finished emails below are each clean on every rule above. Read them for the voice: one person saying what they think is going on at another person's company, in plain words, with nothing for sale. Then put them down. They are examples, not templates. Do not reuse their openings, their sentence shapes or their phrasing, and do not write "This is a cold email" because the first one does. What your message says comes from the lead in front of you and nowhere else; these only show what a finished one sounds like. On a channel other than email, keep the voice and follow that channel's length.

${shown}`;
}

export function buildPrompt(input: unknown) {
  const i = input as {
    lead?: Record<string, unknown>;
    triggers?: Array<{ trigger_type: string; headline: string }>;
    history?: Array<{ channel: string; body: string; reply_body: string | null }>;
    memory?: Array<{ memory_type: string; content: string; success_rate: number | null }>;
    channel?: string;
    offer?: string;
    sender?: string;
    step_number?: number;
    icp?: ActiveIcp | null;
  };

  // A per-request offer wins, because a one-off campaign is allowed to pitch
  // something other than the standing offer. Otherwise the active profile's
  // offer description is what we sell.
  const offer = i.offer?.trim() || i.icp?.offer?.trim() || 'not specified';

  const channel = i.channel ?? 'email';

  const system = `You write outbound sales copy for an AI sales team. Your copy gets replies because it sounds like one competent person noticing something specific about another person's business, not like marketing.

How you open:
- Lead with the problem you believe they have, inferred from something real and verifiable about them. Never open with a greeting plus your credentials.
- Mirror their situation in the first line so they recognise themselves in it.
- Diagnose, do not offer. Never describe what you do or how you help, in any wording: no "I help teams", no "we work with", no "what we do is", no sentence about your product or your service. The diagnosis is the message. The offer comes later in the conversation, after they have replied, and the description of what we sell further down is there so you know which problem to look for, not so you can name it.
- The specific detail your observation is built on must come from this lead's own data: a field on the record below, one of their triggers, or something they said in a prior reply. Not their industry, not their job title in general, not what is usually true of companies their size. If the message could be sent unchanged to any other company in the same sector, it is not personalised, and the fix is to go and find the detail, not to write the generic line more elegantly.

How you prove:
- Social proof may only come from the context you were given. If a client, a result, a number, a logo, or a mutual connection does not appear there, you do not have it and you may not use it.
- Never invent one. Not a named client, not an unnamed one, not a case study, not a statistic, not a percentage, not a shared contact, not "a firm like yours I worked with recently". A hypothetical written in the past tense is still a fabrication, and it is worse than sending nothing.
- When you do have real proof in the context, frame it as recollection rather than assertion: context, then action, then result, with the real number attached.
- When you have none, do not reach for a substitute. Write an honest hypothesis about their situation instead, and mark it as one, once. Then describe what you think is happening at their company as if you were looking at it, in concrete terms, and let the closing question do the correcting. A specific guess that is wrong still earns a reply. An invented credential ends the conversation the moment it is checked.
- Never state that the observation is based on their size, their role or their industry. Not "given your headcount", not "as a Head of Marketing you probably", not "firms in logistics tend to", not any wording that tells them the guess rests on a field in a database. If that is all you have, make the guess and own it as a guess. Do not disclose how thin the evidence under it is. A reader who is told the guess comes from their job title stops reading; one who is shown a specific picture of their own week keeps going.
- One hypothesis, never a menu. No hedging pairs: not "if I'm off ... if I'm close", not "either X or Y is happening", not two readings of your own guess offered side by side. Commit to the one you believe, say what it is built on, and let the closing question do the correcting.

How you close:
- One question. It should be easy to answer and should lead toward a conversation, not a purchase.
- Exactly one question mark in the whole message, and it is the last character of it. Nothing comes after the question: no "let me know", no "tell me if I'm wrong", no second ask in any form.
- Never ask for a meeting in the first message on any channel.

Style constraints. These are what separate a message a person wrote from one a machine assembled, and a prospect who has read fifty generated emails this quarter spots the difference in the first line:
${bannedRules()}
- No exclamation marks. No "I hope this finds you well". No "just following up". No "circling back". No "synergy", "unlock", "game-changer", "revolutionise".
- No "not just X, but Y" constructions, in any wording.
- No rule-of-three lists, in any punctuation. "X, Y, and Z", "X, Y and Z" and the bare comma form "X, Y, Z" are one tell, and it counts wherever it sits: three or more comma-separated pieces inside a single sentence is a slogan even when the sentence carries on afterwards. Two examples make a point, three make a slogan.
- No rhetorical questions used as transitions. You get one question, it goes at the end, and you want it answered literally.
- Vary sentence length on purpose. Put a short one after a long one. At least one sentence must be under ${LIMITS.shortSentenceWords} words, and that is counted rather than judged. Even rhythm is the tell that nobody can name but everybody hears. A short sentence is still a sentence: it has a subject and a verb and it carries part of the argument. A fragment dropped in to clear the count, "Every time." or "Not ideal.", is a different tell and a worse one.
${contractionRule()}
- Write at a plain reading level. Short sentences beat clever ones.
- Do not use the recipient's first name more than once.
- Never open two consecutive messages in a sequence the same way. Read what was already sent, further down, before you write the first line: if the last one opened on an observation about their hiring, this one does not, and reusing the first few words of an earlier opener is the same mistake in a thinner disguise.

Channel rules for this message:
${CHANNEL_RULES[channel] ?? CHANNEL_RULES.email}

${workedExamples()}

Return only a JSON object with no prose and no markdown fences:
{"subject": string (omit for non-email), "body": string, "opening_line_rationale": string, "personalisation_anchor": string, "word_count": number}

Hard limits.

subject is checked and rejected if it breaks its limit, because the recipient reads it:
- at most ${LIMITS.subject} characters, and the channel rules above are tighter still
- omit the field entirely on any channel that has no subject line

These are metadata. Anything longer is cut off, so lead with the part that matters:
- opening_line_rationale: at most ${LIMITS.rationale} characters, one or two sentences, not an essay
- personalisation_anchor: at most ${LIMITS.anchor} characters

personalisation_anchor must be the specific verifiable fact your opening is built on, quoted or paraphrased from this lead's own record, triggers or replies below and nowhere else. A fact about their industry or their job title in general is not one. If nothing specific is available in the context, set it to "none" and write a message that is honest about being a cold approach: an explicit hypothesis about their situation, not faked familiarity and not borrowed proof. Being honest about the cold approach means owning the guess, not citing their headcount, title or sector as the reason for it.`;

  const priorMessages = (i.history ?? [])
    .map(
      (h, n) =>
        `Message ${n + 1} (${h.channel}): ${h.body.slice(0, 300)}\nTheir reply: ${
          h.reply_body ?? 'no reply'
        }`
    )
    .join('\n\n');

  const user = `Who we are and what we offer:
${offer}

Who we sell to. The recipient below was scored against this profile, so write as though it is who you expect them to be, and do not pitch outside it:
${describeIcp(i.icp)}

Sending as: ${i.sender ?? 'not specified'}

The person:
${JSON.stringify(i.lead ?? {}, null, 2)}

Recent events at their company, your best personalisation material:
${JSON.stringify(i.triggers ?? [], null, 2)}

What we have already sent them, do not repeat any of it:
${priorMessages || 'nothing yet, this is the first contact'}

Openers and angles that have worked for this team:
${(i.memory ?? [])
  .filter((m) => m.memory_type === 'winning_opener' || m.memory_type === 'objection_response')
  .map((m) => `- ${m.content} (reply rate ${m.success_rate ?? 'unknown'})`)
  .join('\n') || '- nothing learned yet'}

This is step ${i.step_number ?? 1} of the sequence. Write the ${channel} message.`;

  return { system, user };
}
