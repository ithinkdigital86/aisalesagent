// lib/anthropic/prompts/website-reader.test.ts
//
// Run with `npm test`. Nothing here calls a model. What is pinned is the
// check that turns "only what the pages say" from a request into a rule:
// a suggestion whose quote is in the page text reaches the form, one whose
// quote is not does not, and the owner is told about the second kind. The
// prompt half asserts the rule, the shape and the limits actually reach the
// text the model is sent.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPrompt,
  countSuggestions,
  LIMITS,
  normaliseForMatch,
  outputSchema,
  quoteAppears,
  verifySuggestions,
} from './website-reader.ts';

const PAGES = [
  {
    url: 'https://acme.example/',
    title: 'Acme',
    text: 'Outbound, done by people\nWe run outbound email for founder-led B2B companies that have no sales team of their own.\nEvery message is reviewed by a person before it is sent — no exceptions.',
  },
  {
    url: 'https://acme.example/about-us',
    title: 'About Acme',
    text: 'We work with logistics firms and professional services practices.\nWe don’t work with agencies.',
  },
];

function claim(value: string, evidence: string) {
  return { value, evidence };
}

test('normalisation ignores case, punctuation, accents and line breaks', () => {
  assert.equal(normaliseForMatch('  Reviewed — by a “person”!\n Café  '), 'reviewed by a person cafe');
});

test('a quote counts when it is in the text give or take punctuation, and not otherwise', () => {
  const text = PAGES.map((p) => p.text).join('\n');
  assert.equal(quoteAppears('every message is reviewed by a person before it is sent', text), true);
  assert.equal(quoteAppears('Every message is reviewed by a person before it is sent, no exceptions.', text), true);
  assert.equal(quoteAppears("We don't work with agencies", text), true);
  assert.equal(quoteAppears('Every message is reviewed by two people', text), false);
  // Too short to be a statement: "we run" is in the text, and proves nothing.
  assert.equal(quoteAppears('we run', text), false);
  assert.equal(quoteAppears('', text), false);
});

test('supported suggestions reach the form and unsupported ones are reported by field', () => {
  const output = outputSchema.parse({
    description: claim(
      'Runs outbound email for founder-led B2B companies without a sales team.',
      'We run outbound email for founder-led B2B companies that have no sales team of their own.'
    ),
    services: [
      claim('Outbound email campaigns', 'We run outbound email for founder-led B2B companies'),
      claim('LinkedIn prospecting', 'We also run LinkedIn prospecting for the same companies'),
    ],
    industries_served: [
      claim('Logistics', 'We work with logistics firms'),
      claim('Professional services', 'logistics firms and professional services practices'),
      claim('Retail', 'We work with retail chains'),
    ],
    customer_types: [claim('Founder-led B2B companies with no sales team', 'founder-led B2B companies that have no sales team of their own')],
    problems_solved: [],
    differentiators: [claim('Every message is reviewed by a person before it is sent', 'Every message is reviewed by a person before it is sent')],
    exclusions: [claim('Agencies', 'We don’t work with agencies')],
    notes: 'The pages do not state pricing or the problems customers come with.',
    pages_used: ['1', '2'],
  });

  const { suggestions, unsupported } = verifySuggestions(output, PAGES);

  assert.equal(suggestions.description?.value, 'Runs outbound email for founder-led B2B companies without a sales team.');
  assert.deepEqual(suggestions.services.map((s) => s.value), ['Outbound email campaigns']);
  assert.deepEqual(suggestions.industriesServed.map((s) => s.value), ['Logistics', 'Professional services']);
  assert.deepEqual(suggestions.customerTypes.map((s) => s.value), ['Founder-led B2B companies with no sales team']);
  assert.deepEqual(suggestions.problemsSolved, []);
  assert.deepEqual(suggestions.differentiators.map((s) => s.value), ['Every message is reviewed by a person before it is sent']);
  assert.deepEqual(suggestions.exclusions.map((s) => s.value), ['Agencies']);
  assert.equal(countSuggestions(suggestions), 7);

  assert.deepEqual(
    unsupported.map((u) => [u.field, u.value]),
    [
      ['services', 'LinkedIn prospecting'],
      ['industriesServed', 'Retail'],
    ]
  );
});

