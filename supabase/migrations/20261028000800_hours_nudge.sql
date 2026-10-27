-- The scheduler's "who hasn't entered hours" list and nudge (Austin, Oct 27).

alter table public.alerts drop constraint alerts_rule_check;
alter table public.alerts add constraint alerts_rule_check check (rule in ('wo', 'bill', 'open', 'date', 'overrun', 'crew', 'gap', 'digest', 'cert', 'hours'));

create or replace function app.can_see_alert(p_rule text, p_job uuid, p_to text[]) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.app_users;
  j public.jobs;
  my_person_name text;
begin
  select * into u from public.app_users where auth_user_id = auth.uid() and active;
  if not found then return false; end if;
  if u.role in ('admin', 'ceo', 'cfo') then return true; end if;
  if p_job is not null then select * into j from public.jobs where id = p_job; end if;
  my_person_name := (select name from public.people where id = u.person_id);
  case u.role
    when 'scheduler' then return p_rule <> 'bill';
    when 'accounting' then return p_rule in ('bill', 'digest');
    when 'job_setup' then return p_rule = 'digest' or (p_rule = 'wo' and u.name = any (p_to));
    when 'estimator' then return p_rule = 'wo' and u.name = any (p_to);
    when 'pm' then return p_rule = 'digest' or (p_rule in ('wo', 'hours') and u.name = any (p_to)) or (p_rule <> 'hours' and j.pm_code = u.pm_code);
    when 'sales_rep' then return p_rule in ('open', 'digest') or (p_rule = 'wo' and u.name = any (p_to)) or j.rep_code = u.rep_code;
    when 'superintendent' then return p_rule = 'digest' or (p_rule not in ('bill', 'wo') and j.leader_id = u.person_id) or (p_rule = 'cert' and my_person_name = any (p_to));
    when 'field_crew' then return (p_rule = 'cert' and my_person_name = any (p_to))
      or (p_rule not in ('bill', 'wo') and exists (select 1 from public.assignments a where a.job_id = p_job and a.person_id = u.person_id and a.active
                                                 and a.week in (app.planning_week(), app.planning_week() + 7)));
    else return false;
  end case;
end
$$;

-- A nudge to one PM listing their jobs still without hours for the week. Same words as
-- nudgeAlert in src/domain/close.ts.
create function public.nudge_hours(p_pm text, p_week date) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines text;
  n integer;
  pm text := (select name from public.project_managers where code = p_pm);
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler') then
    raise exception 'Only the scheduler or an admin sends hours reminders' using errcode = '42501';
  end if;
  select count(*), string_agg(j.number || ' ' || j.customer, ', ' order by j.number) into n, lines
    from public.jobs j
   where j.active and j.status <> 'complete' and j.start <= p_week and j.pm_code = p_pm
     and not exists (select 1 from public.hour_entries e where e.job_id = j.id and e.week = p_week and e.active);
  if n = 0 then raise exception 'That PM''s hours are all in' using errcode = '23514'; end if;
  perform app.post_alert('hours', 'Hours needed: week ending ' || app.d(p_week),
    'Enter this week’s hours before the close: ' || lines || E'.\nSent by ' || app.me_name() || '.', array[coalesce(pm, p_pm)]);
  return n;
end
$$;
revoke all on function public.nudge_hours(text, date) from public, anon;
grant execute on function public.nudge_hours(text, date) to authenticated;

revoke all on all functions in schema app from public;
