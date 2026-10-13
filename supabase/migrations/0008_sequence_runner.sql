-- supabase/migrations/0008_sequence_runner.sql
-- The sequences table has existed since 0001 and nothing ever drove it: a
-- lead got one email and the thread ended there. This migration adds the two
-- pieces of state a runner needs on the lead, and turns the shape of
-- sequences.steps from a comment into a constraint.
--
-- Two columns on leads, because a sequence position is per lead, not per
-- sequence:
--
--   sequence_step           the highest step number already queued for this
--                           lead. 0 means enrolled but nothing sent yet, so
--                           the next step to run is always this + 1.
--   sequence_stopped_reason why the run ended: 'reply', 'unsubscribed',
--                           'hard_bounce', 'complaint', 'suppressed',
--                           'stage:won', 'completed', 'sequence_inactive'.
--                           Null means the sequence is still running, and
--                           that is also the flag that decides who owns the
--                           lead's next_action_at: a running sequence owns
--                           it, and a stopped one hands the lead back to the
--                           Follow-up manager.
--
-- The cap lives here as well as in the code. Four steps is a rule about what
-- a person receives, not a detail of one code path, and a fifth row written
-- by a script or by hand is exactly the case the application check cannot
-- see. The lower bound is deliberately absent: sequences.steps defaults to
-- '[]' and rows created before this migration carry it, so the database
-- accepts an empty sequence (the runner reads it as finished) while the save
-- action refuses to write one.

create or replace function sequence_steps_valid(steps jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) <= 4
    and not exists (
      select 1
      from jsonb_array_elements(steps) with ordinality as entry(item, ordinal)
      where jsonb_typeof(entry.item) <> 'object'
        -- Steps are ordered by their position in the array, and step numbers
        -- have to agree with it, or "step 2 of 4" means nothing.
        or entry.item->>'step' is distinct from entry.ordinal::text
        or entry.item->>'channel' not in ('email', 'sms', 'voice', 'linkedin', 'instagram')
        -- Text comparisons rather than casts: `or` does not short-circuit in
        -- a predictable order here, so a cast guarded by a sibling test can
        -- still run on the bad value and raise instead of returning false.
        or coalesce(entry.item->>'delay_days', '') !~ '^[0-9]{1,3}$'
        or coalesce(entry.item->>'requires_approval', '') not in ('true', 'false')
    );
$$;

alter table sequences
  drop constraint if exists sequences_steps_check;
alter table sequences
  add constraint sequences_steps_check check (sequence_steps_valid(steps));

comment on column sequences.steps is
  'Ordered steps, at most four: [{"step":1,"channel":"email","delay_days":0,"requires_approval":false}, ...]. step must equal the 1-based position. delay_days is counted from the previous step''s send, so step 1 is normally 0.';

alter table leads
  add column if not exists sequence_step int not null default 0;

alter table leads
  drop constraint if exists leads_sequence_step_check;
alter table leads
  add constraint leads_sequence_step_check check (sequence_step between 0 and 4);

comment on column leads.sequence_step is
  'Highest step of the assigned sequence already queued for this lead. 0 = enrolled, nothing queued yet. The next step to run is always this + 1, capped at 4.';

alter table leads
  add column if not exists sequence_stopped_reason text;

comment on column leads.sequence_stopped_reason is
  'Why the assigned sequence stopped, or null while it is still running. A running sequence owns the lead''s next_action_at; once this is set the Follow-up manager takes the lead back.';

-- The runner's query: leads on a live sequence whose next step is due.
create index if not exists leads_sequence_due_idx
  on leads (next_action_at)
  where assigned_sequence_id is not null
    and sequence_stopped_reason is null
    and next_action_at is not null;
