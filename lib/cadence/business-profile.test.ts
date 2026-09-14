// lib/cadence/business-profile.test.ts
//
// Run with `npm test`. What is pinned is the origin bookkeeping that keeps
// a profile built on guesses from reading as one built on research: an
// origin never survives on an empty field, only 'inferred' counts as
// unverified, and the prose the strategist reads tags a guessed field on
// the line that carries the guess.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  businessProfileSchema,
  describeBusinessProfile,
  fieldOriginsFromRow,
  fieldOriginsToRow,
  normaliseFieldOrigins,
  originOf,
  UNVERIFIED_MARK,
  unverifiedFields,
  type BusinessProfile,
} from './business-profile.ts';

const PROFILE: BusinessProfile = {
  id: 'p1',
  companyName: 'Acme',
  website: 'https://acme.example',
  description: 'Runs outbound email for founder-led companies.',
  services: ['Outbound email campaigns'],
  industriesServed: ['Logistics', 'Professional services'],
  customerTypes: [],
  problemsSolved: ['No one owns outbound'],
  differentiators: [],
  pricingModel: null,
  exclusions: ['Agencies'],
  fieldOrigins: { description: 'from_website', industriesServed: 'inferred', problemsSolved: 'inferred' },
  updatedAt: '2026-09-14T00:00:00Z',
};

test('an origin on an empty field is dropped, and manual is never stored', () => {
  const kept = normaliseFieldOrigins(
    { description: 'inferred', services: 'from_website', industriesServed: 'inferred', exclusions: 'manual' },
    { description: '   ', services: ['Outbound email'], industriesServed: [], exclusions: ['Agencies'] }
  );
  assert.deepEqual(kept, { services: 'from_website' });
  assert.deepEqual(normaliseFieldOrigins(null, {}), {});
});

test('the row map uses column names and ignores what it does not recognise', () => {
  assert.deepEqual(fieldOriginsToRow({ industriesServed: 'inferred', description: 'from_website', services: 'manual' }), {
    industries_served: 'inferred',
    description: 'from_website',
  });
  assert.deepEqual(fieldOriginsFromRow({ industries_served: 'inferred', customer_types: 'manual', services: 'made_up', nonsense: 'inferred' }), {
    industriesServed: 'inferred',
  });
  assert.deepEqual(fieldOriginsFromRow(null), {});
  assert.deepEqual(fieldOriginsFromRow(['inferred']), {});
});

test('only inferred fields are unverified; website and manual ones are not', () => {
  assert.equal(originOf(PROFILE, 'description'), 'from_website');
  assert.equal(originOf(PROFILE, 'services'), 'manual');
  assert.equal(originOf(PROFILE, 'industriesServed'), 'inferred');
  assert.deepEqual(unverifiedFields(PROFILE), ['industries served', 'problems solved']);
  assert.deepEqual(unverifiedFields({ fieldOrigins: {} }), []);
});

test('the prose tags a guessed field on its own line and nothing else', () => {
  const prose = describeBusinessProfile(PROFILE);
  const lines = prose.split('\n');
  const tagged = lines.filter((line) => line.includes(UNVERIFIED_MARK));
  assert.deepEqual(
    tagged.map((line) => line.slice(0, line.indexOf(` ${UNVERIFIED_MARK}:`))),
    ['Industries served', 'Problems it solves']
  );
  assert.match(prose, /^Industries served \[UNVERIFIED GUESS[^\n]*: Logistics; Professional services$/m);
  // A field accepted from the website is research, not a guess.
  assert.match(prose, /^What the business does, in its own words: Runs outbound email/m);
  // An empty field is "not stated", never tagged, whatever the map says.
  const blank = describeBusinessProfile({ ...PROFILE, industriesServed: [], fieldOrigins: { industriesServed: 'inferred' } });
  assert.match(blank, /^Industries served: not stated$/m);
  assert.doesNotMatch(blank, /UNVERIFIED/);
});

test('the form contract accepts a partial origin map and defaults to none', () => {
  const parsed = businessProfileSchema.parse({ companyName: 'Acme', fieldOrigins: { services: 'inferred' } });
  assert.deepEqual(parsed.fieldOrigins, { services: 'inferred' });
  assert.deepEqual(businessProfileSchema.parse({ companyName: 'Acme' }).fieldOrigins, {});
  assert.equal(businessProfileSchema.safeParse({ companyName: 'Acme', fieldOrigins: { services: 'guessed' } }).success, false);
  assert.equal(businessProfileSchema.safeParse({ companyName: 'Acme', fieldOrigins: { pricingModel: 'inferred' } }).success, false);
});
