// lib/anthropic/prompts/content-creator.test.ts
//
// Run with `npm test`. Nothing here calls a model: what is pinned is the shape
// of a generated draft once it has been through outputSchema, and the rules the
// prompt states in order to get that shape.
//
// Two halves, and both matter.
//
// The prompt half asserts that every banned string actually reaches the text
// sent to the model. A banned list that never reaches the prompt bans nothing,
// and that failure is invisible from the output of any one run.
//
// The output half runs findAiTells over drafts in the shape the runtime hands
// on: a clean one has no tells, and one carrying an em dash, a banned opener, a
// banned phrase, a "not just X, but Y", a rule-of-three list, a mid-body
// rhetorical question or a sign-off pleasantry is caught by name.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BANNED_OPENERS,
  BANNED_PHRASES,
  BANNED_SIGN_OFFS,
  buildPrompt,
  findAiTells,
  LIMITS,
  outputSchema,
} from './content-creator.ts';

/** A lead shaped the way loadContext projects one. */
const LEAD = {
  id: 'lead-1',
  full_name: 'Priya Nair',
  title: 'Head of Support',
  company_name: 'Acme',
  company_domain: 'acme.example',
  employee_count: 120,
  industry: 'logistics',
  country: 'IN',
};

function systemPrompt(channel = 'email'): string {
  return buildPrompt({
    lead: LEAD,
    triggers: [{ trigger_type: 'hiring', headline: 'Acme is hiring four support agents' }],
    channel,
    offer: 'We run outbound for logistics firms.',
    sender: 'Sam Rivers',
  }).system;
}

/** The draft shape the runtime hands on, after outputSchema has had it. */
function draft(body: string, subject = 'acme support hiring') {
  return outputSchema.parse({
    subject,
    body,
    opening_line_rationale: 'built on the hiring trigger',
    personalisation_anchor: 'hiring four support agents',
    word_count: 0,
  });
}

/** Copy that breaks none of the rules, the control for every case below. */
const CLEAN_BODY = [
  "You're hiring four support agents this quarter.",
  'That usually means the queue got ahead of the team about two months ago, and the',
  'backlog is being answered with headcount because nothing else was to hand.',
  'I might have that wrong. Is the volume seasonal, or is it the new contracts?',
].join(' ');

// ---------------------------------------------------------------
// The rules reach the model
// ---------------------------------------------------------------

test('every banned opener, phrase and sign-off is stated in the prompt', () => {
  const system = systemPrompt();
  for (const banned of [...BANNED_OPENERS, ...BANNED_PHRASES, ...BANNED_SIGN_OFFS]) {
    assert.ok(
      system.includes(banned),
      `"${banned}" is in the banned list but never reaches the prompt`
    );
  }
});

test('the rules with no literal string to ban are still spelled out', () => {
  const system = systemPrompt().toLowerCase();
  for (const rule of [
    'em dashes',
    'not just x, but y',
    'rule-of-three',
    'rhetorical questions',
    'vary sentence length',
    'contractions',
    'never open two consecutive messages',
  ]) {
    assert.ok(system.includes(rule), `the prompt no longer states: ${rule}`);
  }
});

test('the constraints that predate the anti-tell rules are still there', () => {
  const system = systemPrompt();
  // Length, and that it is counted rather than aspirational.
  assert.match(system, new RegExp(`${LIMITS.emailWordsMin} to ${LIMITS.emailWordsMax} words`));
  assert.ok(system.includes('it is counted'));
  // No invented proof of any kind.
  assert.ok(system.includes('Never invent one'));
  assert.match(system, /not a case study, not a statistic/);
  // A subject that could not be pasted onto another prospect.
  assert.ok(system.includes('could not be pasted onto any other prospect'));
  // An honest hypothesis where there is no real proof.
  assert.ok(system.includes('honest hypothesis'));
});

// ---------------------------------------------------------------
// The output shape carries none of them
// ---------------------------------------------------------------

test('a clean draft has no tells', () => {
  assert.deepEqual(findAiTells(draft(CLEAN_BODY)), []);
});

test('a clean draft still parses to the shape the runtime hands on', () => {
  const parsed = draft(CLEAN_BODY);
  assert.equal(parsed.subject, 'acme support hiring');
  // word_count is recomputed rather than trusted, so the shape is complete.
  assert.equal(parsed.word_count, CLEAN_BODY.trim().split(/\s+/).length);
  assert.deepEqual(findAiTells(parsed), []);
});

