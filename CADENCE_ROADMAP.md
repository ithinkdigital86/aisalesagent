# Cadence Roadmap: Validation, Replies, Deliverability, Security

Created 14 Oct 2026. Working document. Update status as items close.

---

## The goal

Cadence currently sources, scores, drafts and sends. It does not yet know
whether any of that works, and it drops the lead at the moment one replies.

This roadmap closes that. In order:

1. Prove the system produces replies before building more on top of it
2. Handle replies, which is where deals are actually won
3. Protect the sending domain, which cannot be replaced quickly
4. Learn from what works
5. Route positive replies to a booked call

Security runs through all of it and has its own section at the end.

**Non-goal: full automation of sending.** The human approval gate stays
until several hundred messages have landed well. Everything around the
send is automated: sourcing, scoring, drafting, scheduling, reply
classification, follow-up decisions. The send button stays human for now,
then loosens per sequence, never globally.

---

## Working practice

Unchanged from the existing project rules:

- One task per Claude Code session, `/clear` between
- `npm run check` before each session
- Any new migration runs manually in the Supabase SQL editor first, in
  project `zrehiuirumqbesaawqee` (AI SALES AGENT), verified before the
  code that needs it is pushed
- Guarded files untouched: `lib/cadence/consent.ts`,
  `supabase/migrations/0001_init.sql`
- `tsc`, `npm test`, lint and `npm run build` all pass before any commit
- Journal entry per change in `PROJECT_JOURNAL.md`
- Each session ends with a verification step: a test that fails when the
  protection it covers is switched off

---

## Phase 0: Validation (do this first, blocks everything else)

Nothing below is worth building until this returns a number.

**Blocked on:** the real ICP from the team. Chase daily. Without it, the
qualifier scores against a test fixture and the results mean nothing.

Also needed before starting:
- OpenAI credit topped up
- `RESEND_WEBHOOK_SECRET` in `.env.local`

### What to do

Send 50 real emails to real prospects matching the real ICP. Watch every
one through the approval queue. Measure:

| Metric | Where from | Target |
|---|---|---|
| Delivery rate | Resend | above 98% |
| Bounce rate | Resend, webhook | below 2% |
| Complaint rate | Resend, webhook | below 0.1% |
| Reply rate, any | inbound webhook | 3% or better |
| Reply rate, positive | sentiment classifier | 1% or better |

### The decision

- **Positive replies at 2 to 5 percent:** the system works. Build the rest.
- **Below 1 percent:** the problem is targeting or copy, not automation.
  Stop building features and fix the ICP and the content-creator prompt.
  No amount of engineering fixes a bad list.

Record the result at the top of this file before moving on.

---

## Phase 1: Reply handling (the biggest gap)

Replies are captured, quote-stripped and classified. Nothing drafts a
response. A positive reply currently sits in a queue until noticed.

### Build

A reply-handler agent that, for each classified inbound reply:

- Drafts a response appropriate to the sentiment
- Positive: acknowledge, answer the question asked, propose a call
- Question: answer from the business profile, do not invent capability
- Objection: one honest reply, no pressure, no second attempt
- Negative or unsubscribe intent: no draft, suppress, stop the sequence
- Out of office: reschedule the sequence past the return date, no draft
- Places the draft in the approvals queue, never sends unattended
- Stops the sequence on any reply, which already happens, but records
  which reply stopped it

### Constraints

- Reply drafts go through the consent gate like every other outbound
- A reply draft is subject to the daily cap and kill switch
- Never draft a second reply to the same thread without a human in between
- The business profile is the only source of claims about the agency. If
  the answer is not in it, the draft says so and flags for a human.

### Test

- Each sentiment produces the right outcome, including the two that
  produce no draft
- A suppressed lead's reply never produces a draft
- Out of office reschedules rather than replying
- A thread with an unanswered draft does not get a second one
- Kill switch and cap apply to reply drafts

### Session prompt

```
Build a reply-handler agent. Replies are already captured, quote-stripped
and sentiment-classified in lib/cadence/reply.ts. Nothing drafts a
response, so positive replies sit unanswered.

For each classified inbound reply, draft a response into the approvals
queue. Never send unattended.

Sentiment handling:
- positive: acknowledge, answer what was asked, propose a call
- question: answer from the business profile only, never invent capability
- objection: one honest reply, no pressure, no follow-up attempt
- negative or unsubscribe intent: no draft, suppress, stop the sequence
- out of office: reschedule the sequence past the return date, no draft

Constraints: reply drafts pass through the consent gate, the daily cap and
the kill switch like any other outbound. Never draft a second reply to a
thread that already has an unapproved draft. If an answer is not in the
business profile, say so in the draft and flag it rather than guessing.

Record which reply stopped the sequence.

Add tests. Run tsc, npm test, lint and build. Work on master, do not commit.
```

