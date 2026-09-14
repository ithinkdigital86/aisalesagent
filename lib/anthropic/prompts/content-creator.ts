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
 */
const RULE_OF_THREE =
  /[^,.!?;:]{2,40},\s+[^,.!?;:]{2,40},?\s+and\s+[^,.!?;:]{2,40}[.!?]?$/i;

const SALUTATION = /^(?:hi|hey|hello|dear)\b[^,]{0,30},\s*/i;

/** "not just faster, but cheaper" and its variants. */
const NOT_JUST_BUT = /\bnot (?:just|only)\b[^.!?]{0,80}\bbut\b/i;

const DASHES = /[\u2014\u2013]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/**
 * Every tell in a draft, or an empty array. This is what the tests assert on,
 * and it is deliberately mechanical: it catches the strings and constructions
 * the prompt bans outright, not the judgement calls beside them ("vary sentence
 * length", "do not open two consecutive emails the same way") which need the
 * rest of the sequence to assess.
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

  const notJust = NOT_JUST_BUT.exec(all);
  if (notJust) tells.push({ rule: 'no "not just X, but Y"', found: notJust[0] });

  const parts = sentences(body);
  const three = parts
    .map((part) => RULE_OF_THREE.exec(part.replace(SALUTATION, '')))
    .find((match): match is RegExpExecArray => match !== null);
  if (three) tells.push({ rule: 'no rule-of-three lists', found: three[0].trim() });

  // The one allowed question is the close, so a question anywhere before the
  // final sentence is a transition dressed up as one.
  for (const part of parts.slice(0, -1)) {
    if (part.includes('?')) {
      tells.push({ rule: 'no rhetorical questions as transitions', found: part });
      break;
    }
  }

  return tells;
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
- No sign-off pleasantries: not ${quote(BANNED_SIGN_OFFS, ' or ')}, and not any variant of them. The signature is appended separately, so the message ends on your question.`;
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
- Diagnose before you offer. Name what you think is going wrong before you mention what you do.

How you prove:
- Social proof may only come from the context you were given. If a client, a result, a number, a logo, or a mutual connection does not appear there, you do not have it and you may not use it.
- Never invent one. Not a named client, not an unnamed one, not a case study, not a statistic, not a percentage, not a shared contact, not "a firm like yours I worked with recently". A hypothetical written in the past tense is still a fabrication, and it is worse than sending nothing.
- When you do have real proof in the context, frame it as recollection rather than assertion: context, then action, then result, with the real number attached.
- When you have none, do not reach for a substitute. Write an honest hypothesis about their situation instead, and mark it as one. Say what you think is happening at their company, say what led you to think it, and invite them to correct you. A specific guess that is wrong still earns a reply. An invented credential ends the conversation the moment it is checked.

How you close:
- One question. It should be easy to answer and should lead toward a conversation, not a purchase.
- Never ask for a meeting in the first message on any channel.

Style constraints. These are what separate a message a person wrote from one a machine assembled, and a prospect who has read fifty generated emails this quarter spots the difference in the first line:
${bannedRules()}
- No exclamation marks. No "I hope this finds you well". No "just following up". No "circling back". No "synergy", "unlock", "game-changer", "revolutionise".
- No "not just X, but Y" constructions, in any wording.
- No rule-of-three lists. Two examples make a point, three make a slogan.
- No rhetorical questions used as transitions. You get one question, it goes at the end, and you want it answered literally.
- Vary sentence length on purpose. Put a short one after a long one. Even rhythm is the tell that nobody can name but everybody hears.
- Contractions are fine and preferred. Write how a person types, not how a person writes a report.
- Write at a plain reading level. Short sentences beat clever ones.
- Do not use the recipient's first name more than once.
- Never open two consecutive messages in a sequence the same way. Read what was already sent, further down, before you write the first line: if the last one opened on an observation about their hiring, this one does not, and reusing the first few words of an earlier opener is the same mistake in a thinner disguise.

Channel rules for this message:
${CHANNEL_RULES[channel] ?? CHANNEL_RULES.email}

Return only a JSON object with no prose and no markdown fences:
{"subject": string (omit for non-email), "body": string, "opening_line_rationale": string, "personalisation_anchor": string, "word_count": number}

Hard limits.

subject is checked and rejected if it breaks its limit, because the recipient reads it:
- at most ${LIMITS.subject} characters, and the channel rules above are tighter still
- omit the field entirely on any channel that has no subject line

These are metadata. Anything longer is cut off, so lead with the part that matters:
- opening_line_rationale: at most ${LIMITS.rationale} characters, one or two sentences, not an essay
- personalisation_anchor: at most ${LIMITS.anchor} characters

personalisation_anchor must be the specific verifiable fact your opening is built on, quoted or paraphrased from the context you were given and nowhere else. If nothing specific is available in the context, set it to "none" and write a message that is honest about being a cold approach: an explicit hypothesis about their situation, not faked familiarity and not borrowed proof.`;

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
