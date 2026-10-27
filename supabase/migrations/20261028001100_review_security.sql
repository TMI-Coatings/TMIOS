-- Security fixes from the independent review (Oct 27).

-- 1. Leaders read their own closeout rows, but contract value and margin only reach the roles
--    that see money, through outcome_money(), as job dollars do through job_money().
revoke select on public.closeout_outcomes from authenticated;
grant select (id, job_id, number, customer, job_type, leader_id, pm_code, finished_on, estimate_hrs, actual_hrs, on_time, cause, illustrative, created_at, created_by, updated_at, updated_by) on public.closeout_outcomes to authenticated;

create function public.outcome_money() returns table (id uuid, contract_cents bigint, gp_bid numeric, gp_final numeric)
  language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.contract_cents, o.gp_bid, o.gp_final
    from public.closeout_outcomes o
   where app.sees_money() and app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'pm')
$$;
revoke all on function public.outcome_money() from public, anon;
grant execute on function public.outcome_money() to authenticated;

-- 2. The change log hides closeout and month-end WIP rows from roles that don't see money.
drop policy read on public.change_log;
create policy read on public.change_log for select to authenticated using (
  app.role_in('admin', 'ceo', 'cfo', 'scheduler')
  or (job_id is not null and app.can_see_job(job_id)
      and (app.sees_money()
           or (table_name not in ('percent_complete', 'change_orders', 'milestones', 'invoices', 'retainage_receipts', 'closeout_outcomes', 'wip_snapshots')
               and field not in ('contract_cents', 'material_cost_cents', 'material_revenue_cents', 'burdened_rate_cents', 'billing_method', 'retainage_pct')
               and not (table_name = 'jobs' and field = 'added')))));

-- 3. PMs and reps tick journey checkpoints only on their own jobs (decision 6a: they see every
--    job but change only their own). Without this, any PM could fake the customer sign-off.
create or replace function app.can_check(p_job uuid, p_key text) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.journey_checkpoints;
  r public.app_role := app.my_role();
begin
  select * into c from public.journey_checkpoints where key = p_key and active;
  if not found or c.auto_source is not null or r is null or not app.can_see_job(p_job) then return false; end if;
  if r in ('admin', 'ceo', 'cfo') then return true; end if;
  return case c.owner
    when 'scheduler' then r = 'scheduler'
    when 'job_setup' then r = 'job_setup'
    when 'accounting' then r = 'accounting'
    when 'pm' then r = 'pm' and exists (select 1 from public.jobs j join public.app_users u on u.auth_user_id = auth.uid() and u.active
                                         where j.id = p_job and u.pm_code = j.pm_code)
    when 'sales_rep' then r = 'sales_rep' and exists (select 1 from public.jobs j join public.app_users u on u.auth_user_id = auth.uid() and u.active
                                                       where j.id = p_job and u.rep_code = j.rep_code)
    else false
  end;
end
$$;

-- 4. The estimator step is signed by the job's named estimator only if they are an estimator or
--    marked "Also estimates"; job setup can't name herself estimator and sign.
create or replace function app.wo_is_mine(j public.jobs, p_step integer) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.auth_user_id = auth.uid() and u.active and (
    (p_step = 0 and u.name = j.estimator and (u.role = 'estimator' or u.also_estimator)) or
    (p_step = 1 and u.role = 'sales_rep' and u.rep_code = j.rep_code) or
    (p_step = 2 and u.role = 'pm' and u.pm_code = j.pm_code) or
    (p_step = 3 and u.role = 'scheduler')))
$$;

-- 5. Jobs are only added through create_job, which works out the frozen split, rate and baseline.
drop policy write on public.jobs;
revoke insert on public.jobs from authenticated;

-- 6. Notes carry the real author; only roles that may pin can add a pinned note.
create function app.note_author() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then new.author_name := app.me_name(); end if;
  return new;
end
$$;
create trigger note_author before insert on public.job_notes for each row execute function app.note_author();
drop policy write on public.job_notes;
create policy write on public.job_notes for insert to authenticated
  with check (app.can_edit_job(job_id, 'notes') and (not pinned or app.can_edit_job(job_id, 'pinNotes')));

revoke all on all functions in schema app from public;
