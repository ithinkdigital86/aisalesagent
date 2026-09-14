-- supabase/migrations/0003_lead_source_and_consent_attestation.sql
-- CSV lead import needs two things the schema did not carry:
--
--  1. Provenance on the lead itself. sourcing_run_id says which run created a
--     lead, but not what the row was in the system it came from. A CSV import
--     is the first source where the operator hands us an external identifier
--     (Apollo Contact Id) worth keeping, so source + source_record_id become
--     real columns rather than something buried in raw.
--
--  2. Attribution on the consent record. An imported list has no consent until
--     a human declares a basis for it, and a declaration nobody signed is not
--     an audit artefact. attested_by/attested_at name who made the claim and
--     when, alongside the source_description that says what the claim is.

alter table leads
  add column if not exists source text,
  add column if not exists source_record_id text;

comment on column leads.source is
  'Where this lead came from: ''apollo'' | ''csv_import'' | ''inbound'' | ... Mirrors sourcing_runs.source for leads created by a run.';
comment on column leads.source_record_id is
  'The lead''s primary key in the system it came from, when that system gave us one (e.g. Apollo Contact Id). Free text: it is for tracing, never for joining.';

-- Tracing lookup: "show me everything that came out of this export".
create index if not exists leads_source_idx
  on leads (workspace_id, source, source_record_id) where source is not null;

-- Leads created before this migration already know their run, and the run
-- already knows its source, so the column can be filled in without guessing.
update leads l
   set source = r.source
  from sourcing_runs r
 where l.sourcing_run_id = r.id
   and l.source is null;

alter table consent_records
  add column if not exists attested_by uuid references auth.users(id) on delete set null,
  add column if not exists attested_at timestamptz;

comment on column consent_records.attested_by is
  'The user who declared this basis, for records a human asserted rather than the system observing (a list import). Null for system-captured consent such as an inbound enquiry.';
comment on column consent_records.attested_at is
  'When that declaration was made. Distinct from captured_at, which is when the consent itself was given.';

create index if not exists consent_attested_idx
  on consent_records (workspace_id, attested_by, attested_at desc)
  where attested_by is not null;
