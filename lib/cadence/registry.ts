// lib/cadence/registry.ts
//
// One entry per AI employee. Adding an agent means adding a row here plus a
// prompt file. Nothing else in the runtime changes.

import { z } from 'zod';
import * as qualifier from '@/lib/anthropic/prompts/qualifier';
import * as contentCreator from '@/lib/anthropic/prompts/content-creator';
import type { AiTell } from '@/lib/anthropic/prompts/content-creator';
import * as followUp from '@/lib/anthropic/prompts/follow-up';
import * as salesManager from '@/lib/anthropic/prompts/sales-manager';
import type { AgentSlug } from './roster';

// The slug list lives in ./roster so prompt files can name the team without
// importing this module, which imports them.
export type { AgentSlug };

// The shape a reviewOutput hook reports in. It is the content creator's type
// because that is the only agent with a review today, and the runtime reads
// it from here so it never has to know which prompt file it came from.
export type { AiTell };

/** What slice of the shared brain an agent is allowed to read. */
export type ContextScope =
  | 'lead'
  | 'lead_triggers'
  | 'consent'
  | 'action_history'
  | 'sequence'
  | 'agent_memory'
  | 'pipeline_summary';

/** Which API the call goes to. Only the call itself branches on this. */
export type Provider = 'anthropic' | 'openai';

/**
 * Provider and model travel together so an agent cannot name a model its
 * provider does not serve. Adding a model means adding it here and to the rate
 * table in ./pricing, or the run logs a cost of zero.
 */
export type ModelChoice =
  | {
      provider: 'anthropic';
      /** Opus for judgement and copy, Haiku for classification and routing. */
      model: 'claude-opus-5' | 'claude-haiku-4-5-20251001';
    }
  | {
      provider: 'openai';
      /** gpt-5 for copy, gpt-5-mini where the job is closer to routing. */
      model: 'gpt-5' | 'gpt-5-mini';
    };

export type AgentDefinition = ModelChoice & {
  slug: AgentSlug;
  label: string;
  maxTokens: number;
  reads: ContextScope[];
  /** Channels this agent may produce actions on. Empty = writes no actions. */
  writesChannels: Array<'email' | 'sms' | 'voice' | 'linkedin' | 'instagram'>;
  buildPrompt: (input: unknown) => { system: string; user: string };
  outputSchema: z.ZodTypeAny;
  /**
   * Optional second parse, tried only once the corrective retry is spent. It
   * should accept the same output as outputSchema with the unusable parts
   * dropped and accounted for, so a partial answer beats no answer. Leave it
   * unset for agents whose output is worthless in part.
   */
  salvageSchema?: z.ZodTypeAny;
  /**
   * Optional quality check on an output that has already passed outputSchema.
   * It returns every rule the output breaks, empty when it is clean. The
   * runtime spends its one corrective retry on a non-empty answer, quoting the
   * rules back, and keeps the draft with the tells attached if the retry still
   * trips one. Leave it unset for agents whose output is not prose: the run
   * then logs no tell count at all, so it never reads as a clean one.
   */
  reviewOutput?: (output: unknown) => AiTell[];
};

export const AGENTS: Record<AgentSlug, AgentDefinition> = {
  qualifier: {
    slug: 'qualifier',
    label: 'Qualifier',
    // Scoring against explicit criteria is classification, not creative work.
    provider: 'anthropic',
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
    provider: 'openai',
    model: 'gpt-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: [],
    buildPrompt: contentCreator.buildPrompt,
    outputSchema: contentCreator.outputSchema,
    reviewOutput: contentCreator.reviewDraft,
  },

  follow_up: {
    slug: 'follow_up',
    label: 'Follow-up manager',
    provider: 'anthropic',
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
    provider: 'anthropic',
    model: 'claude-opus-5',
    maxTokens: 4096,
    reads: ['pipeline_summary', 'agent_memory'],
    writesChannels: [],
    buildPrompt: salesManager.buildPrompt,
    outputSchema: salesManager.outputSchema,
    // A daily review is worth showing even if one instruction was addressed to
    // an agent that does not exist.
    salvageSchema: salesManager.salvageSchema,
  },

  // Channel specialists reuse the content creator's prompt with a channel
  // constraint injected, and its review, because the style rules it checks
  // are the ones every channel is given. Split them into their own prompt
  // files once each channel's voice diverges enough to need it.
  email_specialist: {
    slug: 'email_specialist',
    label: 'Email specialist',
    provider: 'openai',
    model: 'gpt-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: ['email'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'email' }),
    outputSchema: contentCreator.outputSchema,
    reviewOutput: contentCreator.reviewDraft,
  },

  linkedin_specialist: {
    slug: 'linkedin_specialist',
    label: 'LinkedIn specialist',
    provider: 'anthropic',
    model: 'claude-opus-5',
    maxTokens: 1024,
    reads: ['lead', 'lead_triggers', 'action_history', 'agent_memory'],
    writesChannels: ['linkedin'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'linkedin' }),
    outputSchema: contentCreator.outputSchema,
    reviewOutput: contentCreator.reviewDraft,
  },

  instagram_specialist: {
    slug: 'instagram_specialist',
    label: 'Instagram specialist',
    provider: 'anthropic',
    model: 'claude-opus-5',
    maxTokens: 1024,
    reads: ['lead', 'action_history', 'agent_memory'],
    writesChannels: ['instagram'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'instagram' }),
    outputSchema: contentCreator.outputSchema,
    reviewOutput: contentCreator.reviewDraft,
  },

  voice_specialist: {
    slug: 'voice_specialist',
    label: 'Voice specialist',
    provider: 'anthropic',
    model: 'claude-opus-5',
    maxTokens: 2048,
    reads: ['lead', 'lead_triggers', 'action_history', 'consent'],
    writesChannels: ['voice'],
    buildPrompt: (i) => contentCreator.buildPrompt({ ...(i as object), channel: 'voice' }),
    outputSchema: contentCreator.outputSchema,
    reviewOutput: contentCreator.reviewDraft,
  },

  sourcing_scout: {
    slug: 'sourcing_scout',
    label: 'Sourcing scout',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2048,
    reads: ['agent_memory'],
    writesChannels: [],
    buildPrompt: qualifier.buildPrompt, // placeholder until sourcing prompt lands
    outputSchema: qualifier.outputSchema,
  },
};
