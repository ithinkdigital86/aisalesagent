// lib/cadence/roster.ts
//
// The list of AI employees, split out from the registry so a prompt file can
// name the team without importing the registry that imports it back.
//
// A manager agent that does not know who works for it invents plausible
// colleagues, so every prompt that assigns work should render this roster and
// validate the slug it gets back against AGENT_SLUGS.

/** Every agent, in the order a human would read the org chart. */
export const AGENT_SLUGS = [
  'sales_manager',
  'qualifier',
  'content_creator',
  'follow_up',
  'email_specialist',
  'linkedin_specialist',
  'instagram_specialist',
  'voice_specialist',
  'sourcing_scout',
] as const;

export type AgentSlug = (typeof AGENT_SLUGS)[number];

/**
 * One line each, written for the model rather than for a developer: what the
 * agent is for, so the manager can pick a target without guessing.
 */
export const AGENT_RESPONSIBILITIES: Record<AgentSlug, string> = {
  sales_manager: 'runs the daily review and issues the instructions below; never a target',
  qualifier: 'scores a lead against the fit criteria and writes the reasoning',
  content_creator: 'writes the outreach angle and copy, channel-agnostic',
  follow_up: 'decides the next step and its timing for a lead already in a sequence',
  email_specialist: 'writes and sends email',
  linkedin_specialist: 'writes and sends LinkedIn messages',
  instagram_specialist: 'writes and sends Instagram DMs',
  voice_specialist: 'writes call scripts and places calls',
  sourcing_scout: 'finds new leads and the triggers that make them worth contacting',
};

/** The roster as prompt text: one `- slug: responsibility` line per agent. */
export function rosterForPrompt(): string {
  return AGENT_SLUGS.map((slug) => `- ${slug}: ${AGENT_RESPONSIBILITIES[slug]}`).join('\n');
}
