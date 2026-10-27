-- Money and rule fixes from the independent review (Oct 27). Each was reproduced against the
-- database by a reviewer and confirmed by a second one.

-- A job marked complete has an actual finish date, so its revenue lands in a month.
update public.jobs set actual_finish = projected_finish where status = 'complete' and actual_finish is null;
alter table public.jobs add constraint complete_has_finish check (status <> 'complete' or actual_finish is not null);

create function app.ordinal(n integer) returns text language sql immutable as $$
  select n || case when n % 100 between 11 and 13 then 'th' when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd' else 'th' end
$$;

-- The estimate's dollars and hours (frozen at intake, decision 22) and the billing method
-- (accounting or an admin, decision 11) are their own field groups, no longer part of intake.
create or replace function app.jobs_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  grp record;
begin
  if auth.uid() is null or current_setting('app.guard_bypass', true) = 'on' then
    new.baseline_finish := old.baseline_finish;
    return new;
  end if;
  for grp in
    select * from (values
      ('start', (old.start) is distinct from (new.start)),
      ('projectedFinish', (old.projected_finish) is distinct from (new.projected_finish)),
      ('crewSize', (old.crew_size) is distinct from (new.crew_size)),
      ('leaderId', (old.leader_id) is distinct from (new.leader_id)),
      ('projectedHrs', (old.projected_hrs) is distinct from (new.projected_hrs)),
      ('mustFinish', (old.must_finish, old.must_finish_reason) is distinct from (new.must_finish, new.must_finish_reason)),
      ('firmness', (old.firmness, old.waits_on_job_id, old.firmness_reason) is distinct from (new.firmness, new.waits_on_job_id, new.firmness_reason)),
      ('status', (old.status, old.hold_reason, old.hold_until) is distinct from (new.status, new.hold_reason, new.hold_until)),
      ('actualFinish', (old.actual_finish) is distinct from (new.actual_finish)),
      ('site', (old.site_address, old.site_start_time, old.site_contact, old.site_orientation, old.site_ppe)
          is distinct from (new.site_address, new.site_start_time, new.site_contact, new.site_orientation, new.site_ppe)),
      ('intake', (old.number, old.customer, old.job_type, old.location, old.rep_code, old.pm_code, old.estimator,
                  old.exterior, old.retainage_pct, old.retainage_release, old.retainage_release_note, old.active,
                  old.customer_po, old.bill_to, old.lien_waivers, old.certified_payroll)
          is distinct from (new.number, new.customer, new.job_type, new.location, new.rep_code, new.pm_code, new.estimator,
                  new.exterior, new.retainage_pct, new.retainage_release, new.retainage_release_note, new.active,
                  new.customer_po, new.bill_to, new.lien_waivers, new.certified_payroll)),
      ('bid', (old.estimate_hrs, old.contract_cents, old.material_cost_cents, old.material_revenue_cents)
          is distinct from (new.estimate_hrs, new.contract_cents, new.material_cost_cents, new.material_revenue_cents)),
      ('billingMethod', (old.billing_method) is distinct from (new.billing_method))
    ) as t (field, changed)
  loop
    if grp.changed and not app.can_edit(grp.field, old.leader_id, old.rep_code, old.pm_code) then
      raise exception 'You can''t change % on job %', grp.field, old.number using errcode = '42501';
    end if;
  end loop;
  if old.firmness = 'locked' and new.firmness <> 'locked'
     and (coalesce(trim(new.firmness_reason), '') = '' or new.firmness_reason is not distinct from old.firmness_reason) then
    raise exception 'Moving job % off Locked needs a reason', old.number using errcode = '23514';
  end if;
  new.baseline_finish := old.baseline_finish;
  return new;
end
$$;

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
    when 'bid' then any_roles := '{admin,ceo,cfo}';
    when 'billingMethod' then any_roles := '{admin,ceo,cfo,accounting}';
    else return false;
  end case;
  return r = any (any_roles) or (r = any (own_roles) and app.owns(p_leader, p_rep, p_pm));
end
$$;

-- A finished job's hours are what it took.
create or replace function app.eac(j public.jobs) returns numeric
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  last_week date;
  burn numeric;
  act numeric;
  rem integer := 0;
  w date;