test('an em dash is caught, and so is an en dash', () => {
  for (const dash of ['—', '–']) {
    const tells = findAiTells(draft(`You're hiring ${dash} that usually means the queue won.`));
    assert.deepEqual(
      tells.map((t) => t.rule),
      ['no em dashes or en dashes']
    );
  }
});

test('a dash in the subject is caught too', () => {
  const tells = findAiTells(draft(CLEAN_BODY, 'acme — support hiring'));
  assert.equal(tells.length, 1);
  assert.equal(tells[0].rule, 'no em dashes or en dashes');
});

test('each banned opener is caught by name', () => {
  for (const opener of BANNED_OPENERS) {
    const tells = findAiTells(draft(`${opener}. ${CLEAN_BODY}`));
    assert.ok(
      tells.some((t) => t.rule === 'banned opener' && t.found === opener),
      `not caught: ${opener}`
    );
  }
});

test('each banned phrase is caught by name', () => {
  for (const phrase of BANNED_PHRASES) {
    const tells = findAiTells(draft(`Worth a look: ${phrase}. ${CLEAN_BODY}`));
    assert.ok(
      tells.some((t) => t.rule === 'banned phrasing' && t.found === phrase),
      `not caught: ${phrase}`
    );
  }
});

test('a banned word is matched on its own, not inside a longer one', () => {
  // "moreover" is banned, "more" is not.
  assert.deepEqual(findAiTells(draft('You need more support agents. Is the volume seasonal?')), []);
});

test('each sign-off pleasantry is caught by name', () => {
  for (const signOff of BANNED_SIGN_OFFS) {
    const tells = findAiTells(draft(`${CLEAN_BODY} ${signOff}.`));
    assert.ok(
      tells.some((t) => t.rule === 'no sign-off pleasantries' && t.found === signOff),
      `not caught: ${signOff}`
    );
  }
});

test('"not just X, but Y" is caught, in both wordings', () => {
  for (const body of [
    'That is not just a hiring problem, but a routing one. Is the volume seasonal?',
    'That is not only a hiring problem but a routing one. Is the volume seasonal?',
  ]) {
    const tells = findAiTells(draft(body));
    assert.ok(
      tells.some((t) => t.rule === 'no "not just X, but Y"'),
      `not caught: ${body}`
    );
  }
});

test('a rule-of-three list is caught, with or without the Oxford comma', () => {
  for (const body of [
    'The queue grows, the replies slow, and the team burns out. Is that the shape of it?',
    'The queue grows, the replies slow and the team burns out. Is that the shape of it?',
  ]) {
    const tells = findAiTells(draft(body));
    assert.ok(
      tells.some((t) => t.rule === 'no rule-of-three lists'),
      `not caught: ${body}`
    );
  }
});

test('an ordinary clause holding a comma and an "and" is not a rule-of-three list', () => {
  const tells = findAiTells(
    draft(
      "Hi Priya, you're hiring four support agents and the help centre has not been updated since March. Is the volume seasonal?"
    )
  );
  assert.deepEqual(tells, []);
});

test('a question before the close is a rhetorical transition; the closing one is not', () => {
  const rhetorical = findAiTells(
    draft('So what changes when the queue doubles? Usually nothing. Is the volume seasonal?')
  );
  assert.deepEqual(
    rhetorical.map((t) => t.rule),
    ['no rhetorical questions as transitions']
  );

  assert.deepEqual(findAiTells(draft('You are hiring four agents. Is the volume seasonal?')), []);
});

test('a draft can break several rules at once and every one is reported', () => {
  const tells = findAiTells(
    draft(
      'I wanted to reach out — it’s worth noting your queue is robust. Best regards.',
      'quick question'
    )
  );
  const rules = new Set(tells.map((t) => t.rule));
  assert.ok(rules.has('no em dashes or en dashes'));
  assert.ok(rules.has('banned opener'));
  assert.ok(rules.has('banned phrasing'));
  assert.ok(rules.has('no sign-off pleasantries'));
  assert.equal(tells.filter((t) => t.found === 'quick question').length, 1);
});
