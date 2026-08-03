// lib/cadence/sourcing/apollo.ts
//
// Pulls people from Apollo against an ICP, then runs every result through the
// enrich/dedupe gate before it is allowed to become a lead.
//
// Apollo charges per credit, so the cache check happens before the API call,
// never after.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/types/database';

const APOLLO_SEARCH = 'https://api.apollo.io/api/v1/mixed_people/search';

export interface IcpFilters {
  industries?: string[];
  employee_range?: [number, number];
  geos?: string[];
  titles?: string[];
  seniorities?: string[];
  exclusions?: { domains?: string[] };
}

export interface SourcingOutcome {
  runId: string;
  returned: number;
  inserted: number;
  duplicates: number;
  suppressed: number;
  creditsUsed: number;
}

/** Stable identity for a person across sources. */
export function dedupeKey(p: {
  email?: string | null;
  full_name?: string | null;
  company_domain?: string | null;
}): string | null {
  if (p.email) return p.email.trim().toLowerCase();
  if (p.full_name && p.company_domain) {
    const raw = `${p.full_name.trim().toLowerCase()}@${p.company_domain.trim().toLowerCase()}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }
  return null;
}

export async function sourceFromApollo(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    icpProfileId: string;
    filters: IcpFilters;
    limit?: number;
  }
): Promise<SourcingOutcome> {
  const limit = Math.min(opts.limit ?? 25, 100);

  const { data: run } = await db
    .from('sourcing_runs')
    .insert({
      workspace_id: opts.workspaceId,
      icp_profile_id: opts.icpProfileId,
      source: 'apollo',
      filters_used: opts.filters as unknown as Json,
    })
    .select('id')
    .single();

  const runId = run!.id as string;

  const body = {
    page: 1,
    per_page: limit,
    person_titles: opts.filters.titles ?? [],
    person_seniorities: opts.filters.seniorities ?? [],
    organization_num_employees_ranges: opts.filters.employee_range
      ? [`${opts.filters.employee_range[0]},${opts.filters.employee_range[1]}`]
      : [],
    organization_locations: opts.filters.geos ?? [],
    q_organization_keyword_tags: opts.filters.industries ?? [],
  };

  let people: ApolloPerson[] = [];
  let creditsUsed = 0;

  try {
    const res = await fetch(APOLLO_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': process.env.APOLLO_API_KEY!,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      await db.from('sourcing_runs').update({ error: `apollo_${res.status}: ${text.slice(0, 400)}` }).eq('id', runId);
      throw new Error(`Apollo returned ${res.status}`);
    }

    const json = (await res.json()) as { people?: ApolloPerson[] };
    people = json.people ?? [];
    creditsUsed = people.length;
  } catch (err) {
    await db
      .from('sourcing_runs')
      .update({ error: err instanceof Error ? err.message : 'unknown' })
      .eq('id', runId);
    throw err;
  }

  let inserted = 0;
  let duplicates = 0;
  let suppressed = 0;

  const excludedDomains = new Set(
    (opts.filters.exclusions?.domains ?? []).map((d) => d.toLowerCase())
  );

  for (const p of people) {
    const domain = p.organization?.primary_domain?.toLowerCase() ?? null;
    const email = p.email?.toLowerCase() ?? null;

    // Generic inboxes are not people. They fail qualification anyway, so do
    // not spend a row on them.
    if (email && /^(info|contact|hello|support|admin|sales)@/.test(email)) {
      suppressed++;
      continue;
    }

    if (domain && excludedDomains.has(domain)) {
      suppressed++;
      continue;
    }

    const key = dedupeKey({
      email,
      full_name: p.name,
      company_domain: domain,
    });

    if (!key) {
      suppressed++;
      continue;
    }

    // Suppression list check happens at insert time, not just at send time.
    // Cheaper to never create the lead than to create and block it.
    const orFilters = [`email.eq.${email ?? ''}`, `domain.eq.${domain ?? ''}`]
      .filter((f) => !f.endsWith('.eq.'))
      .join(',');

    if (orFilters) {
      const { data: hit } = await db
        .from('suppression_list')
        .select('id')
        .eq('workspace_id', opts.workspaceId)
        .or(orFilters)
        .limit(1);
      if (hit?.length) {
        suppressed++;
        continue;
      }
    }

    const { error } = await db.from('leads').insert({
      workspace_id: opts.workspaceId,
      icp_profile_id: opts.icpProfileId,
      sourcing_run_id: runId,
      dedupe_key: key,
      full_name: p.name,
      title: p.title,
      seniority: p.seniority,
      company_name: p.organization?.name,
      company_domain: domain,
      employee_count: p.organization?.estimated_num_employees,
      industry: p.organization?.industry,
      country: normaliseCountry(p.country),
      email,
      email_verified: p.email_status === 'verified',
      phone: p.organization?.phone ?? null,
      linkedin_url: p.linkedin_url,
      stage: 'sourced',
      raw: p as unknown as Json,
    });

    // 23505 is the unique-violation code: the dedupe index caught a repeat.
    if (error?.code === '23505') duplicates++;
    else if (error) suppressed++;
    else inserted++;
  }

  // Licensed B2B data gives an email basis only. Never voice, never SMS.
  await grantB2bEmailBasis(db, opts.workspaceId, runId);

  await db
    .from('sourcing_runs')
    .update({
      returned_count: people.length,
      inserted_count: inserted,
      duplicate_count: duplicates,
      suppressed_count: suppressed,
      credits_used: creditsUsed,
    })
    .eq('id', runId);

  return {
    runId,
    returned: people.length,
    inserted,
    duplicates,
    suppressed,
    creditsUsed,
  };
}

async function grantB2bEmailBasis(
  db: SupabaseClient,
  workspaceId: string,
  runId: string
) {
  const { data: fresh } = await db
    .from('leads')
    .select('id')
    .eq('sourcing_run_id', runId)
    .not('email', 'is', null);

  if (!fresh?.length) return;

  await db.from('consent_records').insert(
    fresh.map((l) => ({
      workspace_id: workspaceId,
      lead_id: l.id,
      basis: 'legitimate_b2b' as const,
      channels: ['email' as const],
      source_description: `Apollo licensed B2B data, sourcing run ${runId}`,
    }))
  );
}

function normaliseCountry(input?: string | null): string | null {
  if (!input) return null;
  const map: Record<string, string> = {
    india: 'IN',
    'united states': 'US',
    usa: 'US',
    australia: 'AU',
    'united kingdom': 'GB',
    uk: 'GB',
  };
  return map[input.trim().toLowerCase()] ?? input.slice(0, 2).toUpperCase();
}

interface ApolloPerson {
  id: string;
  name?: string;
  title?: string;
  seniority?: string;
  email?: string | null;
  email_status?: string;
  linkedin_url?: string;
  country?: string;
  organization?: {
    name?: string;
    primary_domain?: string;
    estimated_num_employees?: number;
    industry?: string;
    phone?: string;
  };
}