begin
  select max(week), coalesce(sum(hours), 0) into last_week, act from public.actual_hours where job_id = j.id and active;
  if j.status = 'complete' then return act; end if;
  if last_week is null then return j.projected_hrs; end if;
  select avg(hours) into burn from (select hours from public.actual_hours where job_id = j.id and active order by week desc limit 2) x;
  w := last_week + 7;
  while w - 4 <= j.projected_finish loop rem := rem + 1; w := w + 7; end loop;
  return case when rem > 0 then act + burn * rem else greatest(act, j.projected_hrs) end;
end
$$;

create or replace function app.progress_suggest_cents(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select least(greatest(0, round((app.recognized_cents(j) - app.billed_cents(j.id)) / 10000) * 10000),
               greatest(0, app.contract_cents(j) - app.billed_cents(j.id)))
$$;

create or replace function public.record_invoice(p jsonb) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.jobs;
  k text := p ->> 'kind';
  amt bigint := coalesce((p ->> 'amountCents')::bigint, 0);
  num text := nullif(trim(p ->> 'number'), '');
  m public.milestones;
  pm text;
begin
  select * into j from public.jobs where id = (p ->> 'jobId')::uuid;
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin records invoices' using errcode = '42501'; end if;
  if k <> 'skip' and num is null then raise exception 'Enter the invoice number from Sage' using errcode = '23514'; end if;
  if k in ('progress', 'final') then
    if amt <= 0 then raise exception 'Enter the invoice amount in dollars' using errcode = '23514'; end if;
    if amt > app.contract_cents(j) - app.billed_cents(j.id) then
      raise exception 'That''s more than the % left to bill on this job', app.usd(app.contract_cents(j) - app.billed_cents(j.id)) using errcode = '23514';
    end if;
  end if;
  pm := 'PM ' || app.wo_step_who(j, 2);
  if k = 'final' then
    if j.status <> 'complete' or not exists (select 1 from public.job_checkpoints where job_id = j.id and checkpoint_key = 'walk' and active) then
      raise exception 'The final invoice waits for the job to be complete and signed off by the customer' using errcode = '23514';
    end if;
    insert into public.invoices (job_id, kind, number, amount_cents, invoiced_on, recorded_by) values (j.id, 'final', num, amt, app.today(), app.me_name());
    perform app.post_alert('bill', 'Invoiced: ' || j.number || ' ' || j.customer,
      'Final invoice ' || num || ' for ' || app.usd(amt) || '.'
        || case when j.retainage_pct > 0 then ' Retainage ' || app.usd(app.retainage_outstanding_cents(j)) || ' still outstanding.' else '' end
        || E'\nRecorded by ' || app.me_name() || '.',
      array['CFO', 'Leadership', pm, app.wo_step_who(j, 1)], j.id);
  elsif k = 'milestone' then
    select * into m from public.milestones where id = (p ->> 'milestoneId')::uuid and job_id = j.id and active;
    if m.reached_on is null then raise exception 'That milestone hasn''t been reached' using errcode = '23514'; end if;
    amt := round(app.contract_cents(j) * m.pct / 100);
    if amt > app.contract_cents(j) - app.billed_cents(j.id) then
      raise exception 'That''s more than the % left to bill on this job', app.usd(app.contract_cents(j) - app.billed_cents(j.id)) using errcode = '23514';
    end if;
    insert into public.invoices (job_id, kind, milestone_id, number, amount_cents, invoiced_on, recorded_by) values (j.id, 'milestone', m.id, num, amt, app.today(), app.me_name());
    perform app.post_alert('bill', 'Milestone invoiced: ' || j.number || ' ' || j.customer,
      m.label || ': invoice ' || num || ' for ' || app.usd(amt) || E'.\nRecorded by ' || app.me_name() || '.', array['CFO', pm, app.wo_step_who(j, 1)], j.id);
  elsif k in ('progress', 'skip') then
    if j.billing_method <> 'monthly' then raise exception 'This job isn''t billed monthly' using errcode = '23514'; end if;
    if coalesce(p ->> 'period', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
       or (p ->> 'period') < to_char(j.start, 'YYYY-MM') or (p ->> 'period') > to_char(app.today(), 'YYYY-MM') then
      raise exception 'Pick a month from the job''s start through this month' using errcode = '23514';
    end if;
    if exists (select 1 from public.invoices i where i.job_id = j.id and i.active and i.kind in ('progress', 'skip') and i.period = p ->> 'period') then
      raise exception 'That month is already billed' using errcode = '23514';
    end if;
    insert into public.invoices (job_id, kind, period, number, amount_cents, invoiced_on, recorded_by)
    values (j.id, k, p ->> 'period', num, case when k = 'skip' then 0 else amt end, app.today(), app.me_name());
    if k = 'progress' then
      perform app.post_alert('bill', 'Progress invoiced: ' || j.number || ' ' || j.customer,
        to_char(((p ->> 'period') || '-01')::date, 'FMMonth YYYY') || ': invoice ' || num || ' for ' || app.usd(amt) || E'.\nRecorded by ' || app.me_name() || '.',
        array['CFO', pm, app.wo_step_who(j, 1)], j.id);
    end if;
  else
    raise exception 'Unknown invoice type' using errcode = '23514';
  end if;
end
$$;

create or replace function public.add_change_order(p jsonb) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.jobs;
  id uuid;
  hrs integer := coalesce((p ->> 'hours')::integer, 0);
begin
  select * into j from public.jobs where jobs.id = (p ->> 'jobId')::uuid;
  if not (app.role_in('admin', 'ceo', 'cfo', 'job_setup') or app.can_edit_job(j.id, 'changeOrders')) then
    raise exception 'Only the job''s PM, job setup or an admin enters change orders' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'number'), '') = '' then raise exception 'Enter the change order number' using errcode = '23514'; end if;
  if coalesce(trim(p ->> 'approvedBy'), '') = '' then raise exception 'Enter who approved the change order' using errcode = '23514'; end if;
  if abs(coalesce((p ->> 'materialCents')::bigint, 0)) > abs((p ->> 'amountCents')::bigint)
     or sign(coalesce((p ->> 'materialCents')::bigint, 0)) * sign((p ->> 'amountCents')::bigint) < 0 then
    raise exception 'The materials part can''t be more than the change order itself' using errcode = '23514';
  end if;
  if coalesce((p ->> 'materialCostCents')::bigint, 0) < 0 then raise exception 'Materials cost can''t be negative' using errcode = '23514'; end if;
  if app.contract_cents(j) + (p ->> 'amountCents')::bigint < app.billed_cents(j.id) then
    raise exception 'That would take the contract below the % already billed', app.usd(app.billed_cents(j.id)) using errcode = '23514';
  end if;
  insert into public.change_orders (job_id, number, description, amount_cents, material_cents, material_cost_cents, hours, approved_on, approved_by)
  values (j.id, trim(p ->> 'number'), coalesce(p ->> 'description', ''), (p ->> 'amountCents')::bigint,
          coalesce((p ->> 'materialCents')::bigint, 0), coalesce((p ->> 'materialCostCents')::bigint, 0), hrs,
          coalesce((p ->> 'approvedOn')::date, app.today()), trim(p ->> 'approvedBy'))
  returning change_orders.id into id;
  if hrs <> 0 then
    perform app.guard_bypass(true);
    update public.jobs set projected_hrs = greatest(0, projected_hrs + hrs) where jobs.id = j.id;
    perform app.guard_bypass(false);
  end if;
  return id;