test('a description with no quote, or a quote not in the text, is dropped rather than shown', () => {
  const noQuote = outputSchema.parse({ description: { value: 'A company that does things.', evidence: '' } });
  assert.equal(verifySuggestions(noQuote, PAGES).suggestions.description, null);
  assert.equal(verifySuggestions(noQuote, PAGES).unsupported.length, 1);

  const invented = outputSchema.parse({
    description: claim('Acme is the leading outbound agency in Europe.', 'the leading outbound agency in Europe'),
  });
  assert.equal(verifySuggestions(invented, PAGES).suggestions.description, null);
});

test('the same value twice in one field is one suggestion', () => {
  const output = outputSchema.parse({
    services: [
      claim('Outbound email', 'We run outbound email for founder-led B2B companies'),
      claim('Outbound email.', 'We run outbound email for founder-led B2B companies'),
    ],
  });
  assert.deepEqual(verifySuggestions(output, PAGES).suggestions.services.map((s) => s.value), ['Outbound email']);
});

test('the schema tolerates a careless shape without failing the run', () => {
  const parsed = outputSchema.parse({
    description: 'A bare string, not an object',
    services: 'one string, not a list',
    industries_served: [{ value: '', evidence: 'x' }, { value: 'Logistics' }, 42, null],
    customer_types: null,
    notes: undefined,
  });
  assert.deepEqual(parsed.description, { value: 'A bare string, not an object', evidence: '' });
  assert.deepEqual(parsed.services, []);
  assert.deepEqual(parsed.industries_served, [{ value: 'Logistics', evidence: '' }]);
  assert.deepEqual(parsed.customer_types, []);
  assert.deepEqual(parsed.problems_solved, []);
  assert.equal(parsed.notes, '');
  assert.deepEqual(parsed.pages_used, []);

  // With no quote to check, none of it reaches the form.
  const { suggestions, unsupported } = verifySuggestions(parsed, PAGES);
  assert.equal(countSuggestions(suggestions), 0);
  assert.equal(unsupported.length, 2);
});

test('lists and values are capped at the stated limits', () => {
  const many = Array.from({ length: LIMITS.listItems + 5 }, (_, i) => claim(`Service ${i}`, 'x'.repeat(LIMITS.evidence + 50)));
  const parsed = outputSchema.parse({ services: many, description: claim('d'.repeat(LIMITS.description + 10), 'e') });
  assert.equal(parsed.services.length, LIMITS.listItems);
  assert.equal(parsed.services[0].evidence.length, LIMITS.evidence);
  assert.equal(parsed.description?.value.length, LIMITS.description);
});

test('the prompt states the rule, the shape, the limits and carries every page', () => {
  const { system, user } = buildPrompt({ pages: PAGES, companyName: 'Acme' });

  assert.match(system, /only what the pages say/i);
  assert.match(system, /Empty is a correct answer/);
  assert.match(system, /word for word/);
  assert.match(system, /checked mechanically/);
  assert.match(system, /thrown away/);
  assert.match(system, /Do not infer an industry from a customer's name/);
  assert.match(system, new RegExp(`between ${LIMITS.evidenceMin} and ${LIMITS.evidence} characters`));
  assert.match(system, new RegExp(`at most ${LIMITS.listItems} entries`));
  assert.match(system, new RegExp(`at most ${LIMITS.listItem} characters`));
  assert.match(system, new RegExp(`At most ${LIMITS.description} characters`));
  for (const key of ['description', 'services', 'industries_served', 'customer_types', 'problems_solved', 'differentiators', 'exclusions', 'notes', 'pages_used']) {
    assert.match(system, new RegExp(`"${key}":`), key);
  }

  assert.match(user, /calls the company "Acme"/);
  assert.match(user, /2 pages/);
  for (const page of PAGES) {
    assert.ok(user.includes(page.url), page.url);
    assert.ok(user.includes(page.text), page.url);
  }
  assert.match(user, /Page 1: https:\/\/acme\.example\/ \(Acme\)/);

  const unnamed = buildPrompt({ pages: PAGES.slice(0, 1) }).user;
  assert.match(unnamed, /has not named the company yet/);
  assert.match(unnamed, /1 page,/);
});
