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
// banned phrase, a jargon coinage, a "not just X, but Y", a rule-of-three list
// in either punctuation, a mid-body rhetorical question, a second question, a
// written-out "I am", a hedging pair, no short sentence at all, or a sign-off
// pleasantry is caught by name.
//
// The worked examples sit between the two. They are shown to the model as the
// target, so each one is held to every counted rule and to the email length
// rule: an example that broke one would teach the model to break it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BANNED_OPENERS,
  BANNED_PHRASES,
  BANNED_SIGN_OFFS,
  buildPrompt,
  EXPANDED_FORMS,
  findAiTells,
  JARGON_COINAGES,
  LIMITS,
  outputSchema,
  reviewDraft,
  WORKED_EXAMPLES,
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

/**
 * Copy that breaks none of the rules, the control for every case below. It
 * opens on a seven-word sentence, contracts everything it can, and spends its
 * one question mark on the last character.
 */
const CLEAN_BODY = [
  "You're hiring four support agents this quarter.",
  'That usually means the queue got ahead of the team about two months ago, and the',
  'backlog is being answered with headcount because nothing else was to hand.',
  'I might have that wrong. Is the volume seasonal, or is it the new contracts?',
].join(' ');

// ---------------------------------------------------------------
// The rules reach the model
// ---------------------------------------------------------------

test('every banned opener, phrase, sign-off and coinage is stated in the prompt', () => {
  const system = systemPrompt();
  for (const banned of [
    ...BANNED_OPENERS,
    ...BANNED_PHRASES,
    ...BANNED_SIGN_OFFS,
    ...JARGON_COINAGES,
  ]) {
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
    'never describe what you do',
    'never state that the observation is based on their size, their role or their industry',
    'a short sentence is still a sentence',
    'no jargon coinages',
  ]) {
    assert.ok(system.includes(rule), `the prompt no longer states: ${rule}`);
  }
});

test('the diagnosis is the message: no describing what you do, in the words drafts use', () => {
  const system = systemPrompt();
  assert.match(system, /Diagnose, do not offer/);
  assert.ok(system.includes('"I help teams"'));
  assert.match(system, /The diagnosis is the message/);
  assert.match(system, /The offer comes later in the conversation/);
  // The old wording licensed a pitch after the diagnosis, and it is gone.
  assert.ok(!system.includes('before you mention what you do'));
});

test('a thin guess is owned, not explained away by size, role or industry', () => {
  const system = systemPrompt();
  assert.match(system, /make the guess and own it as a guess/);
  assert.match(system, /Do not disclose how thin the evidence under it is/);
  // The wording that asked the model to say what led it to the guess is gone,
  // because for a no-anchor lead that was the size, role or industry.
  assert.ok(!system.includes('say what led you to think it'));
  // And the anchor field's fallback paragraph agrees with the rule.
  assert.match(system, /owning the guess, not citing their headcount, title or sector/);
});

test('the short-sentence floor says a fragment does not clear it', () => {
  const system = systemPrompt();
  assert.match(system, /A short sentence is still a sentence/);
  assert.match(system, /A fragment dropped in to clear the count/);
});

test('the short-sentence floor reaches the prompt as a number, not a vibe', () => {
  const system = systemPrompt();
  assert.ok(system.includes(`under ${LIMITS.shortSentenceWords} words`));
  // And it is stated as something checked, so the model does not read it as advice.
  assert.match(system, /counted rather than judged/);
});

test('contractions are stated as expected, with the swaps written out', () => {
  const system = systemPrompt();
  assert.match(system, /Contractions are expected, not merely allowed/);
  for (const [written, short] of EXPANDED_FORMS.slice(0, 4)) {
    assert.ok(system.includes(`"${written}" is "${short}"`), `swap not stated: ${written}`);
  }
  // The four the drafts keep reaching for are named outright.
  for (const written of ['I am', 'you are', 'it is', 'does not']) {
    assert.ok(system.includes(`"${written}"`), `not called out by name: ${written}`);
  }
});

test('the one-question rule says one, at the end, with nothing after it', () => {
  const system = systemPrompt();
  assert.match(system, /Exactly one question mark in the whole message/);
  assert.match(system, /last character/);
  assert.match(system, /no second ask in any form/);
});

