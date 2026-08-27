// lib/anthropic/prompts/content-creator.ts

import { z } from 'zod';

import { advisoryInt, advisoryString } from '@/lib/anthropic/schema';
import { describeIcp, type ActiveIcp } from '@/lib/cadence/icp';

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

Style constraints:
- No em dashes or long dashes anywhere. Use commas, colons, or separate sentences.
- No exclamation marks. No "I hope this finds you well". No "quick question". No "just following up". No "circling back". No "synergy", "leverage", "unlock", "game-changer", "revolutionise".
- Write at a plain reading level. Short sentences beat clever ones.
- Do not use the recipient's first name more than once.

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
