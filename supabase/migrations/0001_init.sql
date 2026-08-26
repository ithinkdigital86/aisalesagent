-- supabase/migrations/0001_init.sql
-- Cadence: AI revenue team. Core schema.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------

create type lead_stage as enum (
  'sourced', 'qualified', 'parked', 'contacted', 'engaged',
  'meeting_booked', 'won', 'lost', 'suppressed'
);

create type channel as enum ('email', 'sms', 'voice', 'linkedin', 'instagram');

create type consent_basis as enum (
  'written',          -- explicit opt-in, TCPA prior express written consent
  'oral',             -- recorded verbal yes
  'enquiry_implied',  -- inbound enquiry, TRAI service window
  'legitimate_b2b',   -- licensed B2B data, work email only, no voice/SMS
  'none'
);

create type action_status as enum ('queued', 'awaiting_approval', 'sent', 'failed', 'blocked');

create type agent_slug as enum (
  'sales_manager', 'qualifier', 'content_creator', 'follow_up',
  'email_specialist', 'linkedin_specialist', 'instagram_specialist',
  'voice_specialist', 'sourcing_scout'
);

-- ---------------------------------------------------------------
-- Workspaces (multi-tenant: one per client you run Cadence for)
-- ---------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- Jurisdiction drives which consent rules the gate enforces.
  jurisdictions text[] not null default array['IN'],
  dlt_entity_id text,
  dlt_registered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- ICP + sourcing
-- ---------------------------------------------------------------

create table icp_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  -- { industries: [], employee_range: [min,max], geos: [], titles: [],
  --   revenue_range: [], tech_stack: [], exclusions: [] }
  filters jsonb not null default '{}'::jsonb,
  -- Which trigger events make a lead urgent for this ICP.
  trigger_types text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  icp_profile_id uuid references icp_profiles(id) on delete set null,
  source text not null,               -- 'apollo' | 'explorium' | 'inbound' | 'crm_mining'
  filters_used jsonb not null default '{}'::jsonb,
  returned_count int not null default 0,
  inserted_count int not null default 0,
  duplicate_count int not null default 0,
  suppressed_count int not null default 0,
  credits_used int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------

create table leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  icp_profile_id uuid references icp_profiles(id) on delete set null,
  sourcing_run_id uuid references sourcing_runs(id) on delete set null,

  full_name text,
  title text,
  seniority text,
  company_name text,
  company_domain text,
  employee_count int,
  industry text,
  country text,
  timezone text,

  email text,
  email_verified boolean not null default false,
  phone text,
  linkedin_url text,
  instagram_handle text,

  stage lead_stage not null default 'sourced',
  fit_score int check (fit_score between 0 and 100),
  fit_reasoning text,

  -- Set by the enrich/dedupe gate. Used for the unique index below.
  dedupe_key text,

  last_contacted_at timestamptz,
  next_action_at timestamptz,
  assigned_sequence_id uuid,

  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One person per workspace, regardless of which source found them.
create unique index leads_workspace_dedupe_idx
  on leads (workspace_id, dedupe_key) where dedupe_key is not null;
create index leads_stage_idx on leads (workspace_id, stage);
create index leads_next_action_idx on leads (workspace_id, next_action_at)
  where next_action_at is not null;
create index leads_score_idx on leads (workspace_id, fit_score desc nulls last);
create index leads_company_trgm_idx on leads using gin (company_name gin_trgm_ops);

-- ---------------------------------------------------------------
-- Consent: the gate every outbound action passes through
-- ---------------------------------------------------------------

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  basis consent_basis not null,
  channels channel[] not null,
  -- Where the consent came from. This is the audit artefact.
  source_description text not null,
  evidence_url text,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index consent_lead_idx on consent_records (lead_id) where revoked_at is null;

-- DND / do-not-contact. Checked before every send, and before every insert.
create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Store whichever identifier we have. Normalised lowercase / E.164.
  email text,
  phone text,
  domain text,
  reason text not null,   -- 'unsubscribed' | 'dnd_registry' | 'current_client' | 'competitor' | 'complaint'
  created_at timestamptz not null default now(),
  constraint suppression_has_identifier
    check (email is not null or phone is not null or domain is not null)
);

create unique index suppression_email_idx on suppression_list (workspace_id, email) where email is not null;
create unique index suppression_phone_idx on suppression_list (workspace_id, phone) where phone is not null;
create unique index suppression_domain_idx on suppression_list (workspace_id, domain) where domain is not null;

