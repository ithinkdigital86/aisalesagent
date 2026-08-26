// lib/cadence/registry.ts
//
// One entry per AI employee. Adding an agent means adding a row here plus a
// prompt file. Nothing else in the runtime changes.

import { z } from 'zod';
import * as qualifier from '@/lib/anthropic/prompts/qualifier';
import * as contentCreator from '@/lib/anthropic/prompts/content-creator';
import * as followUp from '@/lib/anthropic/prompts/follow-up';
import * as salesManager from '@/lib/anthropic/prompts/sales-manager';

export type AgentSlug =
  | 'sales_manager'
  | 'qualifier'
  | 'content_creator'
  | 'follow_up'
  | 'email_specialist'
  | 'linkedin_specialist'
  | 'instagram_specialist'
  | 'voice_specialist'
  | 'sourcing_scout';

/** What slice of the shared brain an agent is allowed to read. */
export type ContextScope =
  | 'lead'
  | 'lead_triggers'
  | 'consent'
  | 'action_history'
  | 'sequence'
  | 'agent_memory'
  | 'pipeline_summary';

export interface AgentDefinition {
  slug: AgentSlug;
  label: string;
  /** Opus for judgement and copy, Haiku for classification and routing. */
  model: 'claude-opus-5' | 'claude-haiku-4-5-20251001';
  maxTokens: number;
  reads: ContextScope[];
  /** Channels this agent may produce actions on. Empty = writes no actions. */
  writesChannels: Array<'email' | 'sms' | 'voice' | 'linkedin' | 'instagram'>;
  buildPrompt: (input: unknown) => { system: string; user: string };
  outputSchema: z.ZodTypeAny;
}

export const AGENTS: Record<AgentSlug, AgentDefinition> = {
  qualifier: {
    slug: 'qualifier',
    label: 'Qualifier',
    // Scoring against explicit criteria is classification, not creative work.
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    reads: ['lead', 'lead_triggers', 'agent_memory'],
    writesChannels: [],
    buildPrompt: qualifier.buildPrompt,
    outputSchema: qualifier.outputSchema,
  },

  content_creator: {
    slug: 'content_creator',
    label: 'Content creator',
    model: 'claude-opus-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: [],
    buildPrompt: contentCreator.buildPrompt,
    outputSchema: contentCreator.outputSchema,
  },

  follow_up: {
    slug: 'follow_up',
    label: 'Follow-up manager',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    reads: ['lead', 'action_history', 'sequence', 'consent'],
    writesChannels: [],
    buildPrompt: followUp.buildPrompt,
    outputSchema: followUp.outputSchema,
  },

  sales_manager: {
    slug: 'sales_manager',
    label: 'Sales manager',
    model: 'claude-opus-5',
    maxTokens: 4096,
    reads: ['pipeline_summary', 'agent_memory'],
    writesChannels: [],
    buildPrompt: salesManager.buildPrompt,
    outputSchema: salesManager.outputSchema,
  },

  // Channel specialists reuse the content creator's prompt with a channel
  // constraint injected. Split them into their own prompt files once each
  // channel's voice diverges enough to need it.
  email_specialist: {
    slug: 'email_specialist',
    label: 'Email specialist',
    model: 'claude-opus-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: ['email'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'email' }),
    outputSchema: contentCreator.outputSchema,
  },

  linkedin_specialist: {
    slug: 'linkedin_specialist',
    label: 'LinkedIn specialist',
    model: 'claude-opus-5',
    maxTokens: 1024,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: ['linkedin'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'linkedin' }),
    outputSchema: contentCreator.outputSchema,
  },

  instagram_specialist: {
    slug: 'instagram_specialist',
    label: 'Instagram specialist',
    model: 'claude-opus-5',
    maxTokens: 1024,
    reads: ['lead', 'action_history', 'agent_memory'],
    writesChannels: ['instagram'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'instagram' }),
    outputSchema: contentCreator.outputSchema,
  },

  voice_specialist: {
    slug: 'voice_specialist',
    label: 'Voice specialist',
    model: 'claude-opus-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'consent'],
    writesChannels: ['voice'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'voice' }),
    outputSchema: contentCreator.outputSchema,
  },

  sourcing_scout: {
    slug: 'sourcing_scout',
    label: 'Sourcing scout',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    reads: ['agent_memory'],
    writesChannels: [],
    buildPrompt: qualifier.buildPrompt, // placeholder until sourcing prompt lands
    outputSchema: qualifier.outputSchema,
  },
};
