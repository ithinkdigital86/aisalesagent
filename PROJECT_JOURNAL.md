# Cadence — Project Journal

What was inherited, what was found, what was fixed, and how. Written so that
someone picking this up cold can understand both the system and the reasoning
behind the changes.

**Repository:** `github.com/ithinkdigital86/aisalesagent` (working branch: `master`)
**Live:** `https://cadence-two-chi.vercel.app`
**Sending domain:** `send.ithinkdigital.co`

---

## 1. What the system is

Nine AI agents that run outbound sales, with a compliance gate at the centre.

| Agent | Job | Model |
|---|---|---|
| Sourcing scout | Finds prospects via Apollo | Haiku |
| Qualifier | Scores leads 0–100 against the ICP | Haiku |
| Sales manager | Daily pipeline review and instructions | Opus |
| Content creator | Writes the outreach angle and copy | Opus |
| Email specialist | Writes and sends email | Opus |
| LinkedIn specialist | Drafts only, human sends | Opus |
| Instagram specialist | Not active, needs Meta approval | — |
| Voice specialist | Not active, needs DLT registration | — |
| Follow-up manager | Decides the next step per lead | Haiku |

Cheap models do sorting; expensive models write and judge. That split keeps
the running cost low.

**The consent gate** (`lib/cadence/consent.ts`) is the single choke point every
outbound message passes through. It checks suppression, contactability,
platform rules, jurisdiction, and legal basis. Nothing can send around it.
This file was treated as untouchable throughout.

**Stack:** Next.js on Vercel, Supabase (Postgres + auth), Anthropic API,
Resend for email, Apollo for sourcing.

---

## 2. The state it was handed over in

The application was deployed but non-functional. Diagnosis found three
separate causes, each of which alone would have broken it:

1. **Environment variables existed by name but had no values.** The Supabase
   URL and key are compiled into the browser bundle at build time, so blank
   values produced `Failed to execute 'fetch' on 'Window': Invalid value` on
   every page.
2. **The deployed code was three weeks stale.** Production was building from
   an old branch, at a commit from before the dashboard existed. Hence the
   "blank pages."
3. **Two Vercel projects pointed at one repository**, doubling every build and
   making it ambiguous which URL was real.

The codebase itself was sound: clean architecture, type-safe, proper
row-level security. The decision was to keep and fix rather than rebuild.

---

## 3. Local environment

1. Node.js 20+, `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in every value
3. `npm run dev` → `localhost:3000`

`.env.local` is gitignored. `NEXT_PUBLIC_APP_URL` must be
`http://localhost:3000` locally and the Vercel URL in production — they are
deliberately different. Local and production share the same Supabase
database.

---

## 4. Bugs found and fixed

Each of these was found by testing, not by reading code. Most were invisible
from inside the application.

### 4.1 Every email draft was silently discarded

**Symptom:** all eight drafting calls returned HTTP 502 after 20+ seconds
each, costing money and producing nothing.

**Cause:** a Zod schema capped `opening_line_rationale` at 300 characters —
an internal explanation field never shown to anyone. The model wrote longer,
validation rejected the entire response, and a perfectly good email was
thrown away. The prompt never told the model the limit existed.

**Fix:** split every agent schema into *essential* fields (strictly
validated — the body, the score, the routing decisions) and *advisory*
metadata (coerced or truncated, never fatal). Added one corrective retry that
quotes the exact validation error back to the model. Model-shape failures now
return 422 rather than 502, and the UI names which leads failed and why
instead of silently counting successes.

### 4.2 The Sales Manager invented colleagues

**Symptom:** the daily review assigned work to `research_agent`,
`outreach_agent` and `analytics_agent`. None exist.

**Cause:** the prompt never listed the real agents.

**Fix:** the roster moved to `lib/cadence/roster.ts` (separate from the
registry to avoid a circular import), renders into the prompt, and
`target_agent` validates against it. If one instruction names an unknown
agent, that instruction is dropped and reported rather than failing the whole
review.

