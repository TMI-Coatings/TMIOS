-- Sales reps and PMs see every job, with money (Austin, Oct 27, decision 6a). Reps share
-- customers across territories. What they may change is unchanged: their own jobs only.

create or replace function app.can_see(p_leader uuid, p_rep text, p_pm text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup', 'estimator', 'pm', 'sales_rep', 'accounting')
      or app.owns(p_leader, p_rep, p_pm)
$$;

-- PMs read the whole leader scorecard; they still tag causes on their own jobs only.
drop policy read on public.closeout_outcomes;
create policy read on public.closeout_outcomes for select to authenticated using (
  app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'pm')
  or (app.role_in('superintendent') and leader_id = (select person_id from public.app_users where auth_user_id = auth.uid() and active)));

-- Alerts stay routed to the people they concern. PMs and reps now also get billing alerts
-- on their own jobs, as in the demo.
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
    when 'pm' then return p_rule = 'digest' or (p_rule = 'wo' and u.name = any (p_to)) or j.pm_code = u.pm_code;
    when 'sales_rep' then return p_rule in ('open', 'digest') or (p_rule = 'wo' and u.name = any (p_to)) or j.rep_code = u.rep_code;
    when 'superintendent' then return p_rule = 'digest' or (p_rule not in ('bill', 'wo') and j.leader_id = u.person_id) or (p_rule = 'cert' and my_person_name = any (p_to));
    when 'field_crew' then return (p_rule = 'cert' and my_person_name = any (p_to))
      or (p_rule not in ('bill', 'wo') and exists (select 1 from public.assignments a where a.job_id = p_job and a.person_id = u.person_id and a.active
                                                 and a.week in (app.planning_week(), app.planning_week() + 7)));
    else return false;
  end case;
end
$$;
