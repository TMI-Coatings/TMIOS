-- Leftovers from the demo review (Oct 27): part payments of retainage, a reminder for stuck
-- work orders, and stages that can't be retired while their checkpoints are in use.

-- Retainage the customer paid: all that's outstanding by default, or part of it.
drop function public.record_retainage_received(uuid);
create function public.record_retainage_received(p_job uuid, p_amount bigint default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.jobs;
  outstanding numeric;
  amt numeric;
begin
  select * into j from public.jobs where id = p_job;
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin records retainage' using errcode = '42501'; end if;
  outstanding := app.retainage_outstanding_cents(j);
  if outstanding <= 0 then raise exception 'No retainage outstanding on this job' using errcode = '23514'; end if;
  amt := coalesce(p_amount, outstanding);
  if amt <= 0 or amt > outstanding then raise exception 'Enter an amount up to the % outstanding', app.usd(outstanding) using errcode = '23514'; end if;
  insert into public.retainage_receipts (job_id, amount_cents, received_on, recorded_by) values (p_job, amt, app.today(), app.me_name());
end
$$;
revoke all on function public.record_retainage_received(uuid, bigint) from public, anon;
grant execute on function public.record_retainage_received(uuid, bigint) to authenticated;

-- Nudge whoever a stuck work order waits on, once a day. Same words as woReminder in
-- src/domain/workOrders.ts.
create function public.wo_remind(p_job uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.jobs;
  w public.work_orders;
  st text;
  lori boolean;
  who text;
  what text;
  rcpt text[];
  days integer;
  k text;
begin
  select * into j from public.jobs where id = p_job;
  select * into w from public.work_orders where job_id = p_job and active;
  if not found or j.status = 'complete' or w.final then raise exception 'This work order isn''t waiting on anyone' using errcode = '23514'; end if;
  st := app.wo_status(w);
  lori := st in ('Awaiting draft', 'Returned');
  if not (app.role_in('admin', 'ceo', 'cfo', 'scheduler') or (app.role_in('job_setup') and not lori) or (app.role_in('pm') and j.pm_code = (select pm_code from public.app_users where auth_user_id = auth.uid() and active)))
     or (not lori and app.wo_is_mine(j, w.current_step)) then
    raise exception 'Only job setup, the scheduler, the job''s PM or an admin sends reminders, and only while it''s waiting on someone else' using errcode = '42501';
  end if;
  k := 'wo-remind|' || p_job || '|' || app.today();
  if exists (select 1 from public.alert_state where key = k) then raise exception 'Already reminded today' using errcode = '23514'; end if;
  insert into public.alert_state (key, value) values (k, 'sent');
  days := greatest(0, app.today() - w.since);
  rcpt := case when lori then app.job_setup_names()
               when w.current_step = 3 then coalesce((select array_agg(name order by name) from public.app_users where role = 'scheduler' and active), array['Scheduler'])
               else array[app.wo_step_who(j, w.current_step)] end;
  who := case when lori then array_to_string(app.job_setup_names(), ', ')
              else (case w.current_step when 0 then 'Estimator ' when 1 then 'Rep ' when 2 then 'PM ' else 'Scheduler ' end) || app.wo_step_who(j, w.current_step) end;
  what := case st when 'Awaiting draft' then 'the draft' when 'Returned' then 'the revised draft' else lower(app.wo_step_what(w.current_step)) end;
  perform app.post_alert('wo', 'Reminder: work order for ' || j.number || ' ' || j.customer,
    'Waiting ' || days || ' day' || case when days = 1 then '' else 's' end || ' on ' || who || ' for ' || what || '. Job starts ' || app.d(j.start)
      || E'.\nReminded by ' || app.me_name() || '.', rcpt, p_job);
  perform app.wo_event(p_job, 'Reminder sent to ' || array_to_string(rcpt, ', ') || '.');
end
$$;
revoke all on function public.wo_remind(uuid) from public, anon;
grant execute on function public.wo_remind(uuid) to authenticated;

-- A stage can only be retired once its checkpoints are moved or retired.
create function app.stage_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.active and not new.active and exists (select 1 from public.journey_checkpoints where stage_key = new.key and active) then
    raise exception 'Move or retire this stage''s checkpoints first' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger stage_guard before update on public.journey_stages for each row execute function app.stage_guard();

revoke all on all functions in schema app from public;
