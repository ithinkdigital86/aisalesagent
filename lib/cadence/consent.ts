// lib/cadence/consent.ts
//
// The single choke point for every outbound action in Cadence.
// No adapter sends anything without a passing verdict from here.

import type { SupabaseClient } from '@supabase/supabase-js';

export type Channel = 'email' | 'sms' | 'voice' | 'linkedin' | 'instagram';
export type ConsentBasis =
  | 'written'
  | 'oral'
  | 'enquiry_implied'
  | 'legitimate_b2b'
  | 'none';

export type Verdict =
  | { allowed: true; basis: ConsentBasis; requiresApproval: boolean; notes: string[] }
  | { allowed: false; reason: string };

/**
 * What each channel minimally requires, by jurisdiction.
 *
 * 'legitimate_b2b' means licensed B2B data, work address, no prior relationship.
 * It is enough for email in IN/US/AU with a working unsubscribe. It is never
 * enough for voice or SMS anywhere.
 */
const REQUIREMENTS: Record<
  string,
  Partial<Record<Channel, ConsentBasis[]>>
> = {
  IN: {
    email: ['legitimate_b2b', 'enquiry_implied', 'oral', 'written'],
    // TRAI: promotional voice/SMS needs registered consent. Enquiry within the
    // service window is the one exception, and only for service content.
    sms: ['enquiry_implied', 'written'],
    voice: ['enquiry_implied', 'written'],
  },
  US: {
    email: ['legitimate_b2b', 'enquiry_implied', 'oral', 'written'],
    // TCPA: AI voice counts as artificial voice. Marketing needs prior express
    // written consent. We do not accept 'oral' for marketing by default.
    sms: ['written'],
    voice: ['written'],
  },
  AU: {
    email: ['legitimate_b2b', 'enquiry_implied', 'oral', 'written'],
    sms: ['oral', 'written'],
    voice: ['oral', 'written'],
  },
  GB: {
    email: ['legitimate_b2b', 'enquiry_implied', 'oral', 'written'],
    sms: ['written'],
    voice: ['oral', 'written'],
  },
};

/**
 * Channels with no compliant automated path. These are draft-only: the agent
 * writes the message, a human sends it. This is a platform-terms constraint,
 * not a consent one, so no consent record can unlock it.
 */
const HUMAN_SEND_ONLY: Channel[] = ['linkedin', 'instagram'];

/** TRAI treats an inbound enquiry as implied consent for a limited window. */
const ENQUIRY_WINDOW_DAYS = 90;

function jurisdictionFor(country: string | null, fallback: string[]): string {
  if (country && REQUIREMENTS[country]) return country;
  const first = fallback.find((j) => REQUIREMENTS[j]);
  return first ?? 'IN';
}

