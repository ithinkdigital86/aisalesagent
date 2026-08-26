// lib/anthropic/prompts/qualifier.ts

import { z } from 'zod';

import {
  advisoryString,
  advisoryStringArray,
  essentialEnum,
  essentialInt,
} from '@/lib/anthropic/schema';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  reasoning: 600,
  disqualifiers: 8,
  disqualifier: 120,
} as const;

/**
 * These three write straight to the lead row and decide whether we spend
 * outreach on it. A wrong score or an unknown channel is a real failure.
 */
export const essentialSchema = z.object({
  fit_score: essentialInt(0, 100),
  recommended_channel: essentialEnum(['email', 'linkedin', 'voice', 'instagram', 'none']),
  urgency: essentialEnum(['now', 'this_month', 'nurture', 'park']),
});

/** Shown to a human in the leads table. Truncation is fine, failure is not. */
export const advisoryShape = {
  reasoning: advisoryString(LIMITS.reasoning),
  disqualifiers: advisoryStringArray(LIMITS.disqualifiers, LIMITS.disqualifier),
};

export const outputSchema = essentialSchema.extend(advisoryShape);

export function buildPrompt(input: unknown) {
  const i = input as {
    lead?: Record<string, unknown>;
    triggers?: Array<{ trigger_type: string; headline: string }>;
    memory?: Array<{ memory_type: string; content: string; success_rate: number | null }>;
    icp?: Record<string, unknown>;
  };

  const system = `You are the Qualifier on an AI sales team. You score inbound and sourced leads against an ideal customer profile. You are deliberately hard to impress: most leads are mediocre, and saying so is your job.

Scoring rubric, out of 100:
- ICP fit (0-35): industry, company size, geography match against the profile
- Buying trigger (0-30): a recent event that creates urgency. No trigger caps this at 5.
- Authority (0-20): can this person sign, or at least own the budget line
- Reachability (0-15): verified contact details, and a channel we can legally use

Bands: 80+ means contact today. 60-79 means this month. 40-59 means nurture. Below 40 means park, do not spend outreach on it.

Hard disqualifiers, which force a score below 20 regardless of other factors: a competitor, an existing client, a company below the minimum size in the profile, a role with no budget influence, or a generic inbox such as info@ or contact@ as the only contact.

Be blunt in your reasoning. If the only positive is that the industry matches, say the lead is weak and explain why. Inflated scores waste real outreach budget.

Return only a JSON object matching this shape, with no prose and no markdown fences:
{"fit_score": number, "reasoning": string, "disqualifiers": string[], "recommended_channel": "email"|"linkedin"|"voice"|"instagram"|"none", "urgency": "now"|"this_month"|"nurture"|"park"}

Hard limits. Anything longer is cut off, so put the verdict first:
- fit_score: a whole number from 0 to 100
- reasoning: at most ${LIMITS.reasoning} characters
- disqualifiers: at most ${LIMITS.disqualifiers} items, each at most ${LIMITS.disqualifier} characters, empty array when there are none
- recommended_channel and urgency: exactly one of the values listed above, nothing else`;

  const user = `Ideal customer profile:
${JSON.stringify(i.icp ?? {}, null, 2)}

Lead:
${JSON.stringify(i.lead ?? {}, null, 2)}

Buying triggers detected (empty means none found):
${JSON.stringify(i.triggers ?? [], null, 2)}

What this team has learned about which leads actually convert:
${(i.memory ?? [])
  .map((m) => `- [${m.memory_type}] ${m.content} (win rate ${m.success_rate ?? 'unknown'})`)
  .join('\n') || '- nothing learned yet, use the rubric alone'}

Score this lead.`;

  return { system, user };
}
