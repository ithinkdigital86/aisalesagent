# Cadence, explained simply

## What is this?

Cadence is an AI sales team in a box. Instead of you manually finding leads,
researching them, writing cold emails, and remembering to follow up, a team of
nine AI "employees" does it, and you supervise from a dashboard.

Think of it like hiring a small sales department:

| AI employee | What it does, in plain words |
|---|---|
| Sourcing scout | Finds new potential customers (leads) from Apollo, a lead database |
| Qualifier | Reads each lead and scores them 0 to 100: "is this person worth our time?" |
| Sales manager | The boss. Looks at the whole pipeline once a day and says what to focus on |
| Content creator | Writes the actual message copy |
| Email specialist | Writes and sends cold emails, fully automatic |
| LinkedIn specialist | Writes LinkedIn messages, but YOU press send (LinkedIn does not allow bots) |
| Instagram specialist | Replies inside existing Instagram conversations only (not built yet) |
| Voice specialist | Makes phone calls to people who asked to be called (not active yet) |
| Follow-up manager | Watches replies and decides what to do next with each lead |

The cheap, fast AI model (Haiku) does the simple sorting jobs. The smart,
expensive model (Opus) only writes copy and makes judgement calls. That keeps
your AI bill low.

## The one big idea: the consent gate

Every single outgoing message passes through one checkpoint in the code before
it can be sent. The checkpoint asks:

1. Did this person unsubscribe? Then never contact them again.
2. Do we even have their email address?
3. Does the platform allow automated sending? (LinkedIn and Instagram do not,
   so those are always drafted for a human.)
4. Do the laws of their country allow it? (In India, automated calls and SMS
   need DLT registration first.)
5. Do we have a legal basis to contact them? (Bought B2B data allows email
   only. Someone who enquired with you can also be called, for 90 days.)

If any check fails, the message is blocked and the reason is recorded. There
is no way around this checkpoint in the code, on purpose. This is what makes
the product safe to use and safe to sell: it cannot spam people.

So when you test with fake leads and see "blocked", that is not a bug. The
system is refusing to email people who never agreed to hear from you.

## What is working right now

- Sign up, log in, your own workspace is created automatically.
- Sourcing page: describe your ideal customer, pull leads from Apollo
  (needs an Apollo API key).
- Leads page: see all leads, filter by stage, sort by score, and three
  buttons: Run Qualifier (score them), Draft emails, Draft LinkedIn.
- Email flow: AI writes the email, it waits in a queue, and at send time the
  consent gate re-checks everything before it actually goes out via Resend
  (an email sending service). Every email carries a working unsubscribe link.
- LinkedIn flow: AI writes the message, it lands in the Approvals page, you
  read it, approve or edit or reject. Approved ones are marked "handed off"
  for you to copy into LinkedIn yourself.
- Approvals page: the human checkpoint for anything that needs your eyes.
- Dashboard: lead counts by stage, reply rate per channel, what the AI runs
  have cost you, the Sales Manager's daily advice, and two buttons to run
  things right now instead of waiting for the schedule.
- Automation: three jobs run by themselves once a day on the free hosting
  plan: the Sales Manager review (8:00 AM IST), sending due emails (9:00 AM),
  and follow-up decisions (9:30 AM).

## What is deliberately NOT working yet, and why

- **Voice calls.** Legally requires DLT registration in India (a telecom
  paperwork process). The code refuses to call until that is done.
- **Instagram.** Requires Meta to approve your app first. Weeks of lead time.
- **LinkedIn auto-send.** Will never happen. LinkedIn bans it. Draft-only is
  the permanent, correct behaviour.
- **The learning loop.** The system logs which messages get replies, but it
  only starts learning from that data after roughly 200 sent messages.
  Before that the sample is too small to trust.
- **Real email delivery** needs one setup step from you: verifying a sending
  domain in Resend. Until then, sends fail with an error rather than
  delivering.

## The words you will keep seeing

- **Lead**: a potential customer.
- **Stage**: where a lead is in the journey: sourced, qualified, contacted,
  engaged, meeting_booked, won, lost, suppressed.
- **Suppressed**: never contact again (they unsubscribed or asked to stop).
- **Action**: one outgoing message (an email, a LinkedIn DM, a call).
- **Queued**: written and waiting for its send time.
- **Awaiting approval**: waiting for a human to say yes.
- **Blocked**: the consent gate said no, and recorded why.
- **Workspace**: your account's own private area. Everything is scoped to it.

## What runs where

- **Supabase** is the database and the login system. All leads, messages,
  consent records and logs live there.
- **Vercel** hosts the website and runs the scheduled jobs.
- **Anthropic** is the AI that powers the nine agents.
- **Resend** actually delivers the emails.
- **Apollo** is where new leads come from.

Each of these has one key or password, and they all live in one file locally
(`.env.local`) or in Vercel's settings when hosted.
