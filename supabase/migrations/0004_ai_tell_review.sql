-- supabase/migrations/0004_ai_tell_review.sql
-- findAiTells has always been able to name the things that make a draft read
-- as machine-written, but nothing ran it on the way to the queue, so a draft
-- that broke the rules was queued anyway and nobody could see that it had.
-- Wiring the check in needs two places to put the answer:
--
--  1. On the action, for the draft a human is about to approve or send. The
--     runtime spends a corrective retry on a draft with tells; if the retry
--     still trips a rule the draft is kept rather than binned, and this column
--     is what stops "kept" from meaning "shipped silently". Null is the honest
--     value for an action written before this existed, or by an agent that
--     declares no review, and it reads differently from an empty array, which
--     means the copy was checked and came back clean.
--
--  2. On the run, as a count, so copy quality is a series rather than an
--     anecdote: tells per run over time is the only way to tell whether a
--     prompt change actually helped.

alter table actions
  add column if not exists ai_tells jsonb;

comment on column actions.ai_tells is
  'Style rules this draft still breaks after its corrective retry: [{"rule":"...","found":"..."}]. Empty array = checked and clean. Null = never checked (pre-review action, or an agent with no reviewOutput).';

alter table agent_runs
  add column if not exists ai_tell_count int;

comment on column agent_runs.ai_tell_count is
  'How many style tells the draft from this call carried. Null where the agent declares no review, so an unchecked run never counts as a clean one.';

-- "Tells per run, by agent, by week": the query this column exists for.
create index if not exists agent_runs_tell_count_idx
  on agent_runs (workspace_id, agent, created_at desc)
  where ai_tell_count is not null;
