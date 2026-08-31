// app/api/webhooks/resend/route.ts
//
// The inbound half of the email channel. Until this existed the reply columns
// on actions (replied_at, reply_body, reply_sentiment) were read by the
// dashboard, the Sales Manager and the Follow-up manager but written by
// nobody, so every reply rate in the product was a flat zero.
//
// Resend signs its webhooks with Svix. The signature covers the exact bytes of
// the request body, so this handler reads request.text() once and parses that
// string afterwards; calling request.json() first and re-serialising would
// reorder keys and fail every verification.
//
// Idempotency is by construction rather than by an event ledger, because Svix
// retries on any non-2xx and will happily redeliver a message we already
// handled. Every write here is either convergent (writes the same value twice)
// or guarded by a filter that only matches the un-written state, so a repeat
// delivery is a no-op. That is also what makes it safe to answer 500 on a
// transient failure and let Resend retry.
//
// The handler runs under the service role: Resend has no session, and
// /api/webhooks/resend is listed in PUBLIC_PREFIXES in lib/supabase/middleware
// so the auth middleware does not redirect it to /login. The signature is the
// only thing authenticating the caller, so nothing touches the database until
// it verifies.

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

import { classifyReply, splitQuotedReply } from '@/lib/cadence/reply';
import { supabaseService } from '@/lib/supabase/server';

/** Svix's own default. Older than this and the signature is stale, not valid. */
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

/** Matches the body cap the action editor enforces in app/api/actions/[id]. */
const MAX_REPLY_CHARS = 20_000;

const RESEND_INBOUND_ENDPOINT = 'https://api.resend.com/emails/receiving';

type Db = ReturnType<typeof supabaseService>;

// ---------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------

/**
 * The subset of the Resend event envelope this route uses. Every field is
 * optional because the only guarantee the signature gives us is that Resend
 * sent these bytes, not that they carry the shape we expect.
 */
interface ResendEvent {
  type?: string;
  data?: {
    /** Resend's id for the email. For outbound events this is our provider_message_id. */
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[] | string;
    subject?: string | null;
    message_id?: string;
    bounce?: { message?: string; type?: string; subType?: string };
  };
}

/** The full inbound email, fetched separately: webhooks carry metadata only. */
interface InboundEmail {
  id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  headers?: unknown;
}

/** The originating outbound row a webhook event is talking about. */
interface MatchedAction {
  id: string;
  workspace_id: string;
  lead_id: string;
  replied_at: string | null;
}

// ---------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------

type VerifyResult = 'ok' | 'unconfigured' | 'invalid';

/**
 * Svix signs `{svix-id}.{svix-timestamp}.{body}` with HMAC-SHA256, keyed by the
 * base64-decoded half of the whsec_ secret, and sends the result base64 in a
 * space-delimited list of versioned signatures. A secret rotation puts two v1
 * entries in that list, so any one match is enough.
 */
function verifySignature(raw: string, headers: Headers): VerifyResult {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return 'unconfigured';

  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatures = headers.get('svix-signature');
  if (!id || !timestamp || !signatures) return 'invalid';

  // Reject replays of an old, genuinely signed request.
  const sentAtMs = Number(timestamp) * 1000;
  if (!Number.isFinite(sentAtMs)) return 'invalid';
  if (Math.abs(Date.now() - sentAtMs) > TIMESTAMP_TOLERANCE_MS) return 'invalid';

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest();

  for (const entry of signatures.split(' ')) {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) continue;
    const given = Buffer.from(value, 'base64');
    if (given.length !== expected.length) continue;
    if (crypto.timingSafeEqual(given, expected)) return 'ok';
  }

  return 'invalid';
}

// ---------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------

/** "Ada Lovelace <ada@example.com>" and "ada@example.com" both come back bare. */
function bareAddress(value: string | string[] | null | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const angled = first.match(/<([^>]+)>/);
  return (angled ? angled[1] : first).trim().toLowerCase() || null;
}

/**
 * Reads one header case-insensitively. Resend has returned headers both as a
 * name/value list and as a plain object across API versions, so accept either
 * rather than depending on which one this account gets.
 */
