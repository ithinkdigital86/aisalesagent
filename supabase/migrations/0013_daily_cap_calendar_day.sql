-- supabase/migrations/0013_daily_cap_calendar_day.sql
-- The daily send cap counts the calendar day in India, not a rolling 24 hours.
--
-- The send-queue cron runs once a day at the same time (09:00 IST,
-- vercel.json). Its sends land a few seconds into the run, so when the next
-- day's run starts they are a few seconds short of 24 hours old and still in
-- a rolling window. A workspace that reached its cap on one run had no room
-- on the next, and sent only every other day. Counted from the start of today
-- in Asia/Kolkata, yesterday's sends have all left by the next run. This is
-- the rule the application already uses for a step's delay and for every
-- deferral, for the same reason.
--
-- The zone is DISPLAY_TIME_ZONE in lib/cadence/sequence.ts. Change both
-- together; the dashboard's count of today's sends is read from there.
--
-- Only the count changes. The lock that takes claims one at a time, the
-- answers, and the grants are as in 0011. A row in 'sending' claimed today
-- still counts, since whether it went out is unknown; a row stuck there
-- stops counting when its day ends, as a send does, where it used to stop
-- 24 hours after its claim.
--
-- What a calendar day allows that a rolling window did not: the cap late one
-- evening and the cap again just after midnight. The cron runs at 09:00, so
-- only manual "Process send queue" passes either side of midnight can do it.
--
-- Deploy order: apply this before deploying the code that reads the window
-- by calendar day. Either order is safe, in that neither lets out more than a
-- calendar day's cap. The code alone, against 0011, looks ahead by calendar
-- day and asks for claims the old function refuses: those rows stay queued as
-- now, but the dashboard shows room the claim does not give, and the
-- sequence runner drafts steps that wait in the queue. This alone, under the
-- old code, changes nothing until the code is deployed: the old look-ahead
-- still skips a workspace whose last 24 hours are full.

comment on column workspaces.daily_send_cap is
  'Most emails sent in one calendar day in Asia/Kolkata. 0 sends nothing. Reaching it defers the rest; they stay queued.';

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
  v_day_start timestamptz;
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

  -- Midnight today in India, whatever the session's time zone: the wall
  -- clock there, truncated to the day, read back as an instant.
  v_day_start := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';

  select count(*)
    into v_used
    from actions
   where workspace_id = v_workspace
     and channel = 'email'
     and (
       sent_at >= v_day_start
       or (status = 'sending' and updated_at >= v_day_start)
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
