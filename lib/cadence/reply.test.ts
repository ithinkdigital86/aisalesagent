// lib/cadence/reply.test.ts
//
// Run with `npm test`. Node runs these directly — the module under test is
// deliberately free of Next and Supabase imports so no bundler is involved.
//
// Both cases that reached production are pinned here: the Outlook reply whose
// quote survived stripping, and the interested lead that was classified as an
// unsubscribe because our own footer was quoted underneath it.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyReply, splitQuotedReply } from './reply.ts';

/** The footer lib/cadence/adapters/email.ts appends to every outbound email. */
const FOOTER = 'Unsubscribe: https://cadence.example.com/api/unsubscribe?token=abc.def';

// ---------------------------------------------------------------
// Quote stripping
// ---------------------------------------------------------------

test('strips an Outlook quote: underscore rule then a From:/Sent: header block', () => {
  const { reply, quoted } = splitQuotedReply(
    [
      'Sounds interesting, tell me more.',
      '',
      'Priya',
      '',
      '________________________________',
      'From: Sam Rivers <sam@cadence.example.com>',
      'Sent: Monday, 24 August 2026 09:14',
      'To: Priya Nair <priya@acme.example>',
      'Subject: Quick question about your onboarding',
      '',
      'Hi Priya — noticed Acme is hiring across support.',
      '',
      FOOTER,
    ].join('\r\n')
  );

  assert.equal(reply, 'Sounds interesting, tell me more.\r\n\r\nPriya');
  assert.ok(quoted.startsWith('________'));
  assert.ok(quoted.includes(FOOTER));
});

test('strips an Outlook quote with a blank line between the rule and the headers', () => {
  const { reply } = splitQuotedReply(
    'No problem, Friday works.\n\n____________________________\n\nFrom: Sam Rivers\nSubject: Times\n\nbody\n'
  );

  assert.equal(reply, 'No problem, Friday works.');
});

test('keeps a rule of underscores that is only a signature divider', () => {
  const text = 'Happy to chat.\n\n____________________\nPriya Nair, Acme';

  assert.equal(splitQuotedReply(text).reply, text);
});

test('strips the "On <date>, <name> wrote:" attribution', () => {
  const { reply } = splitQuotedReply(
    'Yes please.\n\nOn Mon, 24 Aug 2026 at 09:14, Sam Rivers <sam@cadence.example.com> wrote:\n> Hi Priya\n'
  );

  assert.equal(reply, 'Yes please.');
});

test('strips an attribution that wraps onto a second line', () => {
  const { reply } = splitQuotedReply(
    'Yes please.\n\nOn Mon, 24 Aug 2026 at 09:14, Sam Rivers\n<sam@cadence.example.com> wrote:\n\nHi Priya\n'
  );

  assert.equal(reply, 'Yes please.');
});

test('cuts at the earliest marker when a client emits more than one', () => {
  const { reply } = splitQuotedReply(
    'Interested.\n\n-----Original Message-----\nFrom: Sam\n\n________________________________\nFrom: Sam\n'
  );

  assert.equal(reply, 'Interested.');
});

test('keeps the whole message when stripping would empty it', () => {
  const text = '> Hi Priya — noticed Acme is hiring across support.';

  assert.equal(splitQuotedReply(text).reply, text);
});

// ---------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------

test('a positive reply quoting our unsubscribe footer stays positive', () => {
  const inbound = [
    'Sounds interesting, tell me more.',
    '',
    '________________________________',
    'From: Sam Rivers <sam@cadence.example.com>',
    'Sent: Monday, 24 August 2026 09:14',
    'Subject: Quick question about your onboarding',
    '',
    'Hi Priya — noticed Acme is hiring across support.',
    '',
    FOOTER,
  ].join('\r\n');

  const { reply, quoted } = splitQuotedReply(inbound);

  assert.ok(!reply.toLowerCase().includes('unsubscribe'));
  assert.ok(quoted.includes(FOOTER));
  assert.equal(classifyReply(reply), 'positive');
});

test('our footer alone is never read as the recipient asking to opt out', () => {
  assert.equal(classifyReply(`Sounds good, what times suit you?\n\n${FOOTER}`), 'positive');
});

test('a standalone opt-out at the top of the reply suppresses', () => {
  assert.equal(classifyReply('Unsubscribe'), 'unsubscribe');
  assert.equal(classifyReply('Please take me off your list.'), 'unsubscribe');
  assert.equal(
    classifyReply('Hi Sam,\n\nPlease remove me from this list. Thanks.\n\nPriya'),
    'unsubscribe'
  );
  assert.equal(
    classifyReply("Thanks for reaching out, but please stop emailing me — we're sorted."),
    'unsubscribe'
  );
});

test('an opt-out past the window is not a suppression', () => {
  const reply = [
    'Thanks for the note. We rebuilt onboarding last quarter and the support team is',
    'finally caught up, so the timing is awkward for anything new right now.',
    '',
    'I am also reviewing every vendor email we get, since the volume has been a lot',
    'lately and most of it is not relevant to what my team is actually working on.',
    '',
    'None of that is a comment on your note, which was perfectly readable, just',
    'on the sheer volume of the things and how little of it ever lands anywhere.',
    '',
    'Long term I should probably unsubscribe from most of them.',
  ].join('\n');

  const buried = 'Long term I should probably unsubscribe from most of them.';
  assert.ok(reply.indexOf(buried) > 400, 'fixture must start the paragraph past the window');
  assert.notEqual(classifyReply(reply), 'unsubscribe');
});

test('a hard-wrapped sentence is judged whole, not line by line', () => {
  // Outlook wraps at ~76 columns, so the mention lands on a short line even
  // though the sentence carrying it is far too long to be an instruction.
  const reply = [
    'Happy to take a look at this, and thanks for being brief about it, because the',
    'usual approach from vendors is to make me hunt for the unsubscribe link at the',
    'bottom rather than say anything useful up top.',
  ].join('\n');

  assert.equal(classifyReply(reply), 'positive');
});

test('a passing mention inside a long sentence is not an instruction', () => {
  const reply =
    'Genuinely interested in this, though I should say our procurement team makes me ' +
    'unsubscribe from anything that starts sending weekly, so keep it light.';

  assert.equal(classifyReply(reply), 'positive');
});

test('the other classes are unchanged', () => {
  assert.equal(classifyReply('Not interested, thanks.'), 'negative');
  assert.equal(classifyReply('What does the pricing look like?'), 'objection');
  assert.equal(classifyReply('Sounds good, happy to chat.'), 'positive');
  assert.equal(classifyReply('Got it.'), 'neutral');
});