function headerValue(headers: unknown, name: string): string | null {
  const wanted = name.toLowerCase();

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const h = entry as { name?: string; value?: string };
      if (typeof h?.name === 'string' && h.name.toLowerCase() === wanted) {
        return typeof h.value === 'string' ? h.value : null;
      }
    }
    return null;
  }

  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() !== wanted) continue;
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }

  return null;
}

/** Crude tag strip, used only when an inbound email carries no text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * An out-of-office is not a reply. Recording one would set replied_at and
 * inflate every reply rate the dashboard and the Sales Manager compute, and
 * the Follow-up manager is explicitly instructed to treat it as no reply, so
 * these are acknowledged and dropped.
 */
function isAutoReply(email: InboundEmail): boolean {
  const autoSubmitted = headerValue(email.headers, 'auto-submitted');
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true;
  if (headerValue(email.headers, 'x-autoreply')) return true;
  if (headerValue(email.headers, 'x-autorespond')) return true;
  if (headerValue(email.headers, 'precedence')?.toLowerCase() === 'auto_reply') return true;

  const subject = (email.subject ?? '').trim().toLowerCase();
  return /^(automatic reply|auto:|autoreply|out of (?:the )?office)/.test(subject);
}

// ---------------------------------------------------------------
// Matching an event back to the action that caused it
// ---------------------------------------------------------------

const ACTION_COLUMNS = 'id, workspace_id, lead_id, replied_at';

/** Outbound events name the Resend id we stored as provider_message_id. */
async function actionByProviderId(db: Db, emailId: string): Promise<MatchedAction | null> {
  const { data } = await db
    .from('actions')
    .select(ACTION_COLUMNS)
    .eq('provider_message_id', emailId)
    .limit(1);
  return (data?.[0] as MatchedAction | undefined) ?? null;
}

/**
 * Fallback match, by who we last emailed at that address. Scoped through
 * actions, so it can only ever land on a workspace that actually sent to this
 * person; a lead row alone is not enough to justify writing against them.
 */
async function lastSentActionTo(db: Db, address: string): Promise<MatchedAction | null> {
  const { data } = await db
    .from('actions')
    .select(`${ACTION_COLUMNS}, leads!inner(email)`)
    .eq('channel', 'email')
    .eq('leads.email', address)
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1);
  return (data?.[0] as MatchedAction | undefined) ?? null;
}

/**
 * Every candidate id in In-Reply-To and References, as both the full
 * `id@domain` and the bare local part. Resend builds the Message-ID of an
 * outbound email around the same id it returns from the send call, which is
 * what we store in provider_message_id, but the domain half is Resend's and
 * not ours to assume, so both forms go into the lookup.
 */
function threadCandidates(headers: unknown): string[] {
  const raw = [headerValue(headers, 'in-reply-to'), headerValue(headers, 'references')]
    .filter((v): v is string => Boolean(v))
    .join(' ');
  if (!raw) return [];

  const ids = raw.match(/<[^>]+>/g)?.map((m) => m.slice(1, -1)) ?? raw.split(/\s+/);
  const candidates = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    candidates.add(trimmed);
    const at = trimmed.lastIndexOf('@');
    if (at > 0) candidates.add(trimmed.slice(0, at));
  }
  return [...candidates];
}

/**
 * Thread headers first, because they identify the exact message replied to.
 * Sender address second, for clients that drop References, which costs us
 * nothing worse than attributing the reply to the most recent send.
 */
async function matchInbound(db: Db, email: InboundEmail): Promise<MatchedAction | null> {
  const candidates = threadCandidates(email.headers);
  if (candidates.length) {
    const { data } = await db
      .from('actions')
      .select(ACTION_COLUMNS)
      .in('provider_message_id', candidates)
      .order('sent_at', { ascending: false })
      .limit(1);
    const matched = data?.[0] as MatchedAction | undefined;
    if (matched) return matched;
  }

  const sender = bareAddress(email.from);
  return sender ? lastSentActionTo(db, sender) : null;
}

// ---------------------------------------------------------------
// Writes
// ---------------------------------------------------------------

/**
 * Take the lead out of circulation permanently. Mirrors the suppress path in
 * the follow-up cron and the unsubscribe route: suppression row, suppressed
 * stage, no next action, and every consent record revoked. Idempotent — the
 * upsert ignores an existing row and the updates are convergent.
 */
