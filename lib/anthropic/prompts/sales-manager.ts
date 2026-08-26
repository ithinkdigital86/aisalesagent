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
import { AGENT_SLUGS, rosterForPrompt } from '@/lib/cadence/roster';

/** Hard limits, stated in the prompt below so the model knows them. */
export const LIMITS = {
  headline: 200,
  bottleneck: 300,
  actions: 5,
  instruction: 400,
  needsHuman: 5,
  needsHumanItem: 200,
} as const;

/** The two fields the dashboard card cannot render without. */
export const essentialSchema = z.object({
  headline: essentialString(LIMITS.headline),
  pipeline_health: essentialEnum(['healthy', 'thin', 'stalling', 'blocked']),
});

/**
 * One instruction. Everything here is advisory except target_agent: an
 * instruction addressed to an agent that does not exist cannot be routed, and
 * coercing it to a fallback would hide the fact that the model is inventing
 * colleagues. It stays strict so the runtime spends its one corrective retry
 * naming the real roster back to the model.
 */
const actionItem = z.object({
  instruction: advisoryString(LIMITS.instruction),
  target_agent: essentialEnum(AGENT_SLUGS),
  priority: advisoryEnum(['high', 'medium', 'low'], 'medium'),
});

/**
 * The instruction list is read by a human before anything acts on it, so a
 * malformed entry is dropped rather than failing the whole daily review.
 */
export const advisoryShape = {
  bottleneck: advisoryString(LIMITS.bottleneck),
  actions: advisoryObjectArray(actionItem, LIMITS.actions),
  needs_human: advisoryStringArray(LIMITS.needsHuman, LIMITS.needsHumanItem),
};

export const outputSchema = essentialSchema.extend(advisoryShape);

/**
 * Parsed only once the corrective retry is spent, so a review whose only fault
 * is one unroutable instruction still reaches the dashboard. The instructions
 * that survive are exactly as strict as above; the ones that do not are moved
 * to dropped_actions rather than deleted, because a list that quietly shrinks
 * from five entries to four reads as the manager having had less to say.
 */
export const salvageSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const raw = (value as { actions?: unknown }).actions;
    if (!Array.isArray(raw)) return value;

    const kept: unknown[] = [];
    const dropped: string[] = [];
    for (const entry of raw.slice(0, LIMITS.actions)) {
      if (actionItem.safeParse(entry).success) kept.push(entry);
      else dropped.push(describeDropped(entry));
    }
    return { ...value, actions: kept, dropped_actions: dropped };
  },
  outputSchema.extend({
    /** Human-readable one-liners: who it was addressed to, and what it said. */
    dropped_actions: advisoryStringArray(LIMITS.actions, LIMITS.instruction),
  })
);

/** What a human needs to re-route the instruction by hand: target and text. */
function describeDropped(entry: unknown): string {
  const item = (typeof entry === 'object' && entry !== null ? entry : {}) as {
    target_agent?: unknown;
    instruction?: unknown;
  };
  const target =
    typeof item.target_agent === 'string' && item.target_agent.trim() !== ''
      ? item.target_agent.trim()
      : 'no agent named';
  const instruction =
    typeof item.instruction === 'string' && item.instruction.trim() !== ''
      ? item.instruction.trim()
      : 'no instruction text';
  return `${target}: ${instruction}`;
}

export function buildPrompt(input: unknown) {
  const i = input as {
    pipeline?: { byStage: Record<string, number>; total: number };
    memory?: Array<{ agent: string; memory_type: string; content: string }>;
    channelStats?: Record<string, { sent: number; replied: number }>;
  };

  const system = `You are the Sales manager on an AI sales team. Once a day you read the pipeline and issue at most five instructions to your agents. You are accountable for revenue, not activity.

Your team, in full. These are the only agents that exist:
${rosterForPrompt()}

Every action you issue must name one of those slugs, spelled exactly as written above, in target_agent. There is no one else to delegate to: if the work you have in mind belongs to no agent on this list, it is not an action, it is a needs_human item.

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
{"headline": string, "pipeline_health": "healthy"|"thin"|"stalling"|"blocked", "bottleneck": string, "actions": [{"instruction": string, "target_agent": ${AGENT_SLUGS.map((s) => `"${s}"`).join('|')}, "priority": "high"|"medium"|"low"}], "needs_human": string[]}

Hard limits. Anything longer is cut off, so put the point first:
- headline: at most ${LIMITS.headline} characters
- pipeline_health: exactly one of the four values above
- bottleneck: at most ${LIMITS.bottleneck} characters, the single biggest one
- actions: at most ${LIMITS.actions} entries, each instruction at most ${LIMITS.instruction} characters
- target_agent: exactly one slug from the roster above. An unknown slug is rejected and the whole review is regenerated.
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