export async function evaluateConsent(
  db: SupabaseClient,
  opts: { workspaceId: string; leadId: string; channel: Channel }
): Promise<Verdict> {
  const { workspaceId, leadId, channel } = opts;
  const notes: string[] = [];

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('id, email, phone, company_domain, country, stage')
    .eq('id', leadId)
    .eq('workspace_id', workspaceId)
    .single();

  if (leadErr || !lead) return { allowed: false, reason: 'lead_not_found' };
  if (lead.stage === 'suppressed') return { allowed: false, reason: 'lead_suppressed' };

  // 1. Suppression always wins, on every channel, no exceptions.
  const suppressed = await isSuppressed(db, workspaceId, {
    email: lead.email,
    phone: lead.phone,
    domain: lead.company_domain,
  });
  if (suppressed) return { allowed: false, reason: `suppressed:${suppressed}` };

  // 2. Do we even have the identifier this channel needs?
  if (channel === 'email' && !lead.email) return { allowed: false, reason: 'no_email' };
  if ((channel === 'sms' || channel === 'voice') && !lead.phone)
    return { allowed: false, reason: 'no_phone' };

  // 3. Platform-terms channels never auto-send.
  if (HUMAN_SEND_ONLY.includes(channel)) {
    return {
      allowed: true,
      basis: 'none',
      requiresApproval: true,
      notes: [`${channel} has no compliant send API; queued for human send`],
    };
  }

  const { data: workspace } = await db
    .from('workspaces')
    .select('jurisdictions, dlt_registered')
    .eq('id', workspaceId)
    .single();

  const jurisdiction = jurisdictionFor(
    lead.country,
    workspace?.jurisdictions ?? ['IN']
  );
  const accepted = REQUIREMENTS[jurisdiction]?.[channel];

  if (!accepted) {
    return { allowed: false, reason: `channel_not_permitted:${jurisdiction}:${channel}` };
  }

  // 4. India: no DLT registration means no automated voice or SMS at all.
  if (jurisdiction === 'IN' && (channel === 'sms' || channel === 'voice')) {
    if (!workspace?.dlt_registered) {
      return { allowed: false, reason: 'dlt_not_registered' };
    }
  }

  // 5. Find the strongest live consent record for this channel.
  const { data: records } = await db
    .from('consent_records')
    .select('basis, channels, captured_at, expires_at')
    .eq('lead_id', leadId)
    .is('revoked_at', null)
    .order('captured_at', { ascending: false });

  const now = Date.now();
  const live = (records ?? []).filter((r) => {
    if (!r.channels.includes(channel)) return false;
    if (r.expires_at && new Date(r.expires_at).getTime() < now) return false;
    if (r.basis === 'enquiry_implied') {
      const age = now - new Date(r.captured_at).getTime();
      return age <= ENQUIRY_WINDOW_DAYS * 86_400_000;
    }
    return true;
  });

  // Strongest basis first.
  const ranked: ConsentBasis[] = ['written', 'oral', 'enquiry_implied', 'legitimate_b2b'];
  const best = ranked.find((b) => live.some((r) => r.basis === b));

  if (!best || !accepted.includes(best)) {
    return {
      allowed: false,
      reason: `insufficient_consent:${jurisdiction}:${channel}:have=${best ?? 'none'}`,
    };
  }

  if (best === 'enquiry_implied') {
    notes.push(`enquiry window: service content only, no promotional offers`);
  }
  if (best === 'legitimate_b2b') {
    notes.push('B2B basis: work address only, unsubscribe link mandatory');
  }
  if (channel === 'voice') {
    notes.push('disclose AI voice in the opening line; identify the calling entity');
  }

  return {
    allowed: true,
    basis: best,
    // Voice is the highest-risk channel, so it stays human-approved until you
    // flip this deliberately.
    requiresApproval: channel === 'voice',
    notes,
  };
}

async function isSuppressed(
  db: SupabaseClient,
  workspaceId: string,
  ids: { email?: string | null; phone?: string | null; domain?: string | null }
): Promise<string | null> {
  const filters: string[] = [];
  if (ids.email) filters.push(`email.eq.${ids.email.toLowerCase()}`);
  if (ids.phone) filters.push(`phone.eq.${ids.phone}`);
  if (ids.domain) filters.push(`domain.eq.${ids.domain.toLowerCase()}`);
  if (!filters.length) return null;

  const { data } = await db
    .from('suppression_list')
    .select('reason')
    .eq('workspace_id', workspaceId)
    .or(filters.join(','))
    .limit(1);

  return data?.[0]?.reason ?? null;
}

/**
 * Call this from your inbound form handler. This is what unlocks the voice
 * agent legally, so it matters more than any other write in the system.
 */
export async function recordEnquiryConsent(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    leadId: string;
    sourceDescription: string;
    channels?: Channel[];
    evidenceUrl?: string;
  }
) {
  return db.from('consent_records').insert({
    workspace_id: opts.workspaceId,
    lead_id: opts.leadId,
    basis: 'enquiry_implied',
    channels: opts.channels ?? ['email', 'sms', 'voice'],
    source_description: opts.sourceDescription,
    evidence_url: opts.evidenceUrl,
    expires_at: new Date(
      Date.now() + ENQUIRY_WINDOW_DAYS * 86_400_000
    ).toISOString(),
  });
}
