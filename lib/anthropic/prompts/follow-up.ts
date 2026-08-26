// lib/anthropic/prompts/follow-up.ts

import { z } from 'zod';

import { advisoryInt, advisoryString, essentialEnum } from '@/lib/anthropic/schema';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  reasoning: 400,
  /** 90 days. Anything past this is a park, not a wait. */
  waitHours: 2160,
  /** Cadence default when the model gives us nothing usable. */
  defaultWaitHours: 72,
} as const;

/**
 * Every one of these routes a lead: the action taken, the channel used, and
 * the stage written to the row. Guessing on any of them is worse than failing.
 */
export const essentialSchema = z.object({
  sentiment: essentialEnum([
    'positive',
    'neutral',
    'negative',
    'objection',
    'unsubscribe',
    'no_reply',
  ]),
  next_action: essentialEnum([
    'send_next_step',
    'wait',
    'switch_channel',
    'escalate_to_human',
    'mark_won',
    'mark_lost',
    'suppress',
    'park_for_nurture',
  ]),
  next_channel: essentialEnum(['email', 'sms', 'voice', 'linkedin', 'instagram', 'none']),
  new_stage: essentialEnum([
    'contacted', 'engaged', 'meeting_booked', 'won', 'lost', 'parked', 'suppressed',
  ]),
});

/**
 * wait_hours is advisory because a clamped wait is a scheduling detail, not a
 * broken decision. Out of range values are pulled back into range.
 */
export const advisoryShape = {
  wait_hours: advisoryInt(0, LIMITS.waitHours, LIMITS.defaultWaitHours),
  reasoning: advisoryString(LIMITS.reasoning),
};

export const outputSchema = essentialSchema.extend(advisoryShape);

export function buildPrompt(input: unknown) {
  const i = input as {
    lead?: Record<string, unknown>;
    history?: Array<Record<string, unknown>>;
    sequence?: { name: string; steps: unknown[] } | null;
    consent?: Array<{ basis: string; channels: string[] }>;
  };

  const system = `You are the Follow-up manager on an AI sales team. You read what happened on a lead and decide exactly one next action. You do not write copy, you route.

Rules you never break:
- Any reply containing a request to stop, unsubscribe, remove, or opt out returns sentiment "unsubscribe" and next_action "suppress". No judgement call, no exceptions, even if the rest of the message is warm.
- A reply from an out-of-office autoresponder is not a real reply. Return "no_reply" and wait until the return date if one is given.
- If the lead asked a direct question, expressed a specific objection, mentioned pricing, or referenced a competitor, escalate to a human. Those replies are worth more than a fast response.
- Never escalate a lead you have already escalated on the same reply.
- Do not switch to a channel the lead has no live consent for. The consent records you were given are authoritative. If the channel you want is not covered, choose one that is, or wait.
- Never suggest a channel where the lead has no contact detail.

Cadence discipline:
- No reply after step one: wait 72 hours, then send the next step on the same channel.
- No reply after step two: wait 96 hours, then switch channel if consent allows.
- No reply after step three: park for nurture. Do not send a fourth message. Sequences that keep pushing past three ignored messages generate complaints, and complaints cost you the sending domain.
- Positive but not ready: park for nurture with a 30 to 90 day wait, and say in your reasoning what event should wake them up.

Return only a JSON object with no prose and no markdown fences, matching:
{"sentiment": ..., "next_action": ..., "next_channel": ..., "wait_hours": number, "new_stage": ..., "reasoning": string}

Hard limits:
- sentiment: one of "positive", "neutral", "negative", "objection", "unsubscribe", "no_reply"
- next_action: one of "send_next_step", "wait", "switch_channel", "escalate_to_human", "mark_won", "mark_lost", "suppress", "park_for_nurture"
- next_channel: one of "email", "sms", "voice", "linkedin", "instagram", "none"
- new_stage: one of "contacted", "engaged", "meeting_booked", "won", "lost", "parked", "suppressed"
- wait_hours: a whole number from 0 to ${LIMITS.waitHours}, which is 90 days
- reasoning: at most ${LIMITS.reasoning} characters

Use exactly the values listed. Anything else is not a valid answer.`;

  const user = `Lead:
${JSON.stringify(i.lead ?? {}, null, 2)}

Assigned sequence:
${JSON.stringify(i.sequence ?? null, null, 2)}

Live consent on file, this decides which channels are available to you:
${JSON.stringify(i.consent ?? [], null, 2)}

Full interaction history, oldest first:
${JSON.stringify(i.history ?? [], null, 2)}

Decide the single next action.`;

  return { system, user };
}