### 4.3 Every lead scored identically

**Symptom:** all leads scored 15/100 and parked, with reasoning that amounted
to "you haven't told me what you're looking for."

**Cause:** the `icp_profiles` table existed but had no interface, so no
profile was ever created.

**Fix:** built the ICP page (industry, role titles, size band, geography,
offer description), made one profile active per workspace, and wired the
qualifier and content creator to read it. The qualifier now refuses to run
without one rather than spending model calls to score blind.

**Follow-up fix:** the size band was being applied as a hard cliff, so a
95-employee company matching everything else was rejected. Size and industry
are now graded signals. Separately, the model was stating comparisons wrongly
("180 employees exceeds the 51–200 range"), so the comparison is now
calculated in code and handed to the model as a finished sentence.

### 4.4 The AI fabricated client references

**Symptom:** a test email contained "Recently I worked with a Bengaluru SaaS
team…" — a client that does not exist.

**Cause:** the prompt taught it. There was a worked example of exactly this
form, and the model produced its own version.

**Fix:** explicit prohibition on invented clients, results, statistics or
mutual connections. Social proof may only come from supplied context. Where
none exists, the model states an honest hypothesis instead.

### 4.5 Unsubscribe had never worked

**Symptom:** clicking the link redirected to a login page.

**Cause:** the auth middleware's public route list contained only `/login`
and `/auth`. A prospect has no session, so `/api/unsubscribe` was redirected.
Every unsubscribe link ever sent was dead.

**Fix:** added `/api/unsubscribe` to the public prefixes. It authenticates
callers itself via an HMAC-signed token. The same fix was applied
pre-emptively to the webhook route, which would have failed identically.

### 4.6 Link scanners were unsubscribing prospects

**Symptom:** the unsubscribe link suppressed the lead on page load.

**Cause:** corporate email security (Outlook Safe Links, Mimecast) visits
every URL in an incoming message to check it. Each scan silently opted the
prospect out.

**Fix:** GET now only verifies the token and renders a confirm page —
no database access at all. Suppression happens only on POST. Added
`List-Unsubscribe` and `List-Unsubscribe-Post` headers so Gmail and Outlook
render their own native unsubscribe control, which also helps deliverability.

### 4.7 Interested replies classified as opt-outs

**Symptom:** "sounds interesting, tell me more" was recorded as
`unsubscribe`, which suppresses the lead and revokes consent.

**Cause:** two bugs compounding. Quote stripping did not recognise Outlook's
format (underscore rule then a `From:` block), so the quoted original
survived — including our own "Unsubscribe: https://…" footer. The classifier
then matched that word.

**Fix:** extracted to `lib/cadence/reply.ts` with 14 tests. Handles Outlook's
separator (requiring a header block after the underscores, since a bare rule
is also how people draw a signature divider). Classification runs only on the
stripped text. Opt-out intent must now appear as a short standalone sentence
near the start of the reply. Deliberately errs narrow: a missed opt-out is
caught by the follow-up manager a tick later, while a false positive destroys
a live lead.

### 4.8 Secrets committed to git

`.env.local` was tracked in the repository, including the Supabase service
role key. Confirmed nothing had been pushed to a remote, rewrote history to
remove it, and added it to `.gitignore`. Only the Supabase *anon* key remains
in history, which is public by design.

---

## 5. Infrastructure set up

**Sending domain.** `send.ithinkdigital.co`, deliberately a subdomain rather
than the root: an MX record on the root would have routed all company email
to Resend and broken Outlook. It also isolates cold-outreach reputation from
normal business mail.

DNS records (GoDaddy). Note Resend's `send.` prefix convention, which is why
several records read `send.send`:

