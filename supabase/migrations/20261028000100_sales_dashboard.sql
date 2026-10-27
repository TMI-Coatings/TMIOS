-- Sales reps get a capacity dashboard (Austin, Oct 27). It runs on the anonymous company
-- totals, which now carry each job's date firmness so reps can see how firm the next weeks are.
-- Still no customers, job numbers or dollars.

create or replace function public.company_load_inputs() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup', 'estimator', 'pm', 'sales_rep', 'accounting') then
    raise exception 'Company totals are not available for your role' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectedHrs', j.projected_hrs,
        'start', j.start,
        'projectedFinish', j.projected_finish,
        'status', j.status,
        'firmness', j.firmness,
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

revoke all on function public.company_load_inputs() from public, anon;
grant execute on function public.company_load_inputs() to authenticated;