end
$$;

create or replace function public.close_week(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w date := (p ->> 'week')::date;
  expected date := app.week_to_close();
  e jsonb;
  total numeric := 0;
  entered integer := 0;
  missing uuid[];
  finished uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'finished', '[]'::jsonb))::uuid);
  before_alerts integer := (select count(*) from public.alerts);
  fc numeric;
  acc numeric;
  on_time numeric;
  nw date;
  cap13 numeric;
  jr public.jobs;
  e_hrs numeric;
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler') then
    raise exception 'Only the scheduler or an admin closes the week' using errcode = '42501';
  end if;
  if expected is null then raise exception 'This week is already closed' using errcode = '23514'; end if;
  if w is distinct from expected then raise exception 'The next week to close is the week ending %', app.d(expected) using errcode = '23514'; end if;

  if exists (select 1 from public.jobs j where j.id = any (finished) and not (j.active and j.status <> 'complete' and j.start <= w)) then
    raise exception 'Only jobs that started by the week ending % and are still open can be marked finished', app.d(w) using errcode = '23514';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p -> 'entries', '[]'::jsonb)) loop
    if not exists (select 1 from public.jobs j where j.id = (e ->> 'jobId')::uuid and j.active and j.status <> 'complete' and j.start <= w) then
      raise exception 'Hours can only go on jobs open in the week ending %', app.d(w) using errcode = '23514';
    end if;
    if coalesce(e ->> 'source', 'typed') not in ('typed', 'csv', 'import') then raise exception 'Unknown hours source' using errcode = '23514'; end if;
    insert into public.actual_hours (job_id, week, hours, source)
    values ((e ->> 'jobId')::uuid, w, round((e ->> 'hours')::numeric, 1), coalesce(e ->> 'source', 'typed'));
    total := total + round((e ->> 'hours')::numeric, 1);
    entered := entered + 1;
  end loop;

  missing := array(
    select j.id from public.jobs j
     where j.active and j.status <> 'complete' and j.start <= w
       and not exists (select 1 from public.actual_hours a where a.job_id = j.id and a.week = w and a.active));

  insert into public.week_closes (week, entered, total_hrs, missing_job_ids, completed_job_ids)
  values (w, entered, total, missing, finished);

  select count(*) filter (where w <= coalesce(must_finish, baseline_finish))::numeric / nullif(count(*), 0)
    into on_time from public.jobs where id = any (finished);
  update public.jobs set status = 'complete', actual_finish = coalesce(actual_finish, w), hold_reason = null, hold_until = null
   where id = any (finished);
  update public.hour_entries set active = false where week = w and active;

  -- Forecast accuracy against the forecast made 4 weeks earlier, jobs with missing hours left out.
  select sum(hours) - coalesce(sum(hours) filter (where job_id = any (missing)), 0) into fc
    from public.forecast_snapshots where target_week = w and made_week = w - 28;
  if fc > 0 then acc := greatest(0, 1 - abs(total - fc) / fc); end if;

  nw := w + 7;
  select avg(available) into cap13 from app.week_totals(nw, 13);
  insert into public.weekly_metrics (week, utilization, utilization_roster, backlog_weeks, backlog_cents, accuracy, on_time)
  select w,
         total / nullif(app.setting('targetHeadcount') * app.setting('hoursPerManWeek'), 0),
         total / nullif((select count(*) from public.people where active and kind <> 'leadership') * app.setting('hoursPerManWeek'), 0),
         sum(greatest(0, j.projected_hrs - coalesce(a.done, 0))) / nullif(cap13, 0),
         round(sum(app.contract_cents(j)::numeric * greatest(0, j.projected_hrs - coalesce(a.done, 0)) / greatest(1, j.projected_hrs))),
         acc, on_time
    from public.jobs j
    left join (select job_id, sum(hours) done from public.actual_hours where active group by job_id) a on a.job_id = j.id
   where j.active and j.status <> 'complete';

  -- Snapshot the forecast for the new week and for 4 weeks out.
  insert into public.forecast_snapshots (made_week, target_week, job_id, hours)
  select nw, week, job_id, hours from app.plan_all(nw)
   where week in (nw, nw + 28) and hours > 0 and not on_hold
  on conflict do nothing;

  -- Overrun warnings for jobs that logged hours this week.
  for jr in select j.* from public.jobs j where j.status <> 'complete'
             and exists (select 1 from public.actual_hours a where a.job_id = j.id and a.week = w and a.active) loop
    if app.eac(jr) > jr.projected_hrs * (1 + app.setting('overrunPct') / 100) then
      select hours into e_hrs from public.actual_hours where job_id = jr.id and week = w and active;
      perform app.post_alert('overrun', 'Overrun warning: ' || jr.number || ' ' || jr.customer,
        'On pace for ' || app.n0(app.eac(jr)) || ' hrs against ' || app.n0(jr.projected_hrs) || ' projected (+'
          || round((app.eac(jr) / jr.projected_hrs - 1) * 100) || '%). Last week: ' || app.n0(e_hrs) || ' hrs. Hours left: '
          || app.n0(jr.projected_hrs - (select sum(hours) from public.actual_hours where job_id = jr.id and active)) || '.',
        app.job_recipients(jr), jr.id);
    end if;
  end loop;

  perform app.capacity_check();
  perform app.cert_reminders();

  return jsonb_build_object('week', w, 'entered', entered, 'total', total, 'missing', cardinality(missing),
                            'alerts', (select count(*) from public.alerts) - before_alerts, 'nextWeek', nw);
