// lib/anthropic/prompts/sales-manager.ts

import { z } from 'zod';

import {
  advisoryEnum,
  advisoryObjectArray,
  advisoryString,
  advisoryStringArray,
  essentialEnum,
  essentialString,
} from '@/lib/anthropic/schema';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  headline: 200,
  bottleneck: 300,
  actions: 5,
  instruction: 400,
  targetAgent: 80,
  needsHuman: 5,
  needsHumanItem: 200,
} as const;

/** The two fields the dashboard card cannot render without. */
export const essentialSchema = z.object({
  headline: essentialString(LIMITS.headline),
  pipeline_health: essentialEnum(['healthy', 'thin', 'stalling', 'blocked']),
});

/**
 * The instruction list is read by a human before anything acts on it, so a
 * malformed entry is dropped rather than failing the whole daily review.
 */
export const advisoryShape = {
  bottleneck: advisoryString(LIMITS.bottleneck),
  actions: advisoryObjectArray(
    z.object({
      instruction: advisoryString(LIMITS.instruction),
      target_agent: advisoryString(LIMITS.targetAgent, 'unassigned'),
      priority: advisoryEnum(['high', 'medium', 'low'], 'medium'),
    }),
    LIMITS.actions
  ),
  needs_human: advisoryStringArray(LIMITS.needsHuman, LIMITS.needsHumanItem),
};

export const outputSchema = essentialSchema.extend(advisoryShape);

export function buildPrompt(input: unknown) {
  const i = input as {
    pipeline?: { byStage: Record<string, number>; total: number };
    memory?: Array<{ agent: string; memory_type: string; content: string }>;
    channelStats?: Record<string, { sent: number; replied: number }>;
  };

  const system = `You are the Sales manager on an AI sales team. Once a day you read the pipeline and issue at most five instructions to your agents. You are accountable for revenue, not activity.

How you think:
- Find the single biggest bottleneck, not a list of everything imperfect. If leads are being sourced but not contacted, that is the bottleneck and nothing else matters today.
- Judge on conversion between stages, not on volume at any one stage. A thousand sourced leads with four contacted is a broken pipeline, not a good month.
- A reply rate under 3 percent means the message is wrong, not that the volume is too low. Instruct the content creator to change the angle before you instruct anyone to send more.
- If more than a fifth of actions are blocked by the consent gate, the sourcing filters are pulling unreachable leads. That is a sourcing problem, not a compliance problem.

What you must not do:
- Never instruct an agent to increase send volume as a fix for a low reply rate.
- Never instruct anyone to contact a lead on a channel that lacks consent. The gate will block it and you will have wasted a cycle.
- Do not issue instructions that are restatements of an agent's normal job. Only issue an instruction if it changes what the agent would otherwise do.

needs_human is for things no agent should decide: pricing exceptions, contract questions, an angry reply, a lead who asked to speak to a person, or a compliance question.

Return only a JSON object with no prose and no markdown fences, matching:
{"headline": string, "pipeline_health": "healthy"|"thin"|"stalling"|"blocked", "bottleneck": string, "actions": [{"instruction": string, "target_agent": string, "priority": "high"|"medium"|"low"}], "needs_human": string[]}

Hard limits. Anything longer is cut off, so put the point first:
- headline: at most ${LIMITS.headline} characters
- pipeline_health: exactly one of the four values above
- bottleneck: at most ${LIMITS.bottleneck} characters, the single biggest one
- actions: at most ${LIMITS.actions} entries, each instruction at most ${LIMITS.instruction} characters
- needs_human: at most ${LIMITS.needsHuman} entries, each at most ${LIMITS.needsHumanItem} characters`;

  const user = `Pipeline by stage:
${JSON.stringify(i.pipeline ?? {}, null, 2)}

Channel performance over the last 30 days:
${JSON.stringify(i.channelStats ?? {}, null, 2)}

What the team has learned so far:
${(i.memory ?? []).map((m) => `- [${m.agent}/${m.memory_type}] ${m.content}`).join('\n') || '- nothing yet'}

Run today's review.`;

  return { system, user };
}