---

## Phase 2: Deliverability monitoring (protects what cannot be replaced)

One sending domain. A bad run burns it and warming a replacement takes
weeks. The kill switch exists for this; it needs something watching.

### Build

A monitoring panel and an automatic pause:

- Rolling bounce rate, complaint rate and delivery rate per workspace
- The same figures broken down by recipient domain, so a problem with one
  mailbox provider is visible before it spreads
- Automatic kill switch activation when, over the last 100 sends:
  - complaint rate crosses 0.1 percent, or
  - hard bounce rate crosses 3 percent
- The auto-pause records why it fired and who or what resumed it
- The dashboard shows the figures and the threshold distance

### Constraints

- An auto-pause is not silently reversible. Resuming is a human action and
  is logged.
- The thresholds are workspace settings with the above as defaults, not
  hardcoded.
- A pause must never lose queued mail. Rows stay queued, as the existing
  cap behaviour already does.

### Test

- Crossing each threshold pauses, staying under does not
- The pause reason is recorded and visible
- Queued mail survives a pause and sends on resume
- Per-domain breakdown is correct with mixed recipients
- An auto-pause cannot be cleared by anything other than an explicit resume

### Session prompt

```
Build deliverability monitoring with an automatic kill switch.

Track rolling bounce rate, complaint rate and delivery rate per workspace,
and the same figures broken down by recipient domain so a problem with one
mailbox provider shows before it spreads. Bounces and complaints already
arrive through the Resend webhook.

Automatically activate the kill switch when, over the last 100 sends,
complaint rate crosses 0.1% or hard bounce rate crosses 3%. Make both
thresholds workspace settings with those defaults.

An auto-pause records why it fired. Resuming is an explicit human action
and is logged. Queued mail is never lost, it stays queued as the cap
behaviour already does.

Show the figures and distance to threshold on the dashboard.

Say whether a migration is needed and what the deploy order is.
Add tests. Run tsc, npm test, lint and build. Work on master, do not commit.
```

---

## Phase 3: A/B testing on subject lines and openers

The learning loop needs roughly 200 sent messages. Random sends take
months to produce signal. Structured variants produce it immediately.

### Build

- Two or three variants per sequence step, assigned per lead at draft time
- Variant recorded on the action row
- Reporting: open rate, reply rate and positive reply rate per variant
- A clear statement of when a result is meaningful, so a 12-send sample
  does not get treated as a finding

### Constraints

- Assignment is deterministic per lead, so a lead does not get a different
  voice between step one and step two
- Variants change subject line and opener only, not the offer or the claims
- No variant bypasses the anti-AI-tell detector

### Test

- Assignment is stable across a lead's whole sequence
- Reporting counts the right sends against the right variant
- A variant with too small a sample is labelled as such

---

## Phase 4: Booking routing

A positive reply should reach a booking link, not a queue.

### Build

- Detect booking intent in replies, which is narrower than positive
  sentiment: a request for a time, a call, a demo
- Include the booking link in the drafted reply
- Mark the lead booked when a booking is confirmed, stopping all sequences
- Dashboard count of replies that reached booking

### Constraints

- The booking link is a workspace setting, not hardcoded
- A booked lead is never re-enrolled automatically
- Booking detection failing should fall back to a normal positive reply
  draft, never to silence

---

## Security

Reviewed every phase, not once at the end. Current state and what remains.

### Already closed

- Cron routes refuse every request when `CRON_SECRET` is unset or empty.
  Previously `Bearer undefined` passed.
- Unsubscribe links signed with a dedicated `UNSUBSCRIBE_SECRET`, no
  fallback to an empty key, refuses to sign or verify when unset.
- Duplicate sends prevented by row claiming plus Resend idempotency keys.
- Approvals pass through the consent gate for every channel.
- Suppression writes throw rather than failing silently.

### Open, in priority order

**1. Required env vars not verified at startup.**
An unset `UNSUBSCRIBE_SECRET` in production breaks every unsubscribe while
sends keep working. That is the exact failure that produces spam
complaints. Add every required variable to the `npm run check` preflight,
and fail the build rather than warn.

**2. Resend webhook signature verification.**
`RESEND_WEBHOOK_SECRET` is missing locally, so the webhook path has never
been tested with verification on. Confirm the production route rejects an
unsigned or wrongly signed payload. An unverified webhook lets anyone
forge a bounce or a complaint, and complaints trigger suppression.