async function suppressLead(db: Db, workspaceId: string, leadId: string, reason: string) {
  const { data: lead } = await db
    .from('leads')
    .select('email, phone')
    .eq('id', leadId)
    .eq('workspace_id', workspaceId)
    .single();

  await db
    .from('leads')
    .update({ stage: 'suppressed', next_action_at: null })
    .eq('id', leadId)
    .eq('workspace_id', workspaceId);

  await db
    .from('consent_records')
    .update({ revoked_at: new Date().toISOString() })
    .eq('lead_id', leadId)
    .is('revoked_at', null);

  if (lead?.email) {
    await db.from('suppression_list').upsert(
      {
        workspace_id: workspaceId,
        email: (lead.email as string).toLowerCase(),
        phone: (lead.phone as string | null) ?? null,
        reason,
      },
      { onConflict: 'workspace_id,email', ignoreDuplicates: true }
    );
  } else if (lead?.phone) {
    await db.from('suppression_list').upsert(
      { workspace_id: workspaceId, phone: lead.phone, reason },
      { onConflict: 'workspace_id,phone', ignoreDuplicates: true }
    );
  }
}

/** Bring the Follow-up manager forward so it reads the reply on the next tick. */
async function wakeForReply(db: Db, action: MatchedAction) {
  await db
    .from('leads')
    .update({ next_action_at: new Date().toISOString() })
    .eq('id', action.lead_id)
    .eq('workspace_id', action.workspace_id);

  // Only a lead we have merely contacted moves to engaged. Anything further
  // along (meeting_booked, won) is a stage the agents earned, not one a reply
  // should walk backwards.
  await db
    .from('leads')
    .update({ stage: 'engaged' })
    .eq('id', action.lead_id)
    .eq('workspace_id', action.workspace_id)
    .eq('stage', 'contacted');
}

// ---------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------

type Handled = Record<string, unknown>;

/**
 * A reply landed. The webhook carries metadata only, so the body comes from
 * the receiving API, and the thread headers we match on come with it.
 */
async function handleReceived(db: Db, event: ResendEvent): Promise<Handled> {
  const emailId = event.data?.email_id;
  if (!emailId) return { matched: false, reason: 'no_email_id' };

  const email = await fetchInboundEmail(emailId);
  if (!email) return { matched: false, reason: 'inbound_fetch_failed' };

  if (isAutoReply(email)) return { matched: false, reason: 'auto_reply' };

  const action = await matchInbound(db, email);
  if (!action) return { matched: false, reason: 'no_matching_action' };

  const raw = email.text?.trim() || (email.html ? htmlToText(email.html) : '');

  // The quoted original is dropped before anything reads the reply. Both the
  // stored body and the sentiment come off the same stripped half, so our own
  // outbound copy — unsubscribe footer included — cannot be classified as
  // though the recipient had written it.
  const { reply } = splitQuotedReply(raw);
  const body = reply.slice(0, MAX_REPLY_CHARS);
  const sentiment = classifyReply(body);

  // The guard is the idempotency: a redelivered event, or a later message in
  // the same thread, finds replied_at already set and updates nothing. First
  // reply wins, so the row keeps the answer the sequence actually earned.
  const { data: written } = await db
    .from('actions')
    .update({
      replied_at: new Date().toISOString(),
      reply_body: body,
      reply_sentiment: sentiment,
    })
    .eq('id', action.id)
    .is('replied_at', null)
    .select('id');

  const first = Boolean(written?.length);

  // Opt-out is evaluated on every inbound message, not only the first one, so
  // a "please remove me" further down a thread still suppresses.
  if (sentiment === 'unsubscribe') {
    await suppressLead(db, action.workspace_id, action.lead_id, 'unsubscribed');
  } else if (first) {
    await wakeForReply(db, action);
  }

  return { matched: true, actionId: action.id, sentiment, firstReply: first };
}

/**
 * Delivery confirmation. The send path already writes sent_at, so this is a
 * backfill for the case where the Resend call succeeded but our follow-up
 * update did not, and a no-op the rest of the time.
 */
async function handleDelivered(db: Db, event: ResendEvent): Promise<Handled> {
  const emailId = event.data?.email_id;
  if (!emailId) return { matched: false, reason: 'no_email_id' };

  const { data } = await db
    .from('actions')
    .update({ status: 'sent', sent_at: event.data?.created_at ?? new Date().toISOString() })
    .eq('provider_message_id', emailId)
    .is('sent_at', null)
    .select('id');

  return { matched: true, backfilled: Boolean(data?.length) };
}

