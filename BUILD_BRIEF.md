# Cadence: build brief for Claude Code

Paste the section below into Claude Code as your first message. Everything in
this repo is already written, so the brief tells Claude Code to read it before
adding anything.

---

## Paste this

I am building Cadence, a multi-agent AI sales system. The repo already contains
a working spine. Read these files before you write anything:

- `supabase/migrations/0001_init.sql` — the full schema. Do not redesign it.
- `lib/cadence/consent.ts` — the consent gate. Every outbound action goes
  through `evaluateConsent`. Never add a code path that sends without it.
- `lib/cadence/registry.ts` — agent definitions. New agents get an entry here
  plus a prompt file, nothing else.
- `lib/cadence/runtime.ts` — the single `runAgent` function. All agents use it.
- `lib/anthropic/prompts/*.ts` — each exports `buildPrompt` and `outputSchema`.
- `app/api/agents/qualifier/route.ts` — the pattern every agent route follows:
  auth, Zod parse, run agent, persist, typed response.

Stack, non-negotiable: Next.js 15 App Router, TypeScript strict, Tailwind plus
shadcn/ui, Supabase with RLS, Anthropic SDK, Zod on every route input.
Models: `claude-opus-5` for copy and judgement, `claude-haiku-4-5-20251001` for
classification and routing.

Rules for you:
- Server Components by default. Push `'use client'` to the leaf.
- No hardcoded or mock data anywhere. Seed via SQL if I ask for a demo.
- Every route: auth check, Zod parse, try/catch, `NextResponse.json`.
- No em dashes in any user-facing copy or generated content.
- Service role key never reaches a Client Component.

Work order. Finish one item, show me the diff, wait for my confirmation before
starting the next. Do not batch.

1. `npx create-next-app` scaffold around the existing `lib/` and `app/` folders,
   then install: `@supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod
   sonner`, plus shadcn/ui init.
2. Run the migration against my Supabase project. Generate `types/database.ts`
   with the Supabase CLI and replace the loose `Record<string, unknown>` types
   in `lib/cadence/` with the generated ones.
3. Auth: login page, `middleware.ts` for session refresh, workspace creation on
   first sign-in.
4. `app/api/sourcing/apollo/route.ts` wrapping `sourceFromApollo`, plus a UI
   form to define an ICP profile and trigger a run.
5. Leads table page: sortable by fit score, filter by stage, bulk select, one
   button to run the Qualifier on the selection.
6. `lib/cadence/adapters/email.ts` using Resend. It must call
   `evaluateConsent` first and write an `actions` row with the returned
   `consent_basis` before sending. Append an unsubscribe link that writes to
   `suppression_list`.
7. `app/api/agents/email-specialist/route.ts` — generates a draft, writes an
   `actions` row with status `queued`, does not send.
8. `app/api/cron/send-queue/route.ts` — picks up queued actions whose
   `scheduled_for` has passed, re-runs the consent gate, sends, updates status.
9. Approval queue page: every action with status `awaiting_approval`, showing
   the generated copy, with approve, edit, and reject. This is how LinkedIn and
   Instagram work, and how voice works until I turn off manual approval.
10. Dashboard: pipeline counts by stage, reply rate by channel, agent run cost
    from `agent_runs`, and today's Sales Manager output.

Start with item 1. Ask me before installing anything not on that list.

---

## What is deliberately not built yet

- **Voice adapter.** Blocked on DLT registration. The consent gate already
  refuses voice when `workspaces.dlt_registered` is false, so the code is safe
  to write early but pointless to test.
- **Instagram adapter.** Blocked on Meta app review. Draft-only until then.
- **LinkedIn adapter.** There is no compliant send API. It stays draft-only
  permanently. Do not let anyone talk you into a headless-browser workaround.
- **The learning loop.** Wire this after you have at least 200 sent actions
  with outcomes. Before that there is nothing to learn from, and
  `agent_memory` rows with a sample size under 20 are filtered out by the
  runtime anyway.

## Paperwork to start today, in parallel

These have lead times measured in weeks and will block you later.

1. DLT Principal Entity registration with any one telecom operator. Around
   Rs 5,900 for the first, free on the others, and it mirrors across all six.
2. A 140-series number for promotional voice, or 1600-series if you end up
   doing BFSI service calls.
3. Meta app review for Instagram Graph API messaging permissions. Needs a
   business account linked to a Facebook page.
4. A sending domain for email, separate from your main domain, with SPF, DKIM
   and DMARC. Warm it over two to three weeks before volume.
5. Apollo plan sized to your credit burn. The `enrichment_cache` table exists
   to keep this bill down, so make sure item 4 in the work order actually
   checks it.

## First test, before you build any UI

Once items 1 to 3 are done, run this and confirm the output looks sane:

```
POST /api/agents/qualifier
{ "workspaceId": "...", "leadIds": ["...", "..."] }
```

Feed it 20 leads where you already know which 5 are good. If the Qualifier does
not put those 5 at the top, fix the ICP filters and the rubric before you build
anything else. Everything downstream inherits this scoring, so a bad scorer
means a system that confidently wastes your outreach budget at scale.
