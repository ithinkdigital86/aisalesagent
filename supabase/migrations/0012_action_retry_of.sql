-- supabase/migrations/0012_action_retry_of.sql
-- An explicit link from a retried send to the send it retries.
--
-- When a sequence step's email fails at Resend, the runner queues the same
-- message again as a new actions row, and stops the run after the step has
-- failed three times. Until now the rows of one step's retries were found by
-- matching their body text, which held only as long as nothing ever rewrote a
-- failed row's body. retry_of says it directly: a retry row points at the
-- failed row it was queued to replace, so a step's failures are the chain
-- from its newest row back through retry_of. A fresh draft (step one of a
-- re-enrolment, say) has no retry_of, so an earlier enrolment's failures are
-- never counted against it.
--
-- on delete set null rather than cascade: deleting one row must not take its
-- retries with it. A broken link only shortens the count, which means at most
-- one more retry, never a lost stop.
--
-- Apply before deploying the code that reads it. The runner selects the
-- column for every lead past step one, and without it each such lead fails
-- its read and is looked at again the next day: nothing is sent and nothing
-- is lost, but no sequence moves. The reverse order is safe.

alter table actions
  add column if not exists retry_of uuid references actions(id) on delete set null;

alter table actions
  drop constraint if exists actions_retry_of_not_self;
alter table actions
  add constraint actions_retry_of_not_self check (retry_of is distinct from id);

-- For the foreign key's own checks when a row is deleted; few rows have one.
create index if not exists actions_retry_of_idx
  on actions (retry_of)
  where retry_of is not null;

comment on column actions.retry_of is
  'The failed action this row was queued to retry, or null for a first attempt. A step''s failures are counted along this chain; the run stops after three.';