```
mx   send        inbound-smtp.ap-northeast-1.amazonaws.com   (0)   receiving
mx   send.send   feedback-smtp.ap-northeast-1.amazonses.com  (10)  sending
txt  send.send   v=spf1 include:amazonses.com ~all                 SPF
txt  resend._domainkey.send   p=MIG...                             DKIM
```

`mx @` points at Outlook and must never be touched — that is company email.

**Inbound webhook.** `/api/webhooks/resend`, verifying Svix signatures
(`svix-id`, `svix-timestamp`, `svix-signature`) with a 5-minute replay
window. Handles `email.received`, `email.delivered`, `email.bounced` and
`email.complained`. Idempotent by construction rather than by an event
ledger. Hard bounces and spam complaints suppress the lead; soft bounces
stay retryable.

**Automation.** Three daily crons, timed for IST mornings: sales manager
08:00, send queue 09:00, follow-ups 09:30. Daily schedules work on Vercel's
free plan; anything more frequent needs Pro, or an external scheduler calling
the same endpoints.

---

## 6. Working practices

- **Claude Code, one task per session**, `/clear` between them, effort on
  medium. Context carried between sessions is the main cost driver.
- **Verify by clicking, not by reading.** Every bug in section 4 was found by
  using the product, usually as a *recipient* rather than as an operator. A
  green build proves compilation, nothing more.
- **Commit after every verified session.** Never `git add -A` without
  checking `git status` first.
- **Guarded files:** `lib/cadence/consent.ts` and
  `supabase/migrations/0001_init.sql` are never modified. Schema changes go
  in new numbered migrations, which must then be run manually in Supabase.

---

## 7. Outstanding

**Business decisions:** the real ICP (currently a test fixture), approval for
a first pilot batch, and whether to buy Apollo.

**External approvals:** DLT registration for voice and SMS, Meta app review
for Instagram. Both are long lead times and should be started early.

**Technical:** clear test data before measuring real numbers; Supabase free
tier pauses after ~7 days of inactivity and will need a paid plan before
production; the learning loop needs roughly 200 sent messages before it has
anything to learn from.

---

## 8. Session log

Later work, one entry per session, newest last. Sections 1 to 7 describe the
system as it stood after the handover; these describe what changed since.

### 2026-09-14 Business profile autofill, second tier

**Problem.** The business profile form could be drafted from the company's
website, with every entry quote-checked against the page text. For a site
drawn by JavaScript the reader gets a shell with no text, returns `no_text`,
and the owner is left with an empty form. The same for a host that does not
answer.

**Change.** When the read fails with `no_text` or `unreachable`, the failure
panel offers a clearly separate action: *Suggest from the company name and
domain instead*. It is worded as a guess because it is one. A new agent,
`profile_guesser`, proposes the same fields from the company name, the
domain, and whatever one more look at the homepage recovers (title and meta
description, which a JS shell usually still carries in its head; fetched
server-side rather than replayed from the client). There is no quote to
check, so the reader's evidence rule does not apply, and what replaces it is
procedural:

- nothing from this path fills a field on its own; each guess has its own
  Accept button and shows the model's one-line reason for it;
- every field that takes a guess is marked `inferred`, shown as an amber
  *unverified guess* badge, and saved as such;
- the panel says in as many words that these are guesses from the name, not
  from the site, and asks the owner to correct them.

**Origins.** `business_profiles.field_origins` (migration 0007) records where
each draftable field's text came from: `manual`, `from_website` or
`inferred`. One jsonb map rather than seven columns, validated by a SQL
function so a bad key or value is refused at the row. A field with a guess in
it stays `inferred` even if a checked suggestion is added on top, because the
guess is still there; emptying the field clears it. Only `inferred` counts as
unverified: `from_website` was checked against a quote.

**Consumers.** The point of the origin is that a profile built on guesses
must not read as one built on research. `describeBusinessProfile()` tags a
guessed field on its own line (`Industries served [UNVERIFIED GUESS: …]:
Logistics`), the ICP strategist's prompt lists the unverified fields and is
told to treat them as hypotheses and call a recommendation resting on one
provisional, and the ICP page shows an amber notice naming them before a run
is spent. The generation snapshot carries the map with it.

