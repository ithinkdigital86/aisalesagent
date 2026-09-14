// lib/anthropic/prompts/icp-strategist.test.ts
//
// Run with `npm test`. Nothing here calls a model. What is pinned is that
// the strategist is told which parts of the business profile are guesses:
// a field accepted from the profile guesser reaches the prompt tagged, is
// named in the list of unverified fields, and the instruction to treat it
// as a hypothesis is there. A profile with no guesses in it carries none of
// that, so the caveat is never boilerplate.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPrompt } from './icp-strategist.ts';
import { UNVERIFIED_MARK, type BusinessProfile } from '../../cadence/business-profile.ts';

const PROFILE: BusinessProfile = {
  id: 'p1',
  companyName: 'Acme',
  website: 'https://acme.example',
  description: 'Runs outbound email for founder-led companies.',
  services: ['Outbound email campaigns'],
  industriesServed: ['Logistics'],
  customerTypes: ['Founder-led B2B companies'],
  problemsSolved: [],
  differentiators: [],
  pricingModel: 'Monthly retainer',
  exclusions: [],
  fieldOrigins: {},
  updatedAt: '2026-09-14T00:00:00Z',
};

test('a profile with guessed fields reaches the strategist marked as such', () => {
  const { system, user } = buildPrompt({
    businessProfile: { ...PROFILE, fieldOrigins: { industriesServed: 'inferred', customerTypes: 'inferred' } },
  });

  assert.ok(system.includes(UNVERIFIED_MARK));
  assert.match(system, /Treat such a field as a hypothesis, not a fact/);
  assert.match(system, /Never restate a guessed field as something the company does/);

  assert.match(user, /except where a field is tagged as a guess/);
  assert.match(user, /Fields holding unverified guesses: industries served, customer types\./);
  assert.match(user, /not written by the owner and not read from the website/);
  assert.ok(user.includes(`Industries served ${UNVERIFIED_MARK}: Logistics`));
  assert.ok(user.includes(`Kinds of customer ${UNVERIFIED_MARK}: Founder-led B2B companies`));
  assert.ok(user.includes('Services: Outbound email campaigns'));
  // The blank fields are still listed as blank, separately.
  assert.match(user, /Fields the owner left blank: problems solved, differentiators\./);
});

test('a profile with no guessed fields carries no caveat about guesses', () => {
  const { user } = buildPrompt({ businessProfile: PROFILE });
  assert.doesNotMatch(user, /unverified/i);
  assert.doesNotMatch(user, /tagged as a guess/);
  assert.match(user, /^Business profile, as written by the owner\. It outranks/m);
});
