// lib/cadence/reply.ts
//
// Parsing and first-pass classification of an inbound email reply, split out of
// app/api/webhooks/resend/route.ts. Both halves are pure string work, and one of
// them (opt-out) has a legal consequence attached, so they live here where they
// can be exercised directly — see lib/cadence/reply.test.ts — instead of only
// through a signed webhook and a service-role database client.
//
// The two are deliberately coupled in one file: sentiment is only ever meant to
// describe what the person wrote, never the message they quoted underneath it,
// and keeping the split and the classifier together is what makes that
// checkable.

export type ReplySentiment = 'positive' | 'neutral' | 'negative' | 'objection' | 'unsubscribe';

// ---------------------------------------------------------------
// Quote stripping
// ---------------------------------------------------------------

/**
 * Where a reply stops being the person's own words. Every entry anchors to the
 * start of a line, and the earliest match across all of them wins, because a
 * client can emit more than one of these (Outlook writes its rule *and* quotes
 * with ">" when the thread is long enough).
 */
const QUOTE_MARKERS: RegExp[] = [
  // Outlook Express and a few gateways.
  /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/im,

  // Outlook proper: a long rule of underscores, then a From:/Sent:/To:/Subject:
  // header block. The header line is required, because a bare run of
  // underscores is also how people draw a divider above a signature, and
  // cutting there would throw away the reply. Blank lines may sit between the
  // rule and the block.
  /^[ \t]*_{5,}[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*(?:From|Sent|To|Subject|Cc)[ \t]*:/im,

  // Gmail and Apple Mail's attribution line. A long name or address wraps it
  // onto a second line, so the span between "On" and "wrote:" is allowed to
  // cross a newline; it is lazy and bounded so it cannot run off into the body.
  /^[ \t]*On\b[\s\S]{0,300}?\bwrote:[ \t]*\r?$/im,

  // Quoted lines, for clients that quote with no attribution at all.
  /^[ \t]*>+/m,
];

export interface SplitReply {
  /** What the person actually wrote, with the quoted original removed. */
  reply: string;
  /** Everything from the first recognised quote marker on. */
  quoted: string;
}

/**
 * Cut a reply at the earliest recognised quote marker. Returning both halves,
 * rather than just the kept one, is the point: callers cannot classify the
 * quoted text by accident, because they never hold the two joined together.
 */
export function splitQuotedReply(text: string): SplitReply {
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const found = text.match(marker);
    if (found?.index !== undefined && found.index < cut) cut = found.index;
  }

  const reply = text.slice(0, cut).trim();

  // Nothing left means a marker fired on the first line — far likelier than a
  // genuinely empty reply — so keep the message whole rather than store "".
  if (!reply) return { reply: text.trim(), quoted: '' };

  return { reply, quoted: text.slice(cut).trim() };
}

// ---------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------

/**
 * Opt-out language. Deliberately narrow: this is the one classification that
 * has a legal consequence attached, so it matches only phrases that cannot be
 * read another way. A bare "stop" is not here on purpose ("stop by next week").
 */
const OPT_OUT =
  /\b(unsubscribe|opt[\s-]?out|remove me|take me off|stop (?:emailing|contacting|messaging)|(?:do not|don'?t|no longer) (?:email|contact|message)|no longer wish to (?:receive|hear))\b/i;

/**
 * How far into a reply an opt-out has to appear to be what the reply is *for*.
 * Someone asking to be removed leads with it; they do not bury it under three
 * paragraphs of other business.
 */
const OPT_OUT_WINDOW_CHARS = 400;

/**
 * The longest sentence still readable as an instruction rather than a passing
 * mention. "Please take me off your list" is an instruction; a paragraph that
 * happens to contain the word is not.
 */
const MAX_DIRECTIVE_CHARS = 120;

/**
 * Our own outbound footer (lib/cadence/adapters/email.ts appends
 * "Unsubscribe: <url>"). It is never the recipient asking for anything, so it
 * is skipped even when it reaches here — which it should not, but a footer
 * riding in on an unrecognised quote format is exactly how this went wrong in
 * production the first time.
 */
const UNSUBSCRIBE_FOOTER = /^unsubscribe\s*:?\s*<?https?:\/\/\S+>?$/i;

/**
 * The units a person writes instructions in, from the top of the reply until
 * the window runs out.
 *
 * Paragraphs are unwrapped before being cut into sentences, because a mail
 * client hard-wraps at around 76 columns and a wrapped line is not a thought —
 * take lines at face value and every long sentence looks like a short
 * instruction. The window is applied per paragraph so no sentence is ever
 * judged truncated: a paragraph counts if it *starts* inside the window.
 */
function directives(reply: string): string[] {
  const found: string[] = [];
  let consumed = 0;

  // Capturing the separator keeps the running offset exact, so "starts inside
  // the window" means the offset in the reply as written, not in a version of
  // it with the blank lines squeezed out.
  for (const [index, part] of reply.split(/(\r?\n[ \t]*(?:\r?\n)+)/).entries()) {
    if (consumed > OPT_OUT_WINDOW_CHARS) break;
    consumed += part.length;
    if (index % 2) continue; // a separator, not a paragraph

    const unwrapped = part
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !UNSUBSCRIBE_FOOTER.test(line))
      .join(' ');

    for (const sentence of unwrapped.split(/[.!?;]+\s+/)) {
      const trimmed = sentence.trim();
      if (trimmed) found.push(trimmed);
    }
  }

  return found;
}

/**
 * True only when an opt-out reads as a standalone instruction near the top of
 * the reply. Matching the phrase anywhere in the body is what let a quoted copy
 * of our own footer revoke an interested lead's consent.
 *
 * Erring narrow is safe: this is a first pass, and the Follow-up manager reads
 * the same reply with full context and its own explicit instruction to suppress
 * on any request to stop. Erring wide is not — it suppresses a live lead and
 * revokes consent on the strength of a regex.
 */
function wantsOptOut(reply: string): boolean {
  for (const directive of directives(reply)) {
    if (directive.length > MAX_DIRECTIVE_CHARS) continue;
    if (OPT_OUT.test(directive)) return true;
  }
  return false;
}

const NEGATIVE =
  /\b(not interested|no thanks?|no thank you|not a (?:good )?fit|we'?re all set|not right now|no need|pass on this|please stop)\b/i;

const OBJECTION =
  /\b(pricing|price|too expensive|cost|budget|contract|already (?:use|using|have)|competitor|we work with)\b/i;

const POSITIVE =
  /\b(interested|sounds good|happy to|let'?s (?:talk|chat|connect)|book a|schedule a|set up a call|send (?:over|me) (?:a|the)|keen|tell me more|what times?)\b/i;

/**
 * A cheap deterministic first pass, not the system's opinion of the reply.
 * The Follow-up manager re-reads the same text with full lead context and
 * produces the authoritative routing decision; this exists so the column is
 * populated the moment the reply lands, and so an opt-out suppresses without
 * waiting for the next cron tick. Order matters: "not interested" contains
 * "interested", so negative is tested before positive.
 *
 * Pass only the `reply` half of splitQuotedReply. Handing it a whole inbound
 * message classifies our own quoted copy alongside the person's answer.
 */
export function classifyReply(reply: string): ReplySentiment {
  if (wantsOptOut(reply)) return 'unsubscribe';
  if (NEGATIVE.test(reply)) return 'negative';
  if (OBJECTION.test(reply)) return 'objection';
  if (POSITIVE.test(reply)) return 'positive';
  return 'neutral';
}
