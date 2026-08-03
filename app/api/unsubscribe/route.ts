// app/api/unsubscribe/route.ts
//
// Target of the unsubscribe link in outbound email. Verifies the signed token,
// then writes suppression_list and revokes consent for the matching leads. The
// visitor has no session, so this runs under the service role.

import { verifyUnsubscribeToken } from '@/lib/cadence/adapters/email';
import { supabaseService } from '@/lib/supabase/server';

function page(message: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unsubscribe</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #0a0a0a; color: #ededed; font-family: system-ui, sans-serif; }
      .card { max-width: 28rem; padding: 2rem; text-align: center; }
      .dot { display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 9999px;
        background: #facc15; margin-bottom: 1rem; }
      p { line-height: 1.6; color: #a3a3a3; }
    </style>
  </head>
  <body>
    <div class="card">
      <span class="dot"></span>
      <p>${message}</p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return page('This unsubscribe link is not valid.');

  const verified = verifyUnsubscribeToken(token);
  if (!verified) return page('This unsubscribe link is not valid.');

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

    return page('You have been unsubscribed. You will not receive any more emails from us.');
  } catch {
    return page('Something went wrong. Please try the link again shortly.');
  }
}