**Decisions worth knowing.** The guess button is offered only for the two
failure kinds the brief named; `timeout` and `http_error` (a 403 from bot
protection is common) are one line away in `GUESSABLE_FAILURES` if wanted.
The guesser runs Opus at low effort with the reader's token cap, unmeasured
so far. Pricing model is not guessed; it stays manual.

**Verification.** `tsc`, `npm test` (170 passing, 13 new across four files)
and `npm run build`. Not yet clicked through against a live JS-only site;
that is the next thing to do, and the migration has to be run in Supabase
first.

### 2026-10-13 Sequences QA: hydration mismatch and stale lists

**Problem.** Browser QA of the sequences work found two things. The due date
in the leads table and on the sequences page was formatted with
`toLocaleDateString`, so the server rendered "16 Oct" and the browser "Oct 16"
and React threw *Hydration failed* on every load of either page with an
enrolled lead. Separately, saving a new sequence and putting a lead on one
both showed a success toast while the page kept the old rows until a manual
reload.

**Change.** One formatter, `formatDueDate()` in `lib/cadence/sequence.ts`,
used by both tables. It shows the day as it falls in a fixed named zone,
`DISPLAY_TIME_ZONE = 'Asia/Kolkata'`, so the server and the browser produce
the same text and it is the right local day for an Indian workspace. Intl
supplies only the numeric day, month and year in that zone; the month names
are a fixed list, because ICU versions disagree on some of them (en-GB is
"Sept" in newer data) and the server's Node and the browser's ICU need not
match. The zone is an option, so when a workspace's jurisdiction should
decide it, read it from `workspaces.jurisdictions` and pass it in.

**Stale lists: no code change.** Every sequences action already calls
`revalidatePath('/sequences')` and `revalidatePath('/leads')`, and both
components call `router.refresh()` after a successful write. Re-run in the
browser on the fixed tree, both reported paths (create a sequence; enrol a
lead from /leads) showed the new row without a reload, with the action
response carrying `x-action-revalidated` and a refresh request following it.
Accepted cause: the hydration mismatch was breaking the client tree, so the
revalidated payload was not reliably rendering. Not proved: in the same
session a `router.refresh()` did apply on a page that had just failed
hydration, and the create case was reported from zero sequences, where no
dated row is rendered and so no mismatch can happen. If it comes back, that
is where to look.

**Also learned.** Stopping `npm run dev` from a background task can leave the
Next server process running; a build then overwrites `.next` under it and a
second `npm run dev` comes up on 3001. Check port 3000 is free before
restarting.

**Verification.** `tsc`, `npm test` (187 passing; the formatter tests also
pass with `TZ=America/Los_Angeles`) and `npm run build`. Both pages reloaded
in the browser with no hydration error. The repro sequence and enrolment
made during QA were removed; the QA LinkedIn sequence and Neha Bhatt's
enrolment were left as they were.

### 2026-10-13 QA faults: suppression never written, duplicate sends, approvals past the gate

**Problem.** QA found three faults on the send path.

1. *Suppression never written.* The unique indexes on `suppression_list`
   were partial (`where email is not null`), and every writer upserts with
   `onConflict: 'workspace_id,email'` or `'workspace_id,phone'`. Postgres only
   uses a partial index as an ON CONFLICT arbiter when the statement repeats
   its predicate, which PostgREST cannot do, so every upsert failed with
   42P10. No caller checked the error: the unsubscribe route answered 200,
   the webhook acknowledged, and the address stayed sendable. The live table
   had zero rows.
2. *Duplicate sends.* The send-queue cron and the dashboard's "Process send
   queue" button select the same queued rows, and nothing marked a row as
   taken, so overlapping passes each sent it.
