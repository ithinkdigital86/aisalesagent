-- supabase/migrations/0005_business_profile_and_generated_icps.sql
-- The ICP has so far been typed in by hand from nothing. This gives the
-- workspace a structured description of the business itself, and gives an
-- agent a place to put the profiles it proposes from that description.
--
--  1. business_profiles: one per workspace. What the company sells, to whom,
--     what it fixes and what it will not take on. The ICP strategist reads
--     this and nothing else, so what is not written here the agent does not
--     know.
--
--  2. icp_generations: one row per strategist run, with the agent's pick and
--     its reasons. Generated profiles point back at it so a batch can be
--     shown as a batch and traced to the run that produced it.
--
--  3. icp_profiles gains an origin. A score made against a generated profile
--     has to be tellable from one made against a profile a human wrote, and
--     origin survives editing: a suggestion the owner tidied up is still a
--     suggestion. It also gains the fields a proposal carries that the form
--     did not: pain points, plain-language exclusions and a rationale.
--
-- Nothing here activates a profile. A generated profile is inserted with
-- active = false and stays that way until a human sets it.

-- ---------------------------------------------------------------
-- Business profile
-- ---------------------------------------------------------------

create table if not exists business_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  company_name text not null,
  website text,
  description text,
  services text[] not null default '{}',
  industries_served text[] not null default '{}',
  customer_types text[] not null default '{}',
  problems_solved text[] not null default '{}',
  differentiators text[] not null default '{}',
  pricing_model text,
  exclusions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_profiles_one_per_workspace unique (workspace_id)
);

comment on table business_profiles is
  'What the workspace''s business does, in its owner''s words. The only input the ICP strategist reads.';
comment on column business_profiles.customer_types is
  'Who buys, as kinds of organisation or buyer: "founder-led agencies", "in-house marketing teams". Not job titles.';
comment on column business_profiles.exclusions is
  'Who the business will not take on, in plain language: "no agencies", "nothing below 10 seats".';

create trigger business_profiles_set_updated_at before update on business_profiles
  for each row execute function set_updated_at();

alter table business_profiles enable row level security;

create policy business_profiles_workspace on business_profiles for all
  using (owns_workspace(workspace_id))
  with check (owns_workspace(workspace_id));

-- ---------------------------------------------------------------
-- The strategist is an agent like the others, so its runs land in agent_runs
-- under its own slug. The value cannot be used in this transaction, only in
-- later ones, which is fine: nothing below writes an agent_runs row.
-- ---------------------------------------------------------------

alter type agent_slug add value if not exists 'icp_strategist';

-- ---------------------------------------------------------------
-- Generations
-- ---------------------------------------------------------------

create table if not exists icp_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  -- The profile as the agent saw it, so a batch can be read against the input
  -- that produced it after the owner has edited the profile again.
  business_profile_snapshot jsonb not null default '{}'::jsonb,
  -- The agent's pick. Set after the profiles are inserted, hence nullable.
  recommended_icp_id uuid,
  recommendation_reason text,
  created_at timestamptz not null default now()
);

comment on column icp_generations.recommendation_reason is
  'Why the agent picked recommended_icp_id, in terms of the business profile it was given. Advice, never acted on by the system.';

create index if not exists icp_generations_recent_idx
  on icp_generations (workspace_id, created_at desc);

alter table icp_generations enable row level security;

create policy icp_generations_workspace on icp_generations for all
  using (owns_workspace(workspace_id))
  with check (owns_workspace(workspace_id));

-- ---------------------------------------------------------------
-- icp_profiles: origin and the proposal fields
-- ---------------------------------------------------------------

alter table icp_profiles
  add column if not exists origin text not null default 'human',
  add column if not exists generation_id uuid references icp_generations(id) on delete set null,
  add column if not exists rationale text,
  add column if not exists pain_points text[] not null default '{}',
  add column if not exists exclusions text[] not null default '{}',
  add column if not exists archived_at timestamptz;

alter table icp_profiles
  drop constraint if exists icp_profiles_origin_check;
alter table icp_profiles
  add constraint icp_profiles_origin_check check (origin in ('human', 'generated'));

comment on column icp_profiles.origin is
  '''human'' for a profile someone typed in, ''generated'' for one the ICP strategist proposed. Survives editing and activation: it says where the profile came from, not who last touched it.';
comment on column icp_profiles.generation_id is
  'The strategist run this profile came out of. Null for a human-authored profile.';
comment on column icp_profiles.rationale is
  'Why this segment fits the business, as written by whoever authored the profile. For a generated one, the agent''s case for it.';
comment on column icp_profiles.pain_points is
  'The problems a buyer in this segment is living with that the business fixes. Fed to the Qualifier and the Content Creator.';
comment on column icp_profiles.exclusions is
  'Who in this segment not to pursue, in plain language. filters.exclusions.domains remains the machine-readable domain block list.';
comment on column icp_profiles.archived_at is
  'Set when a suggestion is dismissed. The row stays so a lead scored against it keeps its provenance; it just stops being offered.';

alter table icp_generations
  add constraint icp_generations_recommended_icp_id_fkey
  foreign key (recommended_icp_id) references icp_profiles(id) on delete set null;

-- "Show me this batch": the query the ICP page runs.
create index if not exists icp_profiles_generation_idx
  on icp_profiles (workspace_id, generation_id) where generation_id is not null;
