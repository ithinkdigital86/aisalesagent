# Cadence

A multi-agent AI sales team. Nine agents share one database brain, coordinate
through a Sales Manager, and route every outbound action through a consent gate.

## How it works

Leads enter from four sourcing lanes, get scored, get assigned a sequence, and
get worked across channels. Every send passes `evaluateConsent` first. Outcomes
feed back into `agent_memory`, which sharpens the next run.

```
sourcing -> enrich/dedupe -> qualifier -> sales manager
         -> channel agents -> follow-up manager -> shared brain
```

## The agents

| Agent | Model | Job |
|---|---|---|
| Sourcing scout | Haiku | Pulls and triages new leads |
| Qualifier | Haiku | Scores 0-100 against the ICP, rejects hard |
| Sales manager | Opus | Daily review, finds the bottleneck, issues instructions |
| Content creator | Opus | Writes the copy, learns which openers land |
| Email specialist | Opus | Owns the email channel, fully automated |
| LinkedIn specialist | Opus | Drafts only, a human sends |
| Instagram specialist | Opus | Replies inside existing conversations only |
| Voice specialist | Opus | Consented calls only, gated on DLT registration |
| Follow-up manager | Haiku | Reads replies, decides the single next action |

## The consent gate is the whole design

`lib/cadence/consent.ts` is the only place that decides whether something can
be sent. It checks, in order: suppression list, identifier presence, platform
terms, jurisdiction rules, DLT registration, then live consent records ranked
by strength.

Consequences worth knowing:

- Licensed B2B data grants an **email** basis only. It never unlocks voice or SMS.
- An inbound enquiry grants a 90 day implied-consent window, which is what makes
  the voice agent legal. This is the highest-value write in the system.
- LinkedIn and Instagram are `HUMAN_SEND_ONLY`. No consent record unlocks them,
  because the constraint is platform terms rather than consent.
- In India, voice and SMS return `dlt_not_registered` until the workspace is
  registered.

Do not add a bypass. The gate is what makes this sellable to clients as a
compliance asset instead of a liability.

## Setup

```bash
cp .env.local.example .env.local   # fill it in
supabase db push                   # runs 0001_init.sql
npm install
npm run dev
```

Then follow `BUILD_BRIEF.md`.

## Cost control

- `enrichment_cache` prevents paying twice for the same contact.
- The dedupe unique index means the same person cannot enter twice.
- `agent_runs` logs tokens per invocation, so cost per booked meeting is a
  query, not a guess.
- Haiku handles classification and routing, Opus only handles copy and
  judgement. Swapping the Qualifier to Opus roughly triples your per-lead cost
  for no measurable gain.