end
$$;

create or replace function app.bill_check() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w date := app.today();
  cp text := to_char(app.today(), 'YYYY-MM');
  pay_day integer := app.setting('payAppDay')::integer;
  r record;
  lines text;
  n integer;
  k text;
  signed date;
  ready date;
  rj public.jobs;
begin
  if current_setting('app.seeding', true) = 'on' then return; end if;
  -- Progress pay apps due: every month from the job's start through this month without an invoice or a "nothing to bill".
  create temp table if not exists _due (job_id uuid, period text) on commit drop;
  truncate _due;
  insert into _due
  select j.id, to_char(m, 'YYYY-MM') from public.jobs j,
         generate_series(date_trunc('month', j.start), date_trunc('month', w), interval '1 month') m
   where j.active and j.billing_method = 'monthly' and j.status <> 'complete' and j.start <= w
     and not exists (select 1 from public.invoices i where i.job_id = j.id and i.active and i.kind in ('progress', 'skip') and i.period = to_char(m, 'YYYY-MM'));
  select count(*), string_agg(t.line, E'\n' order by t.line) into n, lines
    from (select jb.number || ' ' || jb.customer || ': '
                 || string_agg(to_char((d.period || '-01')::date, 'Mon YYYY'), ', ' order by d.period)
                 || ', suggested ' || app.usd(app.progress_suggest_cents(jb)) line
            from _due d join public.jobs jb on jb.id = d.job_id group by jb.id) t;
  if n > 0 and not exists (select 1 from public.alert_state where key = 'bill-period|' || cp) then
    insert into public.alert_state (key, value) values ('bill-period|' || cp, 'sent');
    perform app.post_alert('bill', 'Progress billing for ' || to_char(w, 'FMMonth YYYY') || ': ' || n || ' job' || case when n > 1 then 's' else '' end,
      lines || E'\nPay applications due by the ' || app.ordinal(pay_day) || '.', array['Accounting', 'CFO']);
  end if;
  for r in select d.job_id, d.period, j.number, j.customer from _due d join public.jobs j on j.id = d.job_id
            where (d.period || '-' || lpad(pay_day::text, 2, '0'))::date < w loop
    k := 'bill-late|' || r.job_id || '|' || r.period;
    continue when exists (select 1 from public.alert_state where key = k);
    insert into public.alert_state (key, value) values (k, 'sent');
    perform app.post_alert('bill', 'Progress invoice late: ' || r.number || ' ' || r.customer,
      to_char((r.period || '-01')::date, 'FMMonth YYYY') || ' was due ' || app.d((r.period || '-' || lpad(pay_day::text, 2, '0'))::date) || '. '
        || app.usd(app.progress_suggest_cents((select x from public.jobs x where x.id = r.job_id))) || ' recognized but not billed.',
      array['Accounting', 'CFO', 'Leadership'], r.job_id);
  end loop;
  -- Complete jobs: waiting on customer sign-off, ready to invoice, late.
  for rj in select j.* from public.jobs j
            where j.active and j.status = 'complete'
              and not exists (select 1 from public.invoices i where i.job_id = j.id and i.active and i.kind = 'final') loop
    signed := (select done_at::date from public.job_checkpoints where job_id = rj.id and checkpoint_key = 'walk' and active);
    if signed is null then
      k := 'bill-wait|' || rj.id;
      continue when exists (select 1 from public.alert_state where key = k);
      insert into public.alert_state (key, value) values (k, 'sent');
      perform app.post_alert('bill', 'Complete, waiting on sign-off: ' || rj.number || ' ' || rj.customer,
        'The job is complete but the customer hasn’t signed off at the final walk. PM ' || app.wo_step_who(rj, 2)
          || ' to get the sign-off so accounting can invoice.', array['Accounting', 'CFO', 'PM ' || app.wo_step_who(rj, 2)], rj.id);
    else
      ready := greatest(signed, coalesce(rj.actual_finish, signed));
      k := 'bill-ready|' || rj.id;
      if not exists (select 1 from public.alert_state where key = k) then
        insert into public.alert_state (key, value) values (k, ready::text);
        perform app.post_alert('bill', 'Ready to invoice: ' || rj.number || ' ' || rj.customer,
          'Job complete ' || app.d(rj.actual_finish) || E' and signed off by the customer.\nFinal invoice '
            || app.usd(app.contract_cents(rj) - app.billed_cents(rj.id))
            || case when rj.retainage_pct > 0 then ', retainage held ' || app.usd(round((app.contract_cents(rj) - app.billed_cents(rj.id)) * rj.retainage_pct / 100)) else '' end
            || '. PO ' || coalesce(nullif(trim(rj.customer_po), ''), 'not on file') || E'.\nInvoice due by ' || app.d(ready + app.setting('invoiceDays')::integer) || '.',
          array['Accounting', 'CFO', 'PM ' || app.wo_step_who(rj, 2), 'Leadership'], rj.id);
      end if;
      k := 'bill-inv-late|' || rj.id;
      if ready + app.setting('invoiceDays')::integer < w and not exists (select 1 from public.alert_state where key = k) then
        insert into public.alert_state (key, value) values (k, 'sent');
        perform app.post_alert('bill', 'Invoice late: ' || rj.number || ' ' || rj.customer,
          'Ready to invoice since ' || app.d(ready) || '; it was due ' || app.d(ready + app.setting('invoiceDays')::integer) || '. '
            || app.usd(app.contract_cents(rj) - app.billed_cents(rj.id)) || ' not yet billed.',
          array['Accounting', 'CFO', 'Leadership'], rj.id);
      end if;
    end if;
  end loop;