/**
 * A bounce. The action is always marked failed; whether the lead is suppressed
 * depends on the class Resend assigns.
 *
 * Only `Permanent` is a hard bounce — the address does not exist and never
 * will, so continuing to send to it burns the sending domain's reputation for
 * nothing. `Transient` covers a full mailbox, an oversized message or rejected
 * content, all of which can succeed on a later attempt, and `Undetermined`
 * means the remote server did not say enough to judge. Neither suppresses.
 *
 * The test is on `type` rather than an allowlist of subtypes: Resend reports
 * Permanent subtypes beyond the two it documents, and a subtype this code has
 * not seen should still stop the sending, not slip through as retryable.
 */
async function handleBounced(db: Db, event: ResendEvent): Promise<Handled> {
  const emailId = event.data?.email_id;
  if (!emailId) return { matched: false, reason: 'no_email_id' };

  const bounce = event.data?.bounce;
  const detail = [bounce?.type, bounce?.subType].filter(Boolean).join('/') || 'unknown';
  const reason = `bounce:${detail}${bounce?.message ? `: ${bounce.message}` : ''}`.slice(0, 500);
  const permanent = bounce?.type?.toLowerCase() === 'permanent';

  const action = await actionByProviderId(db, emailId);
  if (!action) return { matched: false, reason: 'no_matching_action', bounce: reason };

  // Convergent: a redelivered event writes the same values to the same row.
  await db.from('actions').update({ status: 'failed', block_reason: reason }).eq('id', action.id);

  if (permanent) {
    await suppressLead(db, action.workspace_id, action.lead_id, 'hard_bounce');
  }

  return { matched: true, actionId: action.id, bounce: reason, suppressed: permanent };
}

/**
 * A spam complaint. This is the most expensive signal the channel produces —
 * complaints cost the sending domain — so the lead is suppressed outright and
 * never contacted again on any channel.
 */
async function handleComplained(db: Db, event: ResendEvent): Promise<Handled> {
  const emailId = event.data?.email_id;
  const recipient = bareAddress(event.data?.to);

  const action =
    (emailId ? await actionByProviderId(db, emailId) : null) ??
    (recipient ? await lastSentActionTo(db, recipient) : null);

  if (!action) return { matched: false, reason: 'no_matching_action' };

  await suppressLead(db, action.workspace_id, action.lead_id, 'complaint');
  return { matched: true, leadId: action.lead_id, suppressed: true };
}

/**
 * Pull the full inbound message. Resend keeps bodies, headers and attachments
 * out of the webhook so a large message cannot exceed a serverless request
 * limit, which means the reply text only exists behind this call. A null
 * return is treated as retryable by the caller.
 */
async function fetchInboundEmail(emailId: string): Promise<InboundEmail | null> {
  const response = await fetch(`${RESEND_INBOUND_ENDPOINT}/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as InboundEmail;
}

// ---------------------------------------------------------------
// Route
// ---------------------------------------------------------------

export async function POST(request: Request) {
  // Raw bytes, before anything parses them. The signature covers exactly this.
  const raw = await request.text();

  const verified = verifySignature(raw, request.headers);
  if (verified === 'unconfigured') {
    // Never fall open. Without the secret we cannot tell Resend from anyone.
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }
  if (verified === 'invalid') {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  const type = event.type ?? 'unknown';
  const db = supabaseService();

  try {
    switch (type) {
      case 'email.received':
        return NextResponse.json({ ok: true, type, ...(await handleReceived(db, event)) });
      case 'email.delivered':
        return NextResponse.json({ ok: true, type, ...(await handleDelivered(db, event)) });
      case 'email.bounced':
        return NextResponse.json({ ok: true, type, ...(await handleBounced(db, event)) });
      case 'email.complained':
        return NextResponse.json({ ok: true, type, ...(await handleComplained(db, event)) });
      default:
        // Resend sends whatever the endpoint is subscribed to. Acknowledge the
        // rest so it is not retried forever.
        return NextResponse.json({ ok: true, type, ignored: true });
    }
  } catch (err) {
    // 500 asks Resend to retry. Safe: every write above is idempotent.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown_error', type },
      { status: 500 }
    );
  }
}
