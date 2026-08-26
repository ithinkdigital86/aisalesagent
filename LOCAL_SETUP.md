# Running Cadence locally in VS Code

Follow these in order. Nothing here touches your live site, so you cannot
break anything.

## Step 0. Install the tools (one time only)

1. **Node.js**: download the LTS version (20 or newer) from
   https://nodejs.org and install it. To check it worked, open a terminal and
   run `node -v`. You should see a version number like v20.x or v22.x.
2. **VS Code**: https://code.visualstudio.com if you do not have it.

## Step 1. Open the project

1. Unzip `cadence-complete.zip` somewhere sensible, for example
   `Documents/cadence`.
2. In VS Code: File -> Open Folder -> pick that folder.
3. Open the built-in terminal: Terminal -> New Terminal. Every command below
   is typed there.

## Step 2. Install the project's packages

```bash
npm install
```

This downloads everything the project depends on. Takes a minute or two.
You only redo this if package.json changes.

## Step 3. Create your secrets file

The app needs keys to talk to Supabase, Anthropic, and Resend. They live in a
file called `.env.local` which stays on your machine and is never uploaded.

1. In the VS Code file explorer, right-click `.env.local.example` ->
   Copy, then Paste, then rename the copy to exactly `.env.local`
2. Open `.env.local` and fill in the values:

| Line | Where to get the value |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase dashboard -> Settings -> API -> Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Same page -> "anon public" key |
| SUPABASE_SERVICE_ROLE_KEY | Same page -> "service_role" key (keep this one secret) |
| ANTHROPIC_API_KEY | console.anthropic.com -> API Keys |
| APOLLO_API_KEY | apollo.io -> Settings -> Integrations -> API (optional, only for sourcing) |
| RESEND_API_KEY | resend.com -> API Keys (optional until you send real email) |
| EMAIL_FROM | an address on your Resend-verified domain (optional for now) |
| NEXT_PUBLIC_APP_URL | put exactly: http://localhost:3000 |
| CRON_SECRET | any long random text, for example run: `openssl rand -hex 32` |
| TWILIO_* and VAPI_API_KEY | leave blank (voice is not active) |

Rules for pasting: one line each, no quotes, no spaces around the `=`, no
trailing slash on URLs. A stray space here causes the exact
"Invalid value" fetch error you hit before on Vercel.

These are the SAME values you already put into Vercel, so you can also copy
them from Vercel -> Settings -> Environment Variables.

## Step 4. Start it

```bash
npm run dev
```

Wait until it says `Ready`, then open http://localhost:3000 in your browser.

- Log in with the same account you created on the live site. Local and live
  both talk to the SAME Supabase database, so your leads and drafts are the
  same in both places.
- To stop the app: click in the terminal and press Ctrl + C.
- Code changes reload automatically while it runs. No restart needed.

## What is different locally

- The three daily scheduled jobs do NOT run locally (they are a Vercel
  feature). Use the dashboard buttons instead: "Process send queue" and
  "Run Sales Manager".
- Unsubscribe links inside emails will point at localhost while
  NEXT_PUBLIC_APP_URL is localhost. Fine for testing, just do not send real
  emails to real people from your local machine.

## If something goes wrong

| You see | It means | Do this |
|---|---|---|
| 'next' is not recognized / command not found | Packages not installed | Run `npm install` first, and make sure the terminal is in the project folder |
| Failed to fetch / Invalid value in the browser | A NEXT_PUBLIC_ value is missing or has a stray space | Fix `.env.local`, then stop (Ctrl+C) and `npm run dev` again |
| Unauthorised on every page | Not logged in, or wrong Supabase keys | Check the two SUPABASE values match your project |
| Draft buttons fail | ANTHROPIC_API_KEY missing or out of credit | Check the key at console.anthropic.com |
| Emails marked failed with resend_4xx | Resend domain not verified yet | Expected until you verify a domain; everything else still works |
| Port 3000 already in use | An old dev server is still running | Close other terminals, or run `npm run dev -- -p 3001` |

Note: changing anything in `.env.local` requires stopping and restarting
`npm run dev`. The values are read once at startup.
