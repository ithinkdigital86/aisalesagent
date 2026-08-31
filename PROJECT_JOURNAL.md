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
