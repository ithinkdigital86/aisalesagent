-- supabase/migrations/0007_business_profile_field_origins.sql
-- The business profile form can now be drafted two ways: read from the
-- company's website, with a quote behind every entry, or, when the site
-- cannot be read, guessed by a model from the company name and domain. A
-- profile built the second way is not research, and everything downstream
-- (the ICP strategist most of all) has to be able to tell the two apart.
--
-- So each field the form can draft carries an origin:
--
--   'manual'       the owner typed it
--   'from_website' accepted from the website reader, quote-checked
--   'inferred'     accepted from the guesser: unverified until the owner
--                  checks it, and shown as such wherever the profile is read
--
-- One jsonb map rather than seven columns: {"services": "inferred", ...}.
-- A field not in the map is manual. The map is validated so a value outside
-- the three, or a key that is not a draftable field, is refused at the row.
--
-- The guesser is an agent like the others, so it gets its own slug.

create or replace function business_profile_origins_valid(origins jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(origins) = 'object'
    and not exists (
      select 1
      from jsonb_each_text(origins) as entry(key, value)
      where entry.key not in (
          'description', 'services', 'industries_served', 'customer_types',
          'problems_solved', 'differentiators', 'exclusions'
        )
        or entry.value not in ('manual', 'from_website', 'inferred')
    );
$$;

alter table business_profiles
  add column if not exists field_origins jsonb not null default '{}'::jsonb;

alter table business_profiles
  drop constraint if exists business_profiles_field_origins_check;
alter table business_profiles
  add constraint business_profiles_field_origins_check
  check (business_profile_origins_valid(field_origins));

comment on column business_profiles.field_origins is
  'Where each draftable field''s text came from: ''manual'' (typed), ''from_website'' (accepted from the website reader, quote-checked) or ''inferred'' (accepted from the guesser: a model''s guess from the company name and domain, unverified). Keys are the snake_case column names; a field not present is manual. Survives editing: it says where the text came from, not who last touched it.';

alter type agent_slug add value if not exists 'profile_guesser';
