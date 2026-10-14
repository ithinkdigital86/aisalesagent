-- supabase/migrations/0011_automation_safety.sql
-- Limits on unattended sending. Sequences now run from the cron with nobody
-- watching, so a workspace needs three controls that hold whatever the
-- runner, the queue or a script does:
--
--   sending_paused   the kill switch. While it is true no email is claimed
--                    for sending, the send queue and the sequence runner skip
--                    the workspace, and the cron routes leave it alone.
--                    Queued rows stay queued and go out once it is cleared.
--   daily_send_cap   emails sent in a rolling 24 hours. Reaching it defers:
--                    the row stays queued and is sent by a later pass once
--                    the oldest send in the window ages out.
--   min_fit_score    leads below it are not drafted to or put on a sequence.
--                    An unscored lead never passes, whatever the threshold.
--
-- The pause and the cap are enforced by claim_email_send below, in the same
-- statement that claims the row, not by a read the application makes first.
-- A check made before the claim is a race: two passes that both read
-- "49 of 50" would both send. The function locks the workspace row, so claims
-- in one workspace are taken one at a time and the count each one reads
-- includes the claim before it.

alter table workspaces
  add column if not exists sending_paused boolean not null default false,
  add column if not exists sending_paused_at timestamptz,
  add column if not exists sending_paused_by uuid references auth.users(id) on delete set null,
  add column if not exists daily_send_cap int not null default 50,
  add column if not exists min_fit_score int not null default 60;

alter table workspaces
  drop constraint if exists workspaces_daily_send_cap_check;
alter table workspaces
  add constraint workspaces_daily_send_cap_check check (daily_send_cap between 0 and 10000);

alter table workspaces
  drop constraint if exists workspaces_min_fit_score_check;
alter table workspaces
  add constraint workspaces_min_fit_score_check check (min_fit_score between 0 and 100);

comment on column workspaces.sending_paused is
  'Kill switch. While true no email is claimed for sending and the automation passes skip this workspace. Queued rows wait; nothing is discarded.';
comment on column workspaces.sending_paused_at is
  'When the kill switch was last turned on. Kept when it is turned off, as the record of the last pause.';
comment on column workspaces.sending_paused_by is
  'Who last turned the kill switch on.';
comment on column workspaces.daily_send_cap is
  'Most emails sent in any rolling 24 hours. 0 sends nothing. Reaching it defers the rest; they stay queued.';
comment on column workspaces.min_fit_score is
  'Leads scoring below this are not drafted to or enrolled on a sequence. Unscored leads never pass.';

-- The window count: emails that left, by when they left. Rows still in
-- 'sending' are counted as well (see below), through the second index.
create index if not exists actions_email_sent_window_idx
  on actions (workspace_id, sent_at)
  where channel = 'email' and sent_at is not null;

-- In-flight claims, for the window count and for the dashboard's count of
-- rows stuck in 'sending'. updated_at is the time of the claim: the claim is
-- the update that put the row in this state.
create index if not exists actions_sending_idx
  on actions (workspace_id, updated_at)
  where status = 'sending';

-- ---------------------------------------------------------------
-- The claim
-- ---------------------------------------------------------------
--
-- Replaces the bare update the adapter used to claim a row (0010). Answers
-- one of:
--
--   claimed            the row is now 'sending' and the caller sends it
--   already_claimed    the row is not queued: another pass has it, or it has
--                      gone, or it is not an email
--   sending_paused     kill switch on; the row is left queued
--   daily_cap_reached  the window is full; the row is left queued
--   not_found          no such action
--
-- A row in 'sending' counts against the window. Its send may have happened,
-- and a cap that ignored in-flight rows would let a burst of concurrent
-- claims through. A row stuck there (the process died mid-send) stops
-- counting once it is 24 hours old, like a send would.
--
-- Security invoker, and only the service role may call it. The queue and the
-- runner run under the service role; a signed-in user has no reason to claim
-- a row, and one who could would be able to strand it in 'sending'.

create or replace function claim_email_send(p_action_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status action_status;
  v_channel channel;
  v_paused boolean;
  v_cap int;
  v_used int;
begin
  select workspace_id, status, channel
    into v_workspace, v_status, v_channel
    from actions
   where id = p_action_id;
  if v_workspace is null then
    return 'not_found';
  end if;
  if v_status <> 'queued' or v_channel <> 'email' then
    return 'already_claimed';
  end if;

  -- One claim at a time per workspace. Held to the end of this call's
  -- transaction, so the count below cannot be read by two claims at once.
  select sending_paused, daily_send_cap
    into v_paused, v_cap
    from workspaces
   where id = v_workspace
     for update;

  if v_paused then
    return 'sending_paused';
  end if;

  select count(*)
    into v_used
    from actions
   where workspace_id = v_workspace
     and channel = 'email'
     and (
       sent_at >= now() - interval '24 hours'
       or (status = 'sending' and updated_at >= now() - interval '24 hours')
     );

  if v_used >= v_cap then
    return 'daily_cap_reached';
  end if;

  update actions
     set status = 'sending'
   where id = p_action_id
     and status = 'queued';
  if not found then
    return 'already_claimed';
  end if;

  return 'claimed';
end;
$$;

revoke all on function claim_email_send(uuid) from public, anon, authenticated;
grant execute on function claim_email_send(uuid) to service_role;