-- ---------------------------------------------------------------
-- Triggers: the event that makes a lead urgent
-- ---------------------------------------------------------------

create table lead_triggers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  trigger_type text not null,   -- 'hiring' | 'funding' | 'leadership_change' | 'tech_adopted' | 'ad_spend_started'
  headline text not null,       -- one line the Content Creator can quote
  detected_at timestamptz not null default now(),
  decays_at timestamptz,        -- triggers go stale; after this it stops boosting score
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_triggers_lead_idx on lead_triggers (lead_id, detected_at desc);

-- ---------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------

create table sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  -- [{ step: 1, channel: 'email', agent: 'email_specialist', delay_hours: 0 }, ...]
  steps jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sent_count int not null default 0,
  reply_count int not null default 0,
  meeting_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leads
  add constraint leads_sequence_fk
  foreign key (assigned_sequence_id) references sequences(id) on delete set null;

-- ---------------------------------------------------------------
-- Actions: every outbound attempt, approved or not
-- ---------------------------------------------------------------

create table actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  sequence_id uuid references sequences(id) on delete set null,
  agent agent_slug not null,
  channel channel not null,
  step_number int,

  subject text,
  body text not null,
  status action_status not null default 'queued',

  -- Filled by the consent gate on every evaluation. Never null once evaluated.
  consent_basis consent_basis,
  block_reason text,

  scheduled_for timestamptz,
  sent_at timestamptz,
  provider_message_id text,

  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  reply_body text,
  reply_sentiment text,   -- 'positive' | 'neutral' | 'negative' | 'objection' | 'unsubscribe'

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index actions_lead_idx on actions (lead_id, created_at desc);
create index actions_pending_idx on actions (workspace_id, status, scheduled_for)
  where status in ('queued', 'awaiting_approval');

-- ---------------------------------------------------------------
-- Agent memory: what the team has learned
-- ---------------------------------------------------------------

create table agent_memory (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent agent_slug not null,
  -- 'winning_opener' | 'best_send_hour' | 'objection_response' | 'icp_insight'
  memory_type text not null,
  content text not null,
  -- Evidence behind the lesson, so we can retire it when it stops working.
  sample_size int not null default 0,
  success_rate numeric(5,4),
  confidence numeric(3,2) not null default 0.5,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agent_memory_active_idx on agent_memory (workspace_id, agent, memory_type)
  where retired_at is null;

-- Every agent invocation, for cost tracking and debugging.
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent agent_slug not null,
  lead_id uuid references leads(id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  duration_ms int,
  ok boolean not null default true,
  error text,
  raw_output jsonb,
  created_at timestamptz not null default now()
);

create index agent_runs_recent_idx on agent_runs (workspace_id, created_at desc);

-- ---------------------------------------------------------------
-- Enrichment cache: never pay twice for the same contact
-- ---------------------------------------------------------------

create table enrichment_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,          -- 'apollo' | 'explorium'
  cache_key text not null,         -- normalised email or domain+name
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create unique index enrichment_cache_key_idx on enrichment_cache (provider, cache_key);

-- ---------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','icp_profiles','leads','sequences','actions','agent_memory'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
       for each row execute function set_updated_at()', t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Row Level Security: everything scoped through workspace ownership
-- ---------------------------------------------------------------

alter table workspaces        enable row level security;
alter table icp_profiles      enable row level security;
alter table sourcing_runs     enable row level security;
alter table leads             enable row level security;
alter table consent_records   enable row level security;
alter table suppression_list  enable row level security;
alter table lead_triggers     enable row level security;
alter table sequences         enable row level security;
alter table actions           enable row level security;
alter table agent_memory      enable row level security;
alter table agent_runs        enable row level security;

create policy workspaces_owner on workspaces
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Helper: is this workspace mine?
create or replace function owns_workspace(ws uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from workspaces w where w.id = ws and w.owner_id = auth.uid()
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'icp_profiles','sourcing_runs','leads','consent_records','suppression_list',
    'lead_triggers','sequences','actions','agent_memory','agent_runs'
  ] loop
    execute format(
      'create policy %I_workspace on %I for all
       using (owns_workspace(workspace_id))
       with check (owns_workspace(workspace_id))', t, t
    );
  end loop;
end $$;

-- enrichment_cache is shared across workspaces (that is the point) and is
-- only ever touched by the service role, so RLS stays off with no policies.
revoke all on enrichment_cache from anon, authenticated;
