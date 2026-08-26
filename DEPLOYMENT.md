# Deploying Cadence

This guide assumes the Supabase project and Vercel project already exist (they
do, from the earlier sessions). If you are starting fresh, do the "First-time
setup" section at the bottom first.

## 1. Push this code to GitHub

From the project folder:

```bash
git init                            # skip if already a repo
git remote add origin https://github.com/ithinkdigital86/aisalesagent.git
git add -A
git commit -m "Enable daily crons, add sales-manager cron, add LinkedIn drafter"
git push origin main                # or your working branch
```

If Vercel is connected to the repo, the push triggers a deployment
automatically. Watch the Deployments tab go green, then hard-refresh the site.

## 2. Environment variables on Vercel

Settings -> Environment Variables. All of these must exist and be ticked for
Production:

| Variable | Where it comes from |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase -> Settings -> API |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase -> Settings -> API |
| SUPABASE_SERVICE_ROLE_KEY | Supabase -> Settings -> API (keep secret) |
| ANTHROPIC_API_KEY | console.anthropic.com |
| RESEND_API_KEY | resend.com -> API Keys |
| EMAIL_FROM | An address on your verified Resend domain |
| NEXT_PUBLIC_APP_URL | Your production URL, no trailing slash |
| CRON_SECRET | Generate one: `openssl rand -hex 32` |
| APOLLO_API_KEY | apollo.io, only needed for sourcing |

Remember: the two NEXT_PUBLIC values are baked in at build time. If you change
them, redeploy with "Use existing Build Cache" unchecked.

## 3. Crons (the automation)

`vercel.json` now registers three daily crons, which the free Hobby plan
allows:

| Route | UTC | IST | Job |
|---|---|---|---|
| /api/cron/sales-manager | 02:30 | 08:00 | Daily pipeline review for every workspace |
| /api/cron/send-queue | 03:30 | 09:00 | Sends due queued emails through the consent gate |
| /api/cron/follow-up | 04:00 | 09:30 | Decides the next action for every due lead |

Vercel sends `Authorization: Bearer <CRON_SECRET>` on each invocation, and the
routes reject anything else, so set CRON_SECRET before relying on them.

Hobby-plan caveat: each cron fires once a day, some time within the scheduled
hour. The dashboard buttons still work any time you want to run things now.

### Want the queue drained every 15 minutes without Vercel Pro?

The cron routes are ordinary HTTP endpoints, so any external scheduler can
call them more often. Free option:

1. Sign up at cron-job.org (or any scheduler that supports custom headers).
2. Create a job hitting `https://YOUR-APP.vercel.app/api/cron/send-queue`
   every 15 minutes.
3. Add a request header: `Authorization: Bearer <your CRON_SECRET>`.
4. Repeat for `/api/cron/follow-up` at every 6 hours if you want.

On Vercel Pro, instead edit the schedules in `vercel.json` to
`*/15 * * * *` and `0 */6 * * *` and push.

## 4. Supabase checklist (already done once, verify after any reset)

- Authentication -> URL Configuration: Site URL is your Vercel URL, and
  `https://YOUR-APP.vercel.app/**` is in Redirect URLs.
- Authentication -> Providers -> Email: "Confirm email" is off.
- The migration `supabase/migrations/0001_init.sql` has been applied
  (`supabase db push`, or paste it into the SQL Editor once).

## 5. Real email delivery

Resend only delivers from a verified domain. In Resend -> Domains, add your
sending domain, create the DNS records it shows (SPF, DKIM), wait for
verification, then set EMAIL_FROM to an address on that domain. Until then,
sends will fail with a resend_4xx error, which shows up as `failed` actions
with the reason stored in `block_reason`.

## 6. Smoke test the whole loop

1. Sign in. Dashboard loads with tiles and nav.
2. Leads -> select a few -> Run Qualifier -> scores appear.
3. Same selection -> Draft emails -> toast confirms queued drafts.
4. Dashboard -> Process send queue. Seeded leads without consent records are
   reported blocked. That is the consent gate working, not a bug. To make a
   seeded lead sendable, give it a consent basis (SQL in the README) or
   source leads through Apollo, which grants a legitimate B2B email basis.
5. Leads -> select -> Draft LinkedIn -> Approvals page now has items. Approve
   one: it is marked handed off for you to send from your own LinkedIn.
6. Dashboard -> Run Sales Manager -> the review card fills in. From tomorrow
   the 08:00 IST cron does this for you.

## First-time setup (only if rebuilding from nothing)

1. Create a Supabase project. Run `supabase/migrations/0001_init.sql`.
2. Create a Vercel project from the GitHub repo. Framework preset: Next.js.
3. Add every environment variable from section 2, then deploy.
4. Do section 4, then section 5.
