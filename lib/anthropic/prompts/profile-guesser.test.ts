// lib/anthropic/prompts/profile-guesser.test.ts
//
// Run with `npm test`. Nothing here calls a model. What is pinned is that
// the guesser's answer reaches the form as guesses and nothing else: every
// value comes with its reasoning, duplicates collapse, a careless shape
// does not fail the run, and the prompt says in as many words that the
// entries are guesses, carries the name, the domain and whatever scraps
// there were, and never presents any of it as read from the site.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPrompt,
  collectGuesses,
  countGuesses,
  LIMITS,
  outputSchema,
  renderScraps,
} from './profile-guesser.ts';

function guess(value: string, why: string) {
  return { value, why };
}

test('guesses reach the form by field name, each with its reasoning, duplicates collapsed', () => {
  const output = outputSchema.parse({
    description: guess('Appears to run outbound email for founder-led companies.', 'The meta description says so.'),
    services: [
      guess('Outbound email campaigns', 'Meta description'),
      guess('Outbound email campaigns.', 'Repeated'),
      guess('LinkedIn prospecting', 'Common for agencies of this kind; unconfirmed'),
    ],
    industries_served: [],
    customer_types: [guess('Founder-led B2B companies', "Guess from the name; 'founders' in the title")],
    problems_solved: [guess('No one owns outbound', 'Guess from the service')],
    differentiators: [],
    exclusions: [],
    notes: 'Very little to go on. Check the services first.',
  });

  const guesses = collectGuesses(output);
  assert.equal(guesses.description?.value, 'Appears to run outbound email for founder-led companies.');
  assert.equal(guesses.description?.why, 'The meta description says so.');
  assert.deepEqual(
    guesses.services.map((g) => g.value),
    ['Outbound email campaigns', 'LinkedIn prospecting']
  );
  assert.equal(guesses.services[1].why, 'Common for agencies of this kind; unconfirmed');
  assert.deepEqual(guesses.industriesServed, []);
  assert.deepEqual(guesses.customerTypes.map((g) => g.value), ['Founder-led B2B companies']);
  assert.deepEqual(guesses.problemsSolved.map((g) => g.value), ['No one owns outbound']);
  assert.deepEqual(guesses.differentiators, []);
  assert.deepEqual(guesses.exclusions, []);
  assert.equal(countGuesses(guesses), 5);
});

test('the schema tolerates a careless shape without failing the run', () => {
  const parsed = outputSchema.parse({
    description: 'A bare string, not an object',
    services: 'one string, not a list',
    industries_served: [{ value: '', why: 'x' }, { value: 'Logistics' }, 42, null],
    customer_types: null,
    notes: undefined,
  });
  assert.deepEqual(parsed.description, { value: 'A bare string, not an object', why: '' });
  assert.deepEqual(parsed.services, []);
  assert.deepEqual(parsed.industries_served, [{ value: 'Logistics', why: '' }]);
  assert.deepEqual(parsed.customer_types, []);
  assert.deepEqual(parsed.problems_solved, []);
  assert.equal(parsed.notes, '');

  // There is no quote to check, so an item with no reasoning still reaches
  // the form: as a guess with nothing behind it, which the form says.
  const guesses = collectGuesses(parsed);
  assert.equal(countGuesses(guesses), 2);
  assert.equal(guesses.industriesServed[0].why, '');
});

test('an answer with every field empty is a valid answer', () => {
  const parsed = outputSchema.parse({ description: null, notes: 'Nothing to go on.' });
  assert.equal(countGuesses(collectGuesses(parsed)), 0);
});

test('lists and values are capped at the stated limits', () => {
  const many = Array.from({ length: LIMITS.listItems + 5 }, (_, i) => guess(`Service ${i}`, 'w'.repeat(LIMITS.why + 50)));
  const parsed = outputSchema.parse({ services: many, description: guess('d'.repeat(LIMITS.description + 10), 'e') });
  assert.equal(parsed.services.length, LIMITS.listItems);
  assert.equal(parsed.services[0].why.length, LIMITS.why);
  assert.equal(parsed.description?.value.length, LIMITS.description);
});

test('scraps are rendered by what they are, and their absence is said', () => {
  assert.match(renderScraps(null), /could not be read at all/);
  assert.match(renderScraps({ domain: 'acme.example', title: null, description: null, text: '' }), /Nothing usable/);
  const rendered = renderScraps({
    domain: 'acme.example',
    title: 'Acme — outbound for founders',
    description: 'We run outbound email for founder-led companies.',
    text: 'Loading',
  });
  assert.match(rendered, /Page title: Acme — outbound for founders/);
  assert.match(rendered, /Meta description: We run outbound email for founder-led companies\./);
  assert.match(rendered, /Text on the page \(little of it\):\nLoading/);
});

test('the prompt calls the entries guesses, carries the inputs, and states the shape and limits', () => {
  const { system, user } = buildPrompt({
    companyName: 'Acme',
    domain: 'acme.example',
    scraps: { domain: 'acme.example', title: 'Acme — outbound for founders', description: null, text: '' },
  });

  assert.match(system, /Every entry you write is a guess/);
  assert.match(system, /Do not pretend a guess is knowledge/);
  assert.match(system, /Empty is a correct answer/);
  assert.match(system, /Prefer the recovered text over the name/);
  assert.match(system, new RegExp(`at most ${LIMITS.listItems} entries`));
  assert.match(system, new RegExp(`at most ${LIMITS.listItem} characters`));
  assert.match(system, new RegExp(`At most ${LIMITS.description} characters`));
  assert.match(system, new RegExp(`at most ${LIMITS.why} characters`));
  for (const key of ['description', 'services', 'industries_served', 'customer_types', 'problems_solved', 'differentiators', 'exclusions', 'notes']) {
    assert.match(system, new RegExp(`"${key}":`), key);
  }
  // Every value carries reasoning, not evidence: there is nothing to quote.
  assert.match(system, /"why": string/);
  assert.doesNotMatch(system, /"evidence"/);

  assert.match(user, /Company name, as the owner wrote it: "Acme"/);
  assert.match(user, /Domain: acme\.example/);
  assert.match(user, /Page title: Acme — outbound for founders/);
  assert.match(user, /Draft guesses/);

  const bare = buildPrompt({ companyName: ' Acme ', domain: null, scraps: null }).user;
  assert.match(bare, /"Acme"/);
  assert.match(bare, /Domain: not given/);
  assert.match(bare, /could not be read at all/);
});