3. *Approvals bypassed consent* (fault 4 in the QA report). Approving a
   LinkedIn, Instagram or voice draft marked it sent with no gate, so a
   draft written before an unsubscribe was recorded as sent to a suppressed
   lead.

**Change.**

- Migration 0009 replaces the three partial unique indexes with plain ones
  under the same names. NULLs are distinct in a unique index, so rows with a
  null email or phone still coexist.
- `lib/cadence/suppression.ts`: `writeSuppression()` and
  `blockPendingActions()`, both throwing on a database error. All four call
  sites use them (unsubscribe route, `suppressLead` in the Resend webhook,
  `suppress` in the follow-up cron) and answer 500 so the caller retries;
  everything is idempotent. The unsubscribe error page now returns 500 too.
  The follow-up cron writes the suppression row before moving the stage,
  because a suppressed lead leaves its due list and would never be retried,
  and phone-only leads now upsert against the phone index.
- Migration 0010 adds `sending` to `action_status`.
  `deliverQueuedEmailAction` claims the row first, `queued` → `sending`,
  with an update that only matches a still-queued row; the loser returns
  `skipped` and sends nothing. `sendEmail` inserts its row as `sending`, and
  refuses to send without a row. The action id goes to Resend as
  `Idempotency-Key`.
- `lib/cadence/approvals.ts`: `approvalPatch()` runs `evaluateConsent` for
  non-email channels. A refusal blocks the draft and the route answers 409
  with the reason; a pass records `consent_basis`. Email still only queues,
  since the send path gates it.
- Suppressing a lead blocks its `awaiting_approval` and `queued` actions
  (`block_reason = 'lead_suppressed'`), leaving `sending` alone.

**Decisions worth knowing.** A row left in `sending` (process died between
claim and result) is never picked up again, deliberately: whether it went out
is unknown, and resending is the fault being fixed. Deploy only after 0010 is
applied, or every claim fails and nothing sends (rows stay queued, nothing is
lost). Still open: suppressing a lead whose phone is already on the list under
a different email raises 23505 on the phone index, which now returns 500 on
every retry instead of passing silently.

**Tests.** 16 new across `suppression.test.ts`, `adapters/email.test.ts` and
`approvals.test.ts`, on a shared fake PostgREST
(`lib/cadence/testing/fake-postgrest.ts`) whose upsert chooses its arbiter the
way Postgres does. The suppression test replays the real migration files, so
it shows the 42P10 at 0008 and passes at 0010. `email.ts` imports the consent
gate by relative path so `node --test` can load it. Each test was checked to
fail with its fix reverted.

**Verification.** `tsc`, `npm test` (203 passing) and `npm run build`. The
three QA cases were re-run against the live project after 0009 and 0010 were
applied, through the dev server, in a throwaway workspace with the lead at
Resend's sink `delivered@resend.dev`:

- Unsubscribe: one-click POST 200 twice, one `suppression_list` row, lead
  suppressed, consent revoked.
- Duplicate send: three concurrent `/api/queue/process` passes on one queued
  email sent it once (sent 0, 0, 1); Resend's list shows one email. Two posts
  with the same Idempotency-Key returned the same id.
- Approvals: the pre-opt-out LinkedIn draft was already blocked; a draft for
  the suppressed lead got 409 "Blocked by the consent gate: lead_suppressed";
  a clean lead's draft still approved with basis `none`.

The webhook and follow-up cron paths were not exercised live
(`RESEND_WEBHOOK_SECRET` is not set locally, and the cron calls the model);
the unit tests cover them. The cron route was avoided for the send test
because it delivers every workspace's queue. The throwaway user and workspace
were deleted afterwards and nothing was left behind.

### 2026-10-14 Automation safety: kill switch, daily send cap, minimum fit score

**Problem.** Sequences now run from the cron with nobody watching, and
nothing limited what an unattended pass could do: no way to stop all sending
at once, no ceiling on volume from a new sending domain, and any lead could
be drafted to or enrolled whatever its score, including leads never scored.