test('the rule-of-three ban covers the comma form and mid-sentence lists', () => {
  const system = systemPrompt();
  assert.ok(system.includes('"X, Y, Z"'));
  assert.match(system, /three or more comma-separated pieces inside a single sentence/);
});

test('the observation must be built on this lead’s own data, said plainly', () => {
  const system = systemPrompt();
  assert.match(system, /must come from this lead's own data/);
  assert.match(system, /Not their industry, not their job title in general/);
  assert.match(system, /could be sent unchanged to any other company in the same sector/);
  // The metadata field is held to the same standard, not a looser one.
  assert.match(system, /quoted or paraphrased from this lead's own record/);
});

test('hedging pairs are banned by name, with the menu they produce', () => {
  const system = systemPrompt();
  assert.match(system, /No hedging pairs/);
  assert.ok(system.includes(`if I'm off ... if I'm close`));
  assert.match(system, /One hypothesis, never a menu/);
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
// The worked examples are the target, so they clear every rule
// ---------------------------------------------------------------

test('the primary example is the draft the team picked, and it leads', () => {
  const [primary] = WORKED_EXAMPLES;
  assert.ok(primary.body.startsWith('This is a cold email, so'));
  assert.ok(primary.body.endsWith('Who owns outbound end to end on your side?'));
  assert.ok(primary.body.includes("Sales quietly stops trusting marketing's leads."));
});

test('every worked example reaches the prompt, on every channel', () => {
  for (const channel of ['email', 'linkedin', 'instagram', 'voice']) {
    const system = systemPrompt(channel);
    for (const example of WORKED_EXAMPLES) {
      assert.ok(system.includes(`"${example.body}"`), `${channel}: example missing`);
    }
  }
});

test('the examples are marked as examples, not templates, and not to be lifted', () => {
  const system = systemPrompt();
  assert.match(system, /They are examples, not templates/);
  assert.match(system, /Do not reuse their openings/);
  assert.ok(system.includes('do not write "This is a cold email" because the first one does'));
});

test('every worked example is clean on every counted rule', () => {
  for (const [n, example] of WORKED_EXAMPLES.entries()) {
    assert.deepEqual(findAiTells(draft(example.body)), [], `example ${n + 1} carries a tell`);
  }
});

test('every worked example obeys the email length rule for its step', () => {
  for (const [n, example] of WORKED_EXAMPLES.entries()) {
    const words = example.body.trim().split(/\s+/).length;
    if (example.step === 1) {
      assert.ok(
        words >= LIMITS.emailWordsMin && words <= LIMITS.emailWordsMax,
        `example ${n + 1} is ${words} words, outside the first-touch range`
      );
    } else {
      assert.ok(words < LIMITS.emailWordsMin, `example ${n + 1} is ${words} words, not shorter`);
    }
  }
});

test('the examples cover both branches of the anchor rule and a later step', () => {
  const notes = WORKED_EXAMPLES.map((example) => example.note);
  assert.ok(notes.some((note) => note.includes('personalisation_anchor is "none"')));
  assert.ok(notes.some((note) => note.includes('built on a trigger')));
  assert.ok(WORKED_EXAMPLES.some((example) => example.step > 1));
});

test('no example describes what we do or explains the guess by size, role or industry', () => {
  for (const [n, example] of WORKED_EXAMPLES.entries()) {
    const body = example.body.toLowerCase();
    for (const pitch of ['i help', 'we help', 'we work with', 'what we do', 'our platform', 'our service']) {
      assert.ok(!body.includes(pitch), `example ${n + 1} pitches: ${pitch}`);
    }
    for (const basis of ['given your', 'companies your size', 'in your industry', 'in your sector', 'as a head of']) {
      assert.ok(!body.includes(basis), `example ${n + 1} explains the guess away: ${basis}`);
    }
  }
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
    // The clean body with one comma swapped for a dash, so the dash is the
    // only thing wrong with it.
    const tells = findAiTells(draft(CLEAN_BODY.replace('ago,', `ago ${dash}`)));
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

test('each jargon coinage is caught by name', () => {
  for (const coinage of JARGON_COINAGES) {
    const tells = findAiTells(draft(`Worth a look: ${coinage}. ${CLEAN_BODY}`));
    assert.ok(
      tells.some((t) => t.rule === 'no jargon coinages' && t.found === coinage),
      `not caught: ${coinage}`
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
    "That's not just a hiring problem, but a routing one. Is the volume seasonal?",
    "That's not only a hiring problem but a routing one. Is the volume seasonal?",
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

test('a comma-only triad is a rule-of-three list, conjunction or not', () => {
  const tells = findAiTells(
    draft('The queue grows, the replies slow, the team burns out. Is that the shape of it?')
  );
  assert.ok(tells.some((t) => t.rule === 'no rule-of-three lists'));
});

test('a triad buried mid-sentence is caught, not just one closing a sentence', () => {
  const body =
    "My guess is the signal's there, buried in form text, email replies, and partner notes, but it never reaches the person who can act on it. Is that the shape of it?";
  const tells = findAiTells(draft(body));
  const three = tells.find((t) => t.rule === 'no rule-of-three lists');
  assert.ok(three, 'a list sitting mid-sentence went unreported');
  assert.match(three.found, /email replies/);
});

test('an ordinary clause holding a comma and an "and" is not a rule-of-three list', () => {
  const tells = findAiTells(
    draft(
      "Hi Priya, you're hiring four support agents and the help centre hasn't been updated since March. Is the volume seasonal?"
    )
  );
  assert.deepEqual(tells, []);
});

test('two comma-separated clauses are not a list', () => {
  const tells = findAiTells(
    draft("You're hiring four agents, and the help centre has stood still since March. Why now?")
  );
  assert.deepEqual(tells, []);
});

test('a question before the close is a rhetorical transition; the closing one is not', () => {
  const rhetorical = findAiTells(
    draft('So what changes when the queue doubles? Usually nothing. Is the volume seasonal?')
  );
  assert.deepEqual(
    rhetorical.map((t) => t.rule),
    [
      'no rhetorical questions as transitions',
      'exactly one question, at the end, nothing after it',
    ]
  );

  assert.deepEqual(findAiTells(draft("You're hiring four agents. Is the volume seasonal?")), []);
});

test('a second question is caught even when both sit at the end', () => {
  const tells = findAiTells(
    draft("You're hiring four agents. Is the volume seasonal? Or is it the new contracts?")
  );
  assert.ok(tells.some((t) => t.rule === 'exactly one question, at the end, nothing after it'));
});

test('anything after the question is caught, and so is having no question', () => {
  const trailing = findAiTells(
    draft("You're hiring four agents. Is the volume seasonal? Either way, let me know.")
  );
  const after = trailing.find((t) => t.rule === 'exactly one question, at the end, nothing after it');
  assert.ok(after, 'text after the closing question went unreported');
  assert.equal(after.found, 'Either way, let me know.');

  const none = findAiTells(draft("You're hiring four agents. The queue got there first."));
  assert.ok(none.some((t) => t.rule === 'exactly one question, at the end, nothing after it'));
});

test('each written-out form is caught, and the contraction is not', () => {
  for (const [written] of EXPANDED_FORMS) {
    const tells = findAiTells(draft(`${written} watching the queue. Is the volume seasonal?`));
    assert.ok(
      tells.some(
        (t) =>
          t.rule === 'contractions, not written-out forms' &&
          t.found.toLowerCase() === written.toLowerCase()
      ),
      `not caught: ${written}`
    );
  }
  assert.deepEqual(findAiTells(draft("It's the queue, I'm guessing. Is the volume seasonal?")), []);
});

test('an overlapping written-out form is reported once, not twice', () => {
  const tells = findAiTells(
    draft("That is the pattern every quarter here. Is the volume seasonal?")
  ).filter((t) => t.rule === 'contractions, not written-out forms');
  assert.deepEqual(
    tells.map((t) => t.found),
    ['That is']
  );
});

test('a hedging pair is caught; a single honest admission is not', () => {
  const pair = findAiTells(
    draft(
      "You're hiring four agents. The queue got there first. If I'm off, tell me. If I'm close, is the drag routing or volume?"
    )
  );
  const hedge = pair.find((t) => t.rule === 'no hedging pairs, one hypothesis');
  assert.ok(hedge, 'a two-reading menu went unreported');
  assert.match(hedge.found, /If I'm off[\s\S]*If I'm close/);

  const single = findAiTells(
    draft("You're hiring four agents. The queue got there first. If I'm wrong, is it seasonal?")
  );
  assert.deepEqual(single.filter((t) => t.rule === 'no hedging pairs, one hypothesis'), []);
});

test('a draft with no short sentence anywhere is caught, and quotes the nearest miss', () => {
  const body = [
    'The hiring push for four support agents suggests the queue got ahead of the team.',
    'The backlog is now being answered with headcount because nothing else was to hand.',
    'Is the volume seasonal or is it the new contracts driving it?',
  ].join(' ');
  const tells = findAiTells(draft(body));
  const rhythm = tells.find(
    (t) => t.rule === `at least one sentence under ${LIMITS.shortSentenceWords} words`
  );
  assert.ok(rhythm, 'three long sentences and no tell');
  assert.match(rhythm.found, /^Is the volume seasonal/);
});

test('one sentence under the floor is enough to clear the rhythm rule', () => {
  const tells = findAiTells(
    draft(
      "You're hiring four support agents this quarter. That usually means the queue got ahead of the team some months back. Is the volume seasonal?"
    )
  );
  assert.deepEqual(tells, []);
});

test('the draft that prompted these rules is caught on every one of them', () => {
  const tells = findAiTells(
    draft(
      'Running growth at a fintech, you probably see deals slow for reasons that are not about demand, compliance reviews and procurement stall momentum, reps lose context, and warm interest cools. ' +
        'My guess is the signal is there, buried in form text, email replies, and partner notes, but it never makes it to the person who can act within a day. ' +
        'If I am off, tell me. If I am close, is the bigger drag intent detection, or getting timely context to the owner?',
      'fintech deal velocity'
    )
  );
  const rules = new Set(tells.map((t) => t.rule));
  assert.ok(rules.has('no rule-of-three lists'), 'the comma triads went unreported');
  assert.ok(rules.has('contractions, not written-out forms'), '"I am" went unreported');
  assert.ok(rules.has('no hedging pairs, one hypothesis'), 'the off/close menu went unreported');
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
  assert.ok(rules.has('exactly one question, at the end, nothing after it'));
  assert.equal(tells.filter((t) => t.found === 'quick question').length, 1);
});

// ---------------------------------------------------------------
// The review hook the runtime calls
// ---------------------------------------------------------------
//
// reviewDraft is what the registry hands the runtime as reviewOutput. It is
// called with the parsed output as an unknown, so the narrowing has to be
// right: a draft is reviewed, anything that is not a draft is nothing to
// review, and a found tell comes back in the shape the runtime quotes to the
// model and writes onto the action.

test('reviewDraft catches "it is" in a parsed draft, quoting rule and text', () => {
  const tells = reviewDraft(
    draft("You're hiring four agents. Usually it is the queue that got there first. Is the volume seasonal?")
  );
  assert.deepEqual(tells, [{ rule: 'contractions, not written-out forms', found: 'it is' }]);
});

test('reviewDraft on a clean parsed draft is an empty list, not undefined', () => {
  assert.deepEqual(reviewDraft(draft(CLEAN_BODY)), []);
});

test('reviewDraft reads the subject as well as the body', () => {
  const tells = reviewDraft(draft(CLEAN_BODY, 'quick question about hiring'));
  assert.deepEqual(
    tells.map((t) => t.rule),
    ['banned opener']
  );
});

test('reviewDraft has nothing to say about an output that is not a draft', () => {
  for (const notADraft of [null, undefined, 'a string', 42, [], {}, { body: 7 }, { subject: 'x' }]) {
    assert.deepEqual(reviewDraft(notADraft), [], `reviewed ${JSON.stringify(notADraft)}`);
  }
});

test('reviewDraft ignores a subject that is not a string rather than choking on it', () => {
  const tells = reviewDraft({ subject: 12, body: CLEAN_BODY });
  assert.deepEqual(tells, []);
});
