// lib/cadence/adapters/email.ts
//
// The email send path. Every send goes through evaluateConsent first, records
// an actions row with the returned consent_basis before the network call, and
// carries a signed unsubscribe link that writes to suppression_list when used.
// This adapter never decides consent itself; it only obeys the gate.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateConsent } from '@/lib/cadence/consent';
import type { Enums } from '@/types/database';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailInput {
  workspaceId: string;
  leadId: string;
  subject: string;
  /** Body without the unsubscribe footer; the adapter appends it. */
  body: string;
  agent?: Enums<'agent_slug'>;
  sequenceId?: string | null;
  stepNumber?: number | null;
}

export type SendEmailResult =
  | { status: 'sent'; actionId: string | null; providerMessageId: string | null }
  | { status: 'awaiting_approval'; actionId: string | null }
  | { status: 'blocked'; actionId: string | null; reason: string }
  | { status: 'failed'; actionId: string | null; error: string };

function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/** Signed, non-expiring token identifying which address to suppress. */
export function unsubscribeToken(workspaceId: string, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ w: workspaceId, e: email.toLowerCase() })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.CRON_SECRET ?? '')
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyUnsubscribeToken(
  token: string
): { workspaceId: string; email: string } | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', process.env.CRON_SECRET ?? '')
    .update(payload)
    .digest('base64url');
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      w?: string;
      e?: string;
    };
    if (!parsed.w || !parsed.e) return null;
    return { workspaceId: parsed.w, email: parsed.e };
  } catch {
    return null;
  }
}

function unsubscribeUrl(workspaceId: string, email: string): string {
  return `${appUrl()}/api/unsubscribe?token=${encodeURIComponent(
    unsubscribeToken(workspaceId, email)
  )}`;
}

function withUnsubscribe(body: string, url: string): string {
  return `${body}\n\nTo stop receiving these emails, unsubscribe here: ${url}`;
}

export async function sendEmail(
  db: SupabaseClient,
  input: SendEmailInput
): Promise<SendEmailResult> {
  const { workspaceId, leadId, subject } = input;
  const agent = input.agent ?? 'email_specialist';
  const base = {
    workspace_id: workspaceId,
    lead_id: leadId,
    agent,
    channel: 'email' as const,
    subject,
    sequence_id: input.sequenceId ?? null,
    step_number: input.stepNumber ?? null,
  };

  // 1. The consent gate decides first. Nothing sends without a passing verdict.
  const verdict = await evaluateConsent(db, { workspaceId, leadId, channel: 'email' });

  if (!verdict.allowed) {
    const { data } = await db
      .from('actions')
      .insert({
        ...base,
        body: input.body,
        status: 'blocked',
        consent_basis: null,
        block_reason: verdict.reason,
      })
      .select('id')
      .single();
    return { status: 'blocked', actionId: (data?.id as string) ?? null, reason: verdict.reason };
  }

  // 2. Recipient address. The gate already confirmed it exists, but re-read it
  //    here since we need the value to build the unsubscribe link and send.
  const { data: lead } = await db
    .from('leads')
    .select('email')
    .eq('id', leadId)
    .eq('workspace_id', workspaceId)
    .single();
  const email = (lead?.email as string | null) ?? null;
  if (!email) {
    const { data } = await db
      .from('actions')
      .insert({
        ...base,
        body: input.body,
        status: 'blocked',
        consent_basis: verdict.basis,
        block_reason: 'no_email',
      })
      .select('id')
      .single();
    return { status: 'blocked', actionId: (data?.id as string) ?? null, reason: 'no_email' };
  }

  const url = unsubscribeUrl(workspaceId, email);
  const bodyWithUnsub = withUnsubscribe(input.body, url);

  // 3. Record the actions row with the returned consent_basis BEFORE sending.
  const status: Enums<'action_status'> = verdict.requiresApproval ? 'awaiting_approval' : 'queued';
  const { data: action } = await db
    .from('actions')
    .insert({ ...base, body: bodyWithUnsub, status, consent_basis: verdict.basis })
    .select('id')
    .single();
  const actionId = (action?.id as string) ?? null;

  // 4. If the gate wants a human to approve first, stop before sending.
  if (verdict.requiresApproval) {
    return { status: 'awaiting_approval', actionId };
  }

  // 5. Send via Resend.
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY!}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM!,
        to: [email],
        subject,
        text: bodyWithUnsub,
        headers: { 'List-Unsubscribe': `<${url}>` },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      const reason = `resend_${response.status}: ${text.slice(0, 300)}`;
      if (actionId) {
        await db.from('actions').update({ status: 'failed', block_reason: reason }).eq('id', actionId);
      }
      return { status: 'failed', actionId, error: `Resend returned ${response.status}` };
    }

    const json = (await response.json()) as { id?: string };
    const now = new Date().toISOString();
    if (actionId) {
      await db
        .from('actions')
        .update({ status: 'sent', sent_at: now, provider_message_id: json.id ?? null })
        .eq('id', actionId);
    }
    await db
      .from('leads')
      .update({ last_contacted_at: now })
      .eq('id', leadId)
      .eq('workspace_id', workspaceId);

    return { status: 'sent', actionId, providerMessageId: json.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    if (actionId) {
      await db.from('actions').update({ status: 'failed', block_reason: message }).eq('id', actionId);
    }
    return { status: 'failed', actionId, error: message };
  }
}
