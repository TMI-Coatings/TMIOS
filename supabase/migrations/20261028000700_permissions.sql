-- Permission changes (Austin, Oct 27).
-- * The scheduler sets job leader, crew size and projected hours.
-- * The job's named estimator signs the estimator step whatever their role (Scott Salmon has
--   PM rights and estimates too). "Also estimates" puts someone on the estimator pick list.
-- * Leaders, crew and estimators see hours only: the dollar columns on jobs are served only
--   through job_money(), and money rows in the change log are hidden from them.

create or replace function app.can_edit(p_field text, p_leader uuid, p_rep text, p_pm text) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r public.app_role := app.my_role();
  any_roles public.app_role[];
  own_roles public.app_role[] := '{}';
begin
  if r is null then return false; end if;
  case p_field
    when 'plan' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm}';
    when 'start' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm}';
    when 'projectedFinish' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm,superintendent}';
    when 'crewSize' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{superintendent}';
    when 'leaderId' then any_roles := '{admin,ceo,cfo,scheduler}';
    when 'projectedHrs' then any_roles := '{admin,ceo,cfo,scheduler}';
    when 'mustFinish' then any_roles := '{admin,ceo,cfo}';
    when 'firmness' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm,sales_rep}';
    when 'status' then any_roles := '{admin,ceo,cfo,scheduler}';
    when 'actualFinish' then any_roles := '{admin,ceo,cfo,scheduler}';
    when 'site' then any_roles := '{admin,ceo,cfo,scheduler}';
    when 'intake' then any_roles := '{admin,ceo,cfo,job_setup}';
    when 'crew' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{superintendent}';
    when 'notes' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{superintendent}';
    when 'pinNotes' then any_roles := '{admin,ceo,cfo}';
    when 'actuals' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm}';
    when 'percent' then any_roles := '{admin,ceo,cfo}'; own_roles := '{pm}';
    when 'changeOrders' then any_roles := '{admin,ceo,cfo,job_setup}'; own_roles := '{pm}';
    when 'milestones' then any_roles := '{admin,ceo,cfo,scheduler}'; own_roles := '{pm}';
    else return false;
  end case;
  return r = any (any_roles) or (r = any (own_roles) and app.owns(p_leader, p_rep, p_pm));
end
$$;

create or replace function app.wo_is_mine(j public.jobs, p_step integer) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.auth_user_id = auth.uid() and u.active and (
    (p_step = 0 and u.name = j.estimator) or
    (p_step = 1 and u.role = 'sales_rep' and u.rep_code = j.rep_code) or
    (p_step = 2 and u.role = 'pm' and u.pm_code = j.pm_code) or
    (p_step = 3 and u.role = 'scheduler')))
$$;

alter table public.app_users add column also_estimator boolean not null default false;

create or replace function public.staff_names() returns jsonb
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.is_member() then jsonb_build_object(
    'schedulers', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'scheduler' and active), '[]'::jsonb),
    'jobSetup', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'job_setup' and active), '[]'::jsonb),
    'estimators', coalesce((select jsonb_agg(name order by name) from public.app_users where (role = 'estimator' or also_estimator) and active), '[]'::jsonb)) end
$$;

-- Dollar columns on jobs.
revoke select on public.jobs from authenticated;
grant select (id, number, customer, job_type, location, rep_code, pm_code, estimator, leader_id, crew_size, estimate_hrs, projected_hrs, start, projected_finish, baseline_finish, must_finish, must_finish_reason, actual_finish, status, firmness, waits_on_job_id, firmness_reason, hold_reason, hold_until, exterior, billing_method, retainage_pct, retainage_release, retainage_release_note, customer_po, bill_to, lien_waivers, certified_payroll, site_address, site_start_time, site_contact, site_orientation, site_ppe, active, created_at, created_by, updated_at, updated_by) on public.jobs to authenticated;

create function public.job_money() returns table (job_id uuid, contract_cents bigint, material_cost_cents bigint, material_revenue_cents bigint, burdened_rate_cents bigint)
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, j.contract_cents, j.material_cost_cents, j.material_revenue_cents, j.burdened_rate_cents
    from public.jobs j
   where app.sees_money() and app.can_see(j.leader_id, j.rep_code, j.pm_code)
$$;
revoke all on function public.job_money() from public, anon;
grant execute on function public.job_money() to authenticated;

-- The change log: office staff see everything; others see changes on jobs they can see, without
-- dollar figures unless their role sees money.
drop policy read on public.change_log;
create policy read on public.change_log for select to authenticated using (
  app.role_in('admin', 'ceo', 'cfo', 'scheduler')
  or (job_id is not null and app.can_see_job(job_id)
      and (app.sees_money()
           or (table_name not in ('percent_complete', 'change_orders', 'milestones', 'invoices', 'retainage_receipts')
               and field not in ('contract_cents', 'material_cost_cents', 'material_revenue_cents', 'burdened_rate_cents', 'billing_method', 'retainage_pct')
               and not (table_name = 'jobs' and field = 'added')))));

revoke all on all functions in schema app from public;
