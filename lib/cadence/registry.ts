// lib/cadence/registry.ts
//
// One entry per AI employee. Adding an agent means adding a row here plus a
// prompt file. Nothing else in the runtime changes.

import { z } from 'zod';
import * as qualifier from '@/lib/anthropic/prompts/qualifier';
import * as contentCreator from '@/lib/anthropic/prompts/content-creator';
import type { AiTell } from '@/lib/anthropic/prompts/content-creator';
import * as followUp from '@/lib/anthropic/prompts/follow-up';
import * as icpStrategist from '@/lib/anthropic/prompts/icp-strategist';
import * as profileGuesser from '@/lib/anthropic/prompts/profile-guesser';
import * as salesManager from '@/lib/anthropic/prompts/sales-manager';
import * as websiteReader from '@/lib/anthropic/prompts/website-reader';
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
  | 'pipeline_summary'
  | 'business_profile';

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
      /**
       * How hard Opus thinks before it answers. Opus 5 reasons by default and
       * the reasoning is billed against maxTokens, so an agent whose answer
       * is a long transcription rather than a judgement should run at low:
       * left at the default it can spend the whole budget thinking and
       * return nothing. Unset means the API default (high).
       */
      effort?: 'low' | 'medium' | 'high';
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
   *
   * `input` is what buildPrompt was called with, for the rules that need the
   * lead record as well as the draft.
   */
  reviewOutput?: (output: unknown, input: unknown) => AiTell[];
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

  // maxTokens on an Opus 5 agent pays for its thinking as well as its
  // answer, and the API's default effort thinks hard. Every Opus cap below
  // was set from a measured run at the effort the agent uses (out = total
  // output tokens the API billed) with roughly 3x headroom, because a run
  // that hits the cap returns a truncated answer or none at all.
  sales_manager: {
    slug: 'sales_manager',
    label: 'Sales manager',
    provider: 'anthropic',
    model: 'claude-opus-5',
    // Measured at default effort: out=1284 for a 63-lead pipeline. A daily
    // cron with five minutes to run, so the cap is generous rather than tight.
    maxTokens: 8192,
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
    // Measured at default effort: out=522 for a ~150-token message. The old
    // 1024 cap left almost no room for the thinking that precedes it.
    maxTokens: 4096,
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
    // Measured at default effort: out=1478, which the old 1024 cap would
    // have cut off before the JSON closed.
    maxTokens: 4096,
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
    // Measured at default effort: out=894 for a short call script.
    maxTokens: 4096,
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

  icp_strategist: {
    slug: 'icp_strategist',
    label: 'ICP strategist',
    // Ten distinct segments and an argued pick is judgement, and it runs a
    // handful of times per workspace, so the cost of Opus is not a concern.
    provider: 'anthropic',
    model: 'claude-opus-5',
    // Ten distinct bets is judgement, so it keeps real thinking, but at
    // default effort a measured run billed out=9170 against the old 8192
    // cap and would have been cut off. Medium: out=6603 in about 90
    // seconds, still ten valid profiles. The answer itself is around 4000
    // tokens; the rest of the cap is room for the thinking before it. The
    // SDK refuses non-streaming calls above about 21000, so do not raise
    // this past that without moving callAnthropic to streaming.
    effort: 'medium',
    maxTokens: 16000,
    reads: ['business_profile'],
    writesChannels: [],
    buildPrompt: icpStrategist.buildPrompt,
    outputSchema: icpStrategist.outputSchema,
    // A batch missing two proposals is still eight choices for the owner.
    salvageSchema: icpStrategist.salvageSchema,
  },

  website_reader: {
    slug: 'website_reader',
    label: 'Website reader',
    // Extraction under a "leave it blank rather than infer it" rule is a
    // restraint job, and Opus holds the line where a smaller model fills the
    // field. Runs once per site, on a button press.
    provider: 'anthropic',
    model: 'claude-opus-5',
    // Transcription, not deliberation: at the default effort the model
    // spent a 4096 budget thinking and returned nothing. At low it answers
    // in under 3000 tokens; the rest is headroom for a wordy site.
    effort: 'low',
    maxTokens: 8192,
    // The page text comes in through `extra`, not the brain: the reader
    // knows the website and nothing about the workspace.
    reads: [],
    writesChannels: [],
    buildPrompt: websiteReader.buildPrompt,
    outputSchema: websiteReader.outputSchema,
  },

  profile_guesser: {
    slug: 'profile_guesser',
    label: 'Profile guesser',
    // The fallback for a site the reader could not read. Guessing what a
    // company does from its name and domain leans on knowing companies, and
    // on knowing when to leave a field empty, so Opus rather than Haiku.
    // Runs once per site, on a button press, only after the reader failed.
    provider: 'anthropic',
    model: 'claude-opus-5',
    // A short answer from very little input. Low effort for the same reason
    // as the reader: at the default it can think its budget away and
    // return nothing. Not yet measured; the cap is the reader's.
    effort: 'low',
    maxTokens: 8192,
    // Name, domain and scraps come in through `extra`: the guesser knows
    // nothing about the workspace, and reads nothing from it.
    reads: [],
    writesChannels: [],
    buildPrompt: profileGuesser.buildPrompt,
    outputSchema: profileGuesser.outputSchema,
  },
};
