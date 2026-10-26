-- TMI Ops, Phase 1: functions the app calls.

-- First sign-in: link the Microsoft account to the app_users row an admin created for that
-- email. Unknown emails get nothing; an admin has to add them first.
create function public.claim_app_user() returns setof public.app_users
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or em = '' then return; end if;
  update public.app_users set auth_user_id = auth.uid()
   where email = em and auth_user_id is null and active;
  return query select * from public.app_users where auth_user_id = auth.uid() and active;
end
$$;

-- Add a sold job from the estimate in one step: the job, its requirements and an optional
-- note. The material/labor split is computed here at the current burdened rate and frozen.
create function public.create_job(p jsonb) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_id uuid;
  rate bigint := (select (value #>> '{}')::bigint from public.settings where key = 'burdenedRateCents');
  contract bigint := (p ->> 'contractCents')::bigint;
  matcost bigint := coalesce((p ->> 'materialCostCents')::bigint, 0);
  est integer := (p ->> 'estimateHrs')::integer;
  q text;
begin
  if not app.role_in('admin', 'ceo', 'scheduler', 'job_setup') then
    raise exception 'You can''t add jobs' using errcode = '42501';
  end if;
  insert into public.jobs (
    number, customer, job_type, location, rep_code, pm_code, estimator, leader_id, crew_size,
    estimate_hrs, projected_hrs, contract_cents, material_cost_cents, material_revenue_cents,
    start, projected_finish, baseline_finish, must_finish, must_finish_reason, status, firmness,
    waits_on_job_id, exterior, billing_method, retainage_pct, retainage_release, retainage_release_note,
    site_address, site_start_time, site_contact, site_orientation, site_ppe)
  values (
    p ->> 'number', p ->> 'customer', coalesce(p ->> 'jobType', ''), coalesce(p ->> 'location', ''),
    p ->> 'repCode', p ->> 'pmCode', p ->> 'estimator', (p ->> 'leaderId')::uuid,
    coalesce((p ->> 'crewSize')::integer, 4), est, est, contract, matcost,
    case when matcost + est::bigint * rate > 0 then round(contract::numeric * matcost / (matcost + est::bigint * rate))::bigint else 0 end,
    (p ->> 'start')::date, (p ->> 'projectedFinish')::date, (p ->> 'projectedFinish')::date,
    (p ->> 'mustFinish')::date, (p ->> 'mustFinishReason')::public.must_finish_reason,
    coalesce((p ->> 'status')::public.job_status, 'scheduled'), (p ->> 'firmness')::public.firmness,
    (p ->> 'waitsOnJobId')::uuid, coalesce((p ->> 'exterior')::boolean, false),
    coalesce((p ->> 'billingMethod')::public.billing_method, 'final'),
    coalesce((p ->> 'retainagePct')::numeric, 0), (p ->> 'retainageRelease')::public.retainage_release,
    nullif(p ->> 'retainageReleaseNote', ''),
    coalesce(p ->> 'siteAddress', ''), coalesce(p ->> 'siteStartTime', ''), coalesce(p ->> 'siteContact', ''),
    coalesce(p ->> 'siteOrientation', ''), coalesce(p ->> 'sitePpe', ''))
  returning id into new_id;

  for q in select jsonb_array_elements_text(coalesce(p -> 'requirements', '[]'::jsonb)) loop
    insert into public.job_requirements (job_id, qualification) values (new_id, q);
  end loop;

  if coalesce(trim(p ->> 'note'), '') <> '' then
    insert into public.job_notes (job_id, body, pinned, author_name)
    values (new_id, trim(p ->> 'note'), true, coalesce((select name from public.app_users where auth_user_id = auth.uid()), ''));
  end if;
  return new_id;
end
$$;

-- What the company totals rows need, without names, customers or money (decision 6).
-- Reps and PMs only see their own jobs, so their totals come from here; the app runs the
-- same capacity math on it as it does for everyone else.
create function public.company_load_inputs() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'scheduler', 'job_setup', 'estimator', 'pm', 'sales_rep', 'accounting', 'cfo') then
    raise exception 'Company totals are not available for your role' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectedHrs', j.projected_hrs,
        'start', j.start,
        'projectedFinish', j.projected_finish,
        'status', j.status,
        'actuals', coalesce((select jsonb_agg(jsonb_build_object('week', a.week, 'hours', a.hours))
                               from public.actual_hours a where a.job_id = j.id and a.active), '[]'::jsonb),
        'overrides', coalesce((select jsonb_agg(jsonb_build_object('week', o.week, 'hours', o.hours))
                                 from public.plan_overrides o where o.job_id = j.id and o.active), '[]'::jsonb)))
      from public.jobs j where j.active and j.status <> 'complete'), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', pp.kind,
        'timeOff', coalesce((select jsonb_agg(jsonb_build_array(t.first_day, t.last_day))
                               from public.time_off t where t.person_id = pp.id and t.active), '[]'::jsonb)))
      from public.people pp where pp.active), '[]'::jsonb));
end
$$;

revoke all on function public.claim_app_user() from public, anon;
revoke all on function public.create_job(jsonb) from public, anon;
revoke all on function public.company_load_inputs() from public, anon;
grant execute on function public.claim_app_user() to authenticated;
grant execute on function public.create_job(jsonb) to authenticated;
grant execute on function public.company_load_inputs() to authenticated;
