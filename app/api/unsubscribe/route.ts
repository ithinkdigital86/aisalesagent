// app/api/unsubscribe/route.ts
//
// Target of the unsubscribe link in outbound email. Verifies the signed token,
// then writes suppression_list and revokes consent for the matching leads. The
// visitor has no session, so this runs under the service role.
//
// Only POST suppresses. GET verifies the token and renders a confirm button,
// touching no data at all, because anything that follows a link in an inbox is
// not necessarily the recipient: scanners, safe-link rewriters and prefetchers
// all issue GETs, and a GET that suppressed on load would unsubscribe leads
// nobody meant to unsubscribe.
//
// POST has two callers and serves both from one handler. The confirm page
// submits a form carrying confirm=yes and gets the styled result page back.
// Mail clients POST the RFC 8058 one-click body named by the
// List-Unsubscribe-Post header the adapter sets, and get a bare status. Both
// suppress immediately: RFC 8058 forbids asking a one-click caller to confirm,
// and the confirm page is itself the confirmation for the browser caller.

import { verifyUnsubscribeToken } from '@/lib/cadence/adapters/email';
import { supabaseService } from '@/lib/supabase/server';

type Outcome =
  | { state: 'confirm'; email: string }
  | { state: 'unsubscribed'; email: string }
  | { state: 'invalid_token' }
  | { state: 'error' };

/** What POST can answer with. Confirming is a GET-only state. */
type Settled = Exclude<Outcome, { state: 'confirm' }>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The brand theme, mirrored from app/globals.css.
 *
 * This page is a route handler returning a raw string, so it gets no Tailwind
 * and no next/font. The tokens are therefore copied rather than imported, and
 * a change to the palette in globals.css has to be repeated here. Every value
 * is written twice, hex first and oklch second, so a browser too old for oklch
 * falls back to the same colour instead of dropping the declaration.
 *
 * The app renders light only (nothing ever sets the .dark class), so this does
 * too. Fonts are system stacks: next/font self-hosts under hashed paths this
 * page cannot reference, and hotlinking Google Fonts would leak the recipient's
 * IP to a third party on the one page that exists to respect their privacy.
 */
const STYLES = `
  :root {
    --background: #ffffff;
    --background: oklch(1 0 0);
    --foreground: #0a0a0a;
    --foreground: oklch(0.145 0 0);
    --muted: #f5f5f5;
    --muted: oklch(0.97 0 0);
    --muted-foreground: #737373;
    --muted-foreground: oklch(0.556 0 0);
    --border: #e5e5e5;
    --border: oklch(0.922 0 0);
    --primary: #f6c92d;
    --primary: oklch(0.852 0.164 91.5);
    --primary-foreground: #0a0a0a;
    --primary-foreground: oklch(0.145 0 0);
    --radius: 0.625rem;
    --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      "Liberation Mono", monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4rem 1.5rem;
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }

  /* Matches the Card component: rounded-xl border shadow-sm. */
  .card {
    width: 100%;
    max-width: 28rem;
    padding: 2rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 4px);
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }

  /* The same wordmark the dashboard header carries. */
  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted-foreground);
  }

  .dot {
    width: 0.75rem;
    height: 0.75rem;
    flex: none;
    border-radius: 9999px;
    background: var(--primary);
  }

  h1 {
    margin: 1.75rem 0 0;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.025em;
  }

  p {
    margin: 0.75rem 0 0;
    font-size: 0.875rem;
    line-height: 1.6;
    color: var(--muted-foreground);
  }

  strong { color: var(--foreground); font-weight: 500; }

  /* Matches the Button component, default variant at the default size. */
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.25rem;
    margin-top: 1.5rem;
    padding: 0.5rem 1rem;
    border: 0;
    border-radius: calc(var(--radius) - 2px);
    background: var(--primary);
    color: var(--primary-foreground);
    font-family: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }

  .button:hover {
    background: #f7ce42;
    background: oklch(0.852 0.164 91.5 / 0.9);
  }

  .button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(246, 201, 45, 0.5);
  }

  form { margin: 0; }

  /* Identifiers are mono on a muted chip everywhere else in the app. */
  .address {
    display: inline-block;
    padding: 0.125rem 0.375rem;
    background: var(--muted);
    border-radius: calc(var(--radius) - 2px);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
    color: var(--foreground);
    word-break: break-all;
  }
`;

