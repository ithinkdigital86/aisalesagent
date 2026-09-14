// lib/cadence/pricing.ts
//
// Approximate USD per 1M tokens. Rates are per provider, because the two
// providers price nothing alike: an Opus output token and a gpt-5 output token
// differ by more than 7x, so a single shared table would quietly misreport
// spend the moment an agent moved between them.
//
// agent_runs stores the model string and not the provider, so the provider is
// recovered from the model here. That keeps the table the one place a new model
// has to be registered, and keeps the dashboard reading the same numbers the
// runtime charged.

import type { Provider } from './registry.ts';

export interface TokenRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const TOKEN_RATES: Record<Provider, Record<string, TokenRate>> = {
  anthropic: {
    'claude-opus-5': { input: 15, output: 75 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  },
  openai: {
    'gpt-5': { input: 1.25, output: 10 },
    'gpt-5-mini': { input: 0.25, output: 2 },
  },
};

/**
 * What an unknown model is assumed to cost. Deliberately the cheapest rate on
 * each provider: a spend figure that is too low is obviously wrong when the
 * invoice lands, whereas one inflated by a guess gets believed.
 */
const FALLBACK_RATE: Record<Provider, TokenRate> = {
  anthropic: { input: 1, output: 5 },
  openai: { input: 0.25, output: 2 },
};

/**
 * The provider that serves a model string. Exact table membership decides it;
 * the prefix check is only for a model that was logged before it was priced.
 */
export function providerForModel(model: string): Provider {
  for (const provider of Object.keys(TOKEN_RATES) as Provider[]) {
    if (model in TOKEN_RATES[provider]) return provider;
  }
  return model.startsWith('claude') ? 'anthropic' : 'openai';
}

export function rateFor(model: string): TokenRate {
  const provider = providerForModel(model);
  return TOKEN_RATES[provider][model] ?? FALLBACK_RATE[provider];
}

/** Estimated USD for one run. Display only, never billed against. */
export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = rateFor(model);
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}