end
$$;

create or replace function public.claim_app_user() returns setof public.app_users
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or em = '' then return; end if;
  -- Only Microsoft (Entra ID) sign-ins link to the access list, whatever else is enabled in Supabase Auth.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'azure' then return; end if;
  update public.app_users set auth_user_id = auth.uid()
   where email = em and auth_user_id is null and active;
  return query select * from public.app_users where auth_user_id = auth.uid() and active;
end
$$;

create or replace function app.access_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and old.auth_user_id = auth.uid()
     and (new.role <> old.role or not new.active or new.auth_user_id is distinct from old.auth_user_id or new.email <> old.email) then
    raise exception 'You can''t change your own access. Ask another admin' using errcode = '42501';
  end if;
  if old.active and old.role in ('admin', 'ceo', 'cfo') and (not new.active or new.role not in ('admin', 'ceo', 'cfo'))
     and not exists (select 1 from public.app_users where id <> old.id and active and role in ('admin', 'ceo', 'cfo')) then
    raise exception 'Someone has to keep full rights' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function app.settings_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l record;
  v numeric;
  start_w numeric;
  end_w numeric;
  first_d numeric;
  second_d numeric;
begin
  if current_setting('app.seeding', true) = 'on' then return new; end if;
  if new.key <> old.key then raise exception 'Settings can''t be renamed' using errcode = '23514'; end if;
  if new.key in ('winterStart', 'winterEnd')
     and (jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') then
    raise exception 'Use MM-DD, for example 12-01' using errcode = '23514';
  end if;
  select * into l from app.setting_limits() x where x.key = new.key;
  if found then
    begin
      v := (new.value #>> '{}')::numeric;
    exception when others then
      raise exception 'Enter a number' using errcode = '23514';
    end;
    if v is null or v < l.min or v > l.max then raise exception 'Use a number from % to %', l.min, l.max using errcode = '23514'; end if;
    if l.whole and v <> trunc(v) then raise exception 'Use a whole number' using errcode = '23514'; end if;
  end if;
  start_w := case when new.key = 'openWindowStartWeeks' then v else app.setting('openWindowStartWeeks') end;
  end_w := case when new.key = 'openWindowEndWeeks' then v else app.setting('openWindowEndWeeks') end;
  if start_w > end_w then raise exception 'The open capacity window has to start before it ends' using errcode = '23514'; end if;
  first_d := case when new.key = 'certFirstDays' then v else app.setting('certFirstDays') end;
  second_d := case when new.key = 'certSecondDays' then v else app.setting('certSecondDays') end;
  if second_d >= first_d then raise exception 'The second certification reminder has to come after the first, so use fewer days' using errcode = '23514'; end if;
  if new.key = 'closeoutCauses' and (jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) = 0) then
    raise exception 'Keep at least one cause' using errcode = '23514';
  end if;
  return new;
end
$$;

-- Month-end WIP is computed as of the last day of the month, and this month can only be locked
-- in its final week.
create or replace function app.wip_rows(p_month text)
  returns table (job_id uuid, number text, customer text, pm_code text, contract_cents bigint, materials_pct integer, labor_pct integer,
                 recognized_cents bigint, billed_cents bigint, over_under_cents bigint, cost_to_complete_cents bigint,
                 gp_bid numeric, gp_now numeric, retainage_cents bigint)
  language sql stable security definer set search_path = public, pg_temp as $$
  with b as (select (p_month || '-01')::date ms, ((p_month || '-01')::date + interval '1 month' - interval '1 day')::date me),
  x as (
    select j.*, j jrow, b.me,
           j.status = 'complete' and j.actual_finish is not null and j.actual_finish <= b.me done,
           j.contract_cents + coalesce((select sum(c.amount_cents) from public.change_orders c where c.job_id = j.id and c.active and c.approved_on <= b.me), 0) val,
           j.material_revenue_cents + coalesce((select sum(c.material_cents) from public.change_orders c where c.job_id = j.id and c.active and c.approved_on <= b.me), 0) mrev,
           j.material_cost_cents + coalesce((select sum(c.material_cost_cents) from public.change_orders c where c.job_id = j.id and c.active and c.approved_on <= b.me), 0) mcost,
           coalesce((select sum(c.hours) from public.change_orders c where c.job_id = j.id and c.active and c.approved_on <= b.me), 0) co_hrs,
           (select pc.materials_pct / 100 from public.percent_complete pc where pc.job_id = j.id and pc.week <= b.me order by pc.week desc limit 1) pmat,
           (select pc.labor_pct / 100 from public.percent_complete pc where pc.job_id = j.id and pc.week <= b.me order by pc.week desc limit 1) plab,
           coalesce((select sum(i.amount_cents) from public.invoices i where i.job_id = j.id and i.active and i.kind <> 'skip' and i.invoiced_on <= b.me), 0) billed,
           coalesce((select sum(i.retainage_cents) from public.invoices i where i.job_id = j.id and i.active and i.kind <> 'skip' and i.invoiced_on <= b.me), 0)
             - coalesce((select sum(r.amount_cents) from public.retainage_receipts r where r.job_id = j.id and r.active and r.received_on <= b.me), 0) held,
           coalesce((select sum(a.hours) from public.actual_hours a where a.job_id = j.id and a.active and a.week <= b.me), 0) act
      from public.jobs j, b
     where j.active and j.start <= b.me and not (j.status = 'complete' and j.actual_finish is not null and j.actual_finish < b.ms)),
  y as (
    select x.*,
           case when done then 1 else coalesce(pmat, 0) end mat,
           case when done then 1 else coalesce(plab, 0) end lab,
           case when done then act else app.eac(x.jrow) end hrs
      from x)
  select y.id, y.number, y.customer, y.pm_code, y.val,
         round(y.mat * 100)::integer, round(y.lab * 100)::integer,
         round(case when y.done then y.val else y.mrev * y.mat + (y.val - y.mrev) * y.lab end)::bigint,
         y.billed,
         (y.billed - round(case when y.done then y.val else y.mrev * y.mat + (y.val - y.mrev) * y.lab end))::bigint,
         case when y.done then 0 else round(greatest(0, y.hrs - y.act) * y.burdened_rate_cents + y.mcost * (1 - y.mat)) end::bigint,
         1 - (y.mcost + (y.estimate_hrs + y.co_hrs) * y.burdened_rate_cents)::numeric / greatest(y.val, 1),
         1 - (y.mcost + y.hrs * y.burdened_rate_cents)::numeric / greatest(y.val, 1),
         greatest(0, y.held)::bigint
    from y
   order by y.number
$$;

create or replace function public.take_wip_snapshot(p_month text) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
  cur text := to_char(app.today(), 'YYYY-MM');
  prev text := to_char(date_trunc('month', app.today()) - interval '1 day', 'YYYY-MM');
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin takes the month-end WIP' using errcode = '42501'; end if;
  if not (p_month = prev or (p_month = cur and app.today() >= (date_trunc('month', app.today()) + interval '1 month' - interval '7 days')::date)) then
    raise exception 'Lock last month, or this month during its final week' using errcode = '23514';
  end if;
  if exists (select 1 from public.wip_snapshots where month = p_month) then raise exception 'That month is already locked' using errcode = '23514'; end if;
  insert into public.wip_snapshots (month, job_id, number, customer, pm_code, contract_cents, materials_pct, labor_pct, recognized_cents, billed_cents,
                                    over_under_cents, cost_to_complete_cents, gp_bid, gp_now, retainage_cents, taken_by)
  select p_month, r.*, app.me_name() from app.wip_rows(p_month) r;
  get diagnostics n = row_count;
  return n;
end
$$;

-- No checkpoint goes into a retired stage.
create function app.checkpoint_stage_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.active and not exists (select 1 from public.journey_stages where key = new.stage_key and active) then
    raise exception 'That stage is retired' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger stage_guard before insert or update on public.journey_checkpoints for each row execute function app.checkpoint_stage_guard();

-- Crews and plan hours for weeks already closed stay as they were.
create function app.closed_week_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('app.seeding', true) = 'on' or auth.uid() is null then return new; end if;
  if new.week <= coalesce((select max(week) from public.week_closes), '0001-01-01') then
    raise exception 'The week ending % is closed', app.d(new.week) using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger closed_week before insert or update on public.assignments for each row execute function app.closed_week_guard();
create trigger closed_week before insert or update on public.plan_overrides for each row execute function app.closed_week_guard();

-- Work order drafts must be stored in the job's own folder.
create or replace function public.wo_upload(p_job uuid, p_file_name text, p_file_path text default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders;
  j public.jobs;
  was_returned boolean;
begin
  -- A draft's file sits in that job's own folder in the private bucket.
  if p_file_path is not null and p_file_path not like p_job::text || '/%' then
    raise exception 'The draft file belongs in this job''s folder' using errcode = '23514';
  end if;
  select * into w from public.work_orders where job_id = p_job for update;
  select * into j from public.jobs where id = p_job;
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup') or not app.can_see_job(p_job) then
    raise exception 'Only job setup, the scheduler or an admin uploads work order drafts' using errcode = '42501';
  end if;
  if app.wo_status(w) not in ('Awaiting draft', 'Returned') then raise exception 'This work order isn''t waiting for a draft' using errcode = '23514'; end if;
  if coalesce(trim(p_file_name), '') = '' then raise exception 'Choose the draft file' using errcode = '23514'; end if;
  was_returned := w.returned_comment is not null;
  update public.work_orders set file_name = p_file_name, file_path = p_file_path, version = version + 1, current_step = 0,
         returned_by = null, returned_role = null, returned_comment = null, returned_at = null, since = app.today()
   where job_id = p_job;
  perform app.wo_event(p_job, case when was_returned then 'Uploaded revised draft ' else 'Uploaded draft ' end || p_file_name || '.');
  perform app.post_alert('wo', case when was_returned then 'Revised draft' else 'Draft work order' end || ' ready for review: ' || j.number || ' ' || j.customer,
    app.me_name() || ' uploaded ' || p_file_name || '. Your step: check hours and scope against the estimate. Due in ' || app.setting('woReviewDays') || E' days.\n'
    || 'The job is already booked on the schedule for ' || app.d(j.start) || '.', array[j.estimator], p_job);
end
$$;

revoke all on all functions in schema app from public;
