// lib/anthropic/prompts/qualifier.ts

import { z } from 'zod';

export const outputSchema = z.object({
  fit_score: z.number().int().min(0).max(100),
  reasoning: z.string().max(600),
  disqualifiers: z.array(z.string()),
  recommended_channel: z.enum(['email', 'linkedin', 'voice', 'instagram', 'none']),
  urgency: z.enum(['now', 'this_month', 'nurture', 'park']),
});

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
{"fit_score": number, "reasoning": string, "disqualifiers": string[], "recommended_channel": "email"|"linkedin"|"voice"|"instagram"|"none", "urgency": "now"|"this_month"|"nurture"|"park"}`;

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