**3. Rate limiting on public endpoints.**
`/api/unsubscribe` and the webhook route are publicly reachable. Neither
is rate limited. Add limiting per IP, and make sure an unsubscribe attempt
that is rate limited still returns something a mail client retries rather
than a hard failure.

**4. Row level security on Supabase tables.**
Confirm RLS is on for every table and that the anon key cannot read leads,
actions or workspaces. The service role key bypasses RLS by design, so the
check is what the anon key can reach.

**5. Service role key exposure.**
Confirm `SUPABASE_SERVICE_ROLE_KEY` is server-side only and never reaches
a client bundle. One accidental `NEXT_PUBLIC_` prefix exposes the whole
database.

**6. PII in logs.**
Lead emails, names and reply bodies should not land in logs that persist.
Audit what is logged on the send path, the webhook and the reply handler.

**7. Secret rotation plan.**
`UNSUBSCRIBE_SECRET` cannot be rotated once real links are in inboxes
without breaking them. Decide now: either accept it is permanent, or build
dual-key verification before real sending starts. Permanent is acceptable
if written down.

### Session prompt for the security pass

```
Security pass. Work through these in order, fixing as you go.

1. Add every required env var to the npm run check preflight, including
   UNSUBSCRIBE_SECRET, RESEND_WEBHOOK_SECRET and CRON_SECRET. Fail rather
   than warn when one is missing.
2. Confirm the Resend webhook route verifies the signature and rejects an
   unsigned or wrongly signed payload. An unverified webhook lets anyone
   forge a complaint, which triggers suppression. Test it.
3. Add rate limiting per IP to /api/unsubscribe and the webhook route. A
   rate limited unsubscribe must still return something a mail client
   retries, not a hard failure.
4. Check row level security is on for every table and that the anon key
   cannot read leads, actions or workspaces. Report what you find, fix
   what is missing.
5. Confirm SUPABASE_SERVICE_ROLE_KEY is server-side only and cannot reach
   a client bundle.
6. Audit what is logged on the send path, the webhook and the reply
   handler. Lead emails, names and reply bodies should not persist in logs.

Report findings before fixing anything that needs a decision.
Add tests. Run tsc, npm test, lint and build. Work on master, do not commit.
```

---

## Deferred, with reasons

| Item | Why deferred |
|---|---|
| SMS and voice | DLT registration, external timeline |
| Instagram | Meta app review, external timeline |
| LinkedIn and Instagram engagement automation | Against platform terms. Accounts get restricted or banned. Drafting for human posting stays the approach. |
| Learning loop | Needs roughly 200 sent messages. Phase 3 produces the signal faster. |
| Multi-workspace for clients | Product decision, not a deadline item |
| Apollo sourcing | Replaced by Clay. Needs a Clay Public API key from Settings, Account, API keys (beta). The legacy workspace key does not work. |

---

## Outstanding QA faults

Lower priority than the phases above, but not forgotten. Batch them into
two sessions once Phase 1 is done.

- Fault 3: re-enrolling a completed lead restarts all four steps. Policy
  decision needed before code.
- Fault 5: `/icp` hydration mismatch on `toLocaleString`
- Fault 7: successful queue send does not advance lead from sourced to
  contacted
- Fault 8: unsubscribing does not set `sequence_stopped_reason`
- Fault 9: sequence runner checks email suppression only, not domain or
  phone
- Fault 10: `sent_count` lags by one
- Fault 11: stop reason is the raw suppression reason, not normalised
- Fault 12: website reader misclassifies server-rendered sites using
  header-only content
- Fault 13: unterminated CSV quote swallows the rest of the file silently
- Fault 14: blocked actions leave `consent_basis` null

Also open, found during the cap work:

- Send-queue read error aborts the whole run. One workspace's failed
  limits read stops every other workspace sending.
- Low-fit leads held on a sequence indefinitely could fill the follow-up
  cron's 100-lead batch. Fix is ordering or ageing the batch, not
  filtering by fit, because filtering would stop replies from those leads
  reaching the follow-up manager.

---

## Status

| Phase | Status | Blocked on |
|---|---|---|
| 0: Validation | Not started | Real ICP from the team |
| 1: Reply handling | Not started | Phase 0 result |
| 2: Deliverability | Not started | Phase 1 |
| 3: A/B testing | Not started | Phase 2 |
| 4: Booking | Not started | Phase 1 |
| Security pass | Not started | Can run in parallel, start any time |