function page(outcome: Outcome): Response {
  const { heading, body } = COPY[outcome.state](
    'email' in outcome ? escapeHtml(outcome.email) : ''
  );

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Unsubscribe · Cadence</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <main class="card">
      <div class="brand"><span class="dot" aria-hidden="true"></span>Cadence</div>
      <h1>${heading}</h1>
      ${body}
    </main>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The confirm page carries a live token and the result page reports a
      // write, so neither should sit in a shared cache.
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * The last thing a prospect reads from us, so each failure state says plainly
 * whether they are actually unsubscribed and gives a route that works. Replying
 * with "stop" does work: the follow-up agent suppresses on any opt-out reply.
 */
const COPY: Record<Outcome['state'], (address: string) => { heading: string; body: string }> = {
  // The form carries no action, so it posts to the current URL with the token
  // still on it. Nothing has been written at this point.
  confirm: (address) => ({
    heading: 'Unsubscribe from these emails?',
    body: `<p>We will remove <span class="address">${address}</span> from our list, and you will not receive any more emails from us.</p>
      <form method="post">
        <input type="hidden" name="confirm" value="yes" />
        <button class="button" type="submit">Unsubscribe me</button>
      </form>`,
  }),
  unsubscribed: (address) => ({
    heading: 'You are unsubscribed',
    body: `<p>We have removed <span class="address">${address}</span> from our list. You will not receive any more emails from us.</p>
      <p>If this was a mistake, reply to any email we sent you and we will put you back on.</p>`,
  }),
  invalid_token: () => ({
    heading: 'This link is not valid',
    body: `<p>Your email client may have shortened the link, or it was altered on the way here. <strong>You have not been unsubscribed.</strong></p>
      <p>Reply to the email with the word stop and we will take you off the list.</p>`,
  }),
  error: () => ({
    heading: 'Something went wrong',
    body: `<p>We could not complete your request just now. <strong>You have not been unsubscribed yet.</strong></p>
      <p>Open the link again in a minute, or reply to the email with the word stop and we will take you off the list.</p>`,
  }),
};

/** Check the signature only. Reads nothing and writes nothing. */
function readToken(request: Request): { workspaceId: string; email: string } | null {
  const token = new URL(request.url).searchParams.get('token');
  return token ? verifyUnsubscribeToken(token) : null;
}

/**
 * Verify the token and suppress the address. Idempotent: repeating it on an
 * already suppressed address is a no-op, which matters because a one-click
 * POST can be retried by the mail client, and because the confirm page can be
 * submitted twice.
 */
async function suppressFromToken(request: Request): Promise<Settled> {
  const verified = readToken(request);
  if (!verified) return { state: 'invalid_token' };

  const { workspaceId, email } = verified;
  const normalised = email.toLowerCase();

  try {
    const db = supabaseService();

    await db.from('suppression_list').upsert(
      { workspace_id: workspaceId, email: normalised, reason: 'unsubscribed' },
      { onConflict: 'workspace_id,email', ignoreDuplicates: true }
    );

    const { data: leads } = await db
      .from('leads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('email', normalised);

    const now = new Date().toISOString();
    for (const lead of leads ?? []) {
      await db
        .from('leads')
        .update({ stage: 'suppressed', next_action_at: null })
        .eq('id', lead.id);
      await db.from('consent_records').update({ revoked_at: now }).eq('lead_id', lead.id);
    }

    return { state: 'unsubscribed', email: normalised };
  } catch {
    return { state: 'error' };
  }
}

/**
 * The in-body fallback link. Renders the confirm button and nothing else: a
 * link scanner, a safe-link rewriter or a prefetcher landing here leaves no
 * trace, because suppression waits for the POST.
 */
export async function GET(request: Request) {
  const verified = readToken(request);
  if (!verified) return page({ state: 'invalid_token' });
  return page({ state: 'confirm', email: verified.email.toLowerCase() });
}

/** Form bodies from both callers are urlencoded. An unreadable one is empty. */
async function readForm(request: Request): Promise<URLSearchParams> {
  try {
    return new URLSearchParams(await request.text());
  } catch {
    return new URLSearchParams();
  }
}

/**
 * The only handler that writes.
 *
 * Two callers: the confirm page's form, which sets confirm=yes and wants the
 * styled result page back, and a mail client posting the RFC 8058 one-click
 * body, which reads nothing but the status. Neither is asked to confirm again,
 * the first because it already did and the second because RFC 8058 forbids it.
 */
export async function POST(request: Request) {
  const fromConfirmPage = (await readForm(request)).get('confirm') === 'yes';
  const outcome = await suppressFromToken(request);

  if (fromConfirmPage) return page(outcome);

  if (outcome.state === 'invalid_token') {
    return new Response('invalid token', { status: 400 });
  }
  if (outcome.state === 'error') {
    // 500 so the client may retry; suppression is idempotent.
    return new Response('unsubscribe failed', { status: 500 });
  }
  return new Response('unsubscribed', { status: 200 });
}