**Change.** Migration 0011 adds three workspace columns and one function.

- `sending_paused` (+ `sending_paused_at`, `sending_paused_by`), the kill
  switch. `daily_send_cap` (default 50), emails in a rolling 24 hours.
  `min_fit_score` (default 60, the qualifier's "this month" band).
- `claim_email_send(action_id)` replaces the bare update the adapter claimed
  rows with (0010). It locks the workspace row, refuses while paused, counts
  the window (`sent_at` in the last 24 hours, plus rows in `sending` claimed
  in it), refuses at the cap, and only then moves the row `queued` to
  `sending`. A refused row is left queued; nothing is failed or discarded.
  Execute is granted to the service role only.
- `adapters/email.ts`: both send paths claim through the function and return
  a new `deferred` result for the switch and the cap. `sendEmail` now inserts
  its row as `queued` and claims it, so a direct send obeys the limits too.
- `lib/cadence/send-queue.ts`: the delivery loop the cron and the dashboard
  button used to copy. Goes workspace by workspace, skipping paused and full
  ones, so one workspace's held rows cannot fill every batch.
- Sequence runner: reads the switch fresh for every lead (a pass with model
  calls runs for minutes), leaves paused workspaces out of its query, defers
  leads below the minimum by a day keeping their step, and keeps a per-pass
  email budget so it does not draft more email than the cap lets out today.
- Kill switch checks in the send-queue and follow-up crons, which draft or
  send, and in `/api/queue/process` (409 before any model call). The
  follow-up cron skips paused workspaces; suppression on unsubscribe, bounce
  and complaint still happens in the webhook and unsubscribe route, which do
  not check it. The sales-manager cron deliberately ignores the switch: it
  sends nothing, and its review is most useful while sending is paused.
- Minimum fit score in the email and LinkedIn draft routes (409, before the
  model call), in `enrolLeads` (named in the skipped list), and in the runner.
  `checkFit()` refuses an unscored lead at any minimum, including 0.
- Dashboard panel: the switch, sends in the last 24 hours against the cap,
  rows stuck in `sending` over an hour, and the two limits. A banner on the
  leads, approvals and sequences pages shows the state. Leads below the
  minimum have their score struck through.

**Decisions worth knowing.** A lead below the minimum is deferred, not
stopped: stopping would force a re-enrol, and re-enrolling restarts at step
one. Rows in `sending` count against the cap until they are 24 hours old,
because whether they went out is unknown. Approving a draft is not gated by
the switch; an approved email only queues, and the claim holds it. The
display zone is still the fixed `Asia/Kolkata` from `formatDueDate`.

**Deploy order.** 0011 is applied. Deploying this code without it would fail
every claim and send nothing (rows stay queued). The reverse is safe.

**Tests.** 16 new in `send-controls.test.ts`. The fake PostgREST gained
`rpc('claim_email_send')` (a copy of the SQL), ordering, range filters and
head counts. With the adapter change reverted, the six tests that depend on
the claim fail.

**Verification.** `tsc`, `npm test` (219 passing), `npm run build`. Live,
through the dev server, against a throwaway user and workspace with the lead
at `delivered@resend.dev`: 20 scripted checks, all passed. Paused: the
queue route answered 409, the claim answered `sending_paused`, the row stayed
queued and went on resume. Cap 3 with one sent: two went, two were held with
a retry time, a second pass sent nothing, and three concurrent passes with
one free slot sent exactly one. Fit: drafts refused for unscored and 40-of-60
leads with no `agent_runs` row written; leads put on a sequence directly were
deferred a day at step 0 with no draft. A signed-in user calling the claim
function got 42501. In the browser (on `qa.localhost`, to keep the owner's
`localhost` session apart): the panel, the switch through its server action,
the banners on all three pages, enrolment naming both refused leads, the
stuck-row count, no console errors. Not exercised live: the cron routes,
since they run across every workspace. The throwaway user and workspace were
deleted afterwards and nothing was left behind.

### 2026-10-14 Cron route tests, and an unset CRON_SECRET let anyone in

**Problem.** The three crons (sales-manager, send-queue, follow-up) run
unattended across every workspace and had no tests, and the last session
could not exercise them live for the same reason. Writing the tests turned
up a hole: every route compared the header against
`` `Bearer ${process.env.CRON_SECRET}` ``, so with the variable unset the
literal header `Bearer undefined` passed. Vercel's own calls send no header
in that state, so nothing showed it.

**Change.**

- `lib/cadence/cron-auth.ts`: `isCronRequest()`, used by all three routes.
  An unset or empty secret refuses every request.
- 37 tests in `app/api/cron/`: `auth.test.ts` for the secret on all three
  routes, and a `route.test.ts` beside each route. `npm test` now runs
  `app/**/*.test.ts` as well as `lib/`.
- `lib/cadence/testing/route-loader.ts`: a `module.registerHooks` resolver
  so node --test can load route files, which import through `@/` and without
  extensions, and can swap whole modules for doubles. `cron-doubles.ts`
  stands in for `lib/supabase/server` (returns the FakeDb) and
  `lib/cadence/runtime` (scripted model results). `cron-world.ts` builds
  workspaces, leads, sequences and queued email, and replaces fetch: Resend
  answers, any other host throws, so a test cannot reach Anthropic or OpenAI.
- Fake PostgREST: `or()` takes `is.null` and `not.is.null` terms (the
  follow-up query), and `faults` fails chosen statements, for testing what a
  caller does with one workspace's error.

Everything under the routes runs for real: the sequence runner, the send
queue, the consent gate, the email adapter and the fake's copy of
`claim_email_send`.

**Covered.** Secret: missing, wrong, no `Bearer`, unset, empty, and right; a
refused request touches no database, model or email. Kill switch: send queue
and follow-up leave paused workspaces alone and their leads keep their date,
the sales manager runs for them anyway, and an unreadable switch is a 500
with nothing done. Cap: delivery stops at it oldest first with the rest
queued and the right retry time, a full workspace does not pay for a draft,
one capped workspace does not hold up another. Fit: below-minimum and
unscored leads are not drafted to and are deferred a day at their step; a
lead at the minimum is drafted and sent on the same pass. Isolation: a
failed review, a thrown error, a failed model call, a failed suppression
write (the run still ends 500, after every lead), a failed Resend call and a
failed draft each stay in their own workspace.

**Decisions worth knowing.**

- The follow-up cron does not check the minimum fit score and was left that
  way: it drafts and sends nothing, it is where replies are read, and leads
  skipped while still due would fill its 100-lead batch. A test records it;
  that is the one to turn around if the decision changes.
- In the send queue, a failed read of one workspace's limits throws and
  fails the whole run, so other workspaces send nothing that tick. The
  route says this is deliberate (fail closed). Not tested either way.
- `@types/node` is pinned at 20, which predates `registerHooks`, so the
  loader declares the slice it uses rather than upgrading the package.

**Not done.** Unsubscribe tokens are signed with `CRON_SECRET ?? ''`, so with
the secret unset they are signed with an empty key and anyone can make one.
Same root cause, different file; left for its own change.

**Tests.** Each guard was disabled in turn to check its test fails: the
unset-secret check, the follow-up and sequence-pass kill switch, the fit
check, the cap, and the sales manager's per-workspace catch. The switch and
the cap are each enforced twice (the queue's look-ahead and the claim), so
those tests only fail with both removed, which is the design.

**Verification.** `tsc`, `npm test` (256 passing, three full runs; the
first run failed once on a millisecond race between two timestamps in one
test, which was fixed), `npm run lint`, `npm run build`. Nothing was run
against the live database or Resend.
