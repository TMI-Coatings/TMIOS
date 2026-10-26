-- TMI Ops, batch C: revenue and WIP (percent complete, recognized revenue, margin), change
-- orders (decision 19), and billing by method with retainage held per invoice (decisions 17, 18).

insert into public.settings (key, value, label) values
  ('payAppDay', '25', 'Progress pay applications due (day of month)'),
  ('invoiceDays', '3', 'Final invoice due this many days after customer sign-off'),
  ('underBilledFlagCents', '100000', 'Flag final-only jobs under billed by more than (cents)'),
  ('overBilledFlagPct', '10', 'Over or under billing shown red past this % of contract'),
  ('laborDivergencePts', '15', 'Flag labor % this many points from what hours suggest'),
  ('marginFadePts', '3', 'Flag margin down this many points from bid')
on conflict (key) do nothing;

-- Billing details set at intake.
alter table public.jobs
  add column customer_po text not null default '',
  add column bill_to text not null default '',
  add column lien_waivers boolean not null default false,
  add column certified_payroll boolean not null default false;

-- Job setup now records the billing details too.
create or replace function public.create_job(p jsonb) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_id uuid;
  rate bigint := (select (value #>> '{}')::bigint from public.settings where key = 'burdenedRateCents');
  contract bigint := (p ->> 'contractCents')::bigint;
  matcost bigint := coalesce((p ->> 'materialCostCents')::bigint, 0);
  est integer := (p ->> 'estimateHrs')::integer;
  q text;
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup') then
    raise exception 'You can''t add jobs' using errcode = '42501';
  end if;
  insert into public.jobs (
    number, customer, job_type, location, rep_code, pm_code, estimator, leader_id, crew_size,
    estimate_hrs, projected_hrs, contract_cents, material_cost_cents, material_revenue_cents,
    start, projected_finish, baseline_finish, must_finish, must_finish_reason, status, firmness,
    waits_on_job_id, exterior, billing_method, retainage_pct, retainage_release, retainage_release_note,
    site_address, site_start_time, site_contact, site_orientation, site_ppe,
    customer_po, bill_to, lien_waivers, certified_payroll)
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
    coalesce(p ->> 'siteOrientation', ''), coalesce(p ->> 'sitePpe', ''),
    coalesce(p ->> 'customerPo', ''), coalesce(p ->> 'billTo', ''), coalesce((p ->> 'lienWaivers')::boolean, false),
    coalesce((p ->> 'certifiedPayroll')::boolean, false))
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


-- Weekly percent complete from the Monday meeting: materials (PM or Jared) and labor (PM).
create table public.percent_complete (
  job_id uuid not null references public.jobs (id),
  week date not null check (app.is_friday(week)),
  materials_pct numeric(5, 2) not null check (materials_pct between 0 and 100),
  labor_pct numeric(5, 2) not null check (labor_pct between 0 and 100),
  entered_by text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, week)
);

create table public.change_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  number text not null,
  description text not null default '',
  amount_cents bigint not null,
  material_cents bigint not null default 0 check (material_cents >= 0),
  hours integer not null default 0,
  approved_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  label text not null,
  pct numeric(5, 2) not null check (pct >= 0 and pct <= 100),
  sort integer not null default 0,
  reached_on date,
  reached_by text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  kind text not null check (kind in ('progress', 'milestone', 'final', 'skip')),
  period text check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  milestone_id uuid references public.milestones (id),
  number text,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  invoiced_on date not null,
  recorded_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (kind = 'skip' or coalesce(trim(number), '') <> ''),
  check (kind <> 'progress' and kind <> 'skip' or period is not null),
  check (kind <> 'milestone' or milestone_id is not null)
);
create unique index on public.invoices (job_id, period) where active and kind in ('progress', 'skip');
create unique index on public.invoices (milestone_id) where active and kind = 'milestone';
create unique index on public.invoices (job_id) where active and kind = 'final';

create table public.retainage_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  amount_cents bigint not null check (amount_cents > 0),
  received_on date not null,
  recorded_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------- the numbers
-- Contract and material revenue including approved change orders.
create function app.contract_cents(j public.jobs) returns bigint
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.contract_cents + coalesce((select sum(amount_cents) from public.change_orders where job_id = j.id and active), 0)
$$;
create function app.material_rev_cents(j public.jobs) returns bigint
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.material_revenue_cents + coalesce((select sum(material_cents) from public.change_orders where job_id = j.id and active), 0)
$$;
create function app.material_cost_cents(j public.jobs) returns bigint
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.material_cost_cents + coalesce((select sum(material_cents) from public.change_orders where job_id = j.id and active), 0)
$$;

create function app.latest_pct(p_job uuid) returns table (materials numeric, labor numeric, week date)
  language sql stable security definer set search_path = public, pg_temp as $$
  select materials_pct / 100, labor_pct / 100, week from public.percent_complete where job_id = p_job order by week desc limit 1
$$;

-- Recognized revenue: materials revenue x materials % + labor revenue x labor %. Complete jobs are fully recognized.
create function app.recognized_cents(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when j.status = 'complete' then app.contract_cents(j)::numeric
    else coalesce((select app.material_rev_cents(j) * p.materials + (app.contract_cents(j) - app.material_rev_cents(j)) * p.labor from app.latest_pct(j.id) p), 0) end
$$;

create function app.billed_cents(p_job uuid) returns bigint
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount_cents), 0) from public.invoices where job_id = p_job and active and kind <> 'skip'
$$;

-- Billed gross; the customer holds retainage on each invoice until release (decision 17).
create function app.retainage_outstanding_cents(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0, round(app.billed_cents(j.id) * j.retainage_pct / 100)
    - coalesce((select sum(amount_cents) from public.retainage_receipts where job_id = j.id and active), 0))
$$;

-- Company revenue totals for reps and PMs, who only see their own jobs (decision 6).
create function public.company_revenue_totals() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w date := app.planning_week();
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'pm', 'sales_rep', 'accounting') then
    raise exception 'Company totals are not available for your role' using errcode = '42501';
  end if;
  return (
    with j as (
      select jb.*, app.recognized_cents(jb) rec, app.contract_cents(jb) val, app.billed_cents(jb.id) billed, app.material_cost_cents(jb) mc,
             app.eac(jb) e, (select sum(hours) from public.actual_hours where job_id = jb.id and active) act,
             (select week from app.latest_pct(jb.id)) pct_week, (select labor from app.latest_pct(jb.id)) lab
        from public.jobs jb where jb.active)
    select jsonb_build_object(
      'remainingCents', round(coalesce(sum(greatest(0, val - rec)) filter (where status <> 'complete'), 0)),
      'netBillingCents', round(coalesce(sum(billed - rec) filter (where billed > 0 or rec > 0), 0)),
      'reviewCount', count(*) filter (where status <> 'complete' and (
          (start <= w and pct_week is distinct from w)
          or (coalesce(act, 0) > 0 and abs(coalesce(lab, 0) - least(1, act / greatest(e, 1))) > app.setting('laborDivergencePts') / 100)
          or ((1 - (mc + e * app.setting('burdenedRateCents')) / greatest(val, 1))
              - (1 - (material_cost_cents + estimate_hrs * app.setting('burdenedRateCents')) / greatest(contract_cents, 1)) < -app.setting('marginFadePts') / 100))))
    from j);
end
$$;

-- ---------------------------------------------------------------- writes
create function app.guard_bypass(p_on boolean) returns void language sql as $$
  select set_config('app.guard_bypass', case when p_on then 'on' else '' end, true)
$$;

-- Percent complete for this week's Monday meeting. PM or Jared (and admin/CEO) enter it (decision 16).
create function public.record_percent(p_job uuid, p_materials numeric, p_labor numeric) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_edit_job(p_job, 'percent') then raise exception 'Only the job''s PM, Jared or an admin enters percent complete' using errcode = '42501'; end if;
  if p_materials not between 0 and 100 or p_labor not between 0 and 100 then raise exception 'Percent complete is between 0 and 100' using errcode = '23514'; end if;
  insert into public.percent_complete (job_id, week, materials_pct, labor_pct, entered_by)
  values (p_job, app.planning_week(), round(p_materials, 2), round(p_labor, 2), app.me_name())
  on conflict (job_id, week) do update set materials_pct = excluded.materials_pct, labor_pct = excluded.labor_pct, entered_by = excluded.entered_by;
end
$$;

-- An approved change order adds to the contract and to the projected hours (decision 19).
create function public.add_change_order(p jsonb) returns uuid
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
  insert into public.change_orders (job_id, number, description, amount_cents, material_cents, hours, approved_on)
  values (j.id, trim(p ->> 'number'), coalesce(p ->> 'description', ''), (p ->> 'amountCents')::bigint,
          coalesce((p ->> 'materialCents')::bigint, 0), hrs, coalesce((p ->> 'approvedOn')::date, app.today()))
  returning change_orders.id into id;
  if hrs <> 0 then
    perform app.guard_bypass(true);
    update public.jobs set projected_hrs = greatest(0, projected_hrs + hrs) where jobs.id = j.id;
    perform app.guard_bypass(false);
  end if;
  return id;
end
$$;

-- The billing method belongs to accounting once the job is set up.
create function public.set_billing_method(p_job uuid, p_method public.billing_method) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin changes the billing method' using errcode = '42501'; end if;
  perform app.guard_bypass(true);
  update public.jobs set billing_method = p_method where id = p_job;
  perform app.guard_bypass(false);
  if p_method = 'milestone' and not exists (select 1 from public.milestones where job_id = p_job and active) then
    insert into public.milestones (job_id, label, pct, sort) values
      (p_job, 'Mobilization', 20, 1), (p_job, 'Surface prep complete', 30, 2), (p_job, 'Coatings applied', 40, 3);
  end if;
end
$$;

-- Replace the job's not-yet-invoiced milestones. Invoiced ones are locked. Total at most 100%.
create function public.save_milestones(p_job uuid, p_items jsonb) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb;
  total numeric;
  n integer := 0;
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin edits milestones' using errcode = '42501'; end if;
  select coalesce(sum((x ->> 'pct')::numeric), 0) into total from jsonb_array_elements(p_items) x;
  total := total + coalesce((select sum(m.pct) from public.milestones m where m.job_id = p_job and m.active
                              and exists (select 1 from public.invoices i where i.milestone_id = m.id and i.active)), 0);
  if total > 100 then
    raise exception using errcode = '23514', message = 'Milestones add up to ' || round(total) || '%. Keep them at 100% or less; anything left bills at sign-off';
  end if;
  update public.milestones m set active = false
   where m.job_id = p_job and m.active and not exists (select 1 from public.invoices i where i.milestone_id = m.id and i.active)
     and m.id::text not in (select x ->> 'id' from jsonb_array_elements(p_items) x where x ? 'id');
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if it ? 'id' then
      update public.milestones set label = coalesce(nullif(trim(it ->> 'label'), ''), label), pct = (it ->> 'pct')::numeric, sort = n
       where id = (it ->> 'id')::uuid and job_id = p_job
         and not exists (select 1 from public.invoices i where i.milestone_id = milestones.id and i.active);
    elsif (it ->> 'pct')::numeric > 0 then
      insert into public.milestones (job_id, label, pct, sort) values (p_job, coalesce(nullif(trim(it ->> 'label'), ''), 'Milestone'), (it ->> 'pct')::numeric, n);
    end if;
  end loop;
end
$$;

create function public.mark_milestone_reached(p_milestone uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.milestones;
  j public.jobs;
  val bigint;
begin
  select * into m from public.milestones where id = p_milestone and active;
  select * into j from public.jobs where id = m.job_id;
  if not (app.role_in('admin', 'ceo', 'cfo', 'scheduler') or app.can_edit_job(j.id, 'milestones')) then
    raise exception 'Only the job''s PM, the scheduler or an admin marks a milestone reached' using errcode = '42501';
  end if;
  if m.reached_on is not null then raise exception 'Already marked reached' using errcode = '23514'; end if;
  update public.milestones set reached_on = app.today(), reached_by = app.me_name() where id = p_milestone;
  val := round(app.contract_cents(j) * m.pct / 100);
  perform app.post_alert('bill', 'Milestone reached: ' || j.number || ' ' || j.customer,
    m.label || ' (' || round(m.pct) || '%, ' || app.usd(val) || E'). Ready to invoice.\nMarked by ' || app.me_name() || '.',
    array['Accounting', 'Jared', 'PM ' || app.wo_step_who(j, 2)], j.id);
end
$$;

create function app.usd(cents numeric) returns text language sql immutable as $$
  select case when cents >= 100000000 then '$' || to_char(round(cents / 100000000.0, 2), 'FM999990.00') || 'M'
              when cents >= 100000 then '$' || round(cents / 100000.0) || 'K'
              else '$' || round(cents / 100.0) end
$$;

-- Accounting records invoices drafted in Sage. TMI Ops never writes to Sage.
create function public.record_invoice(p jsonb) returns void
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
      array['Jared', 'Leadership', pm, app.wo_step_who(j, 1)], j.id);
  elsif k = 'milestone' then
    select * into m from public.milestones where id = (p ->> 'milestoneId')::uuid and job_id = j.id and active;
    if m.reached_on is null then raise exception 'That milestone hasn''t been reached' using errcode = '23514'; end if;
    amt := round(app.contract_cents(j) * m.pct / 100);
    insert into public.invoices (job_id, kind, milestone_id, number, amount_cents, invoiced_on, recorded_by) values (j.id, 'milestone', m.id, num, amt, app.today(), app.me_name());
    perform app.post_alert('bill', 'Milestone invoiced: ' || j.number || ' ' || j.customer,
      m.label || ': invoice ' || num || ' for ' || app.usd(amt) || E'.\nRecorded by ' || app.me_name() || '.', array['Jared', pm, app.wo_step_who(j, 1)], j.id);
  elsif k in ('progress', 'skip') then
    if j.billing_method <> 'monthly' then raise exception 'This job isn''t billed monthly' using errcode = '23514'; end if;
    insert into public.invoices (job_id, kind, period, number, amount_cents, invoiced_on, recorded_by)
    values (j.id, k, p ->> 'period', num, case when k = 'skip' then 0 else amt end, app.today(), app.me_name());
    if k = 'progress' then
      perform app.post_alert('bill', 'Progress invoiced: ' || j.number || ' ' || j.customer,
        to_char(((p ->> 'period') || '-01')::date, 'FMMonth YYYY') || ': invoice ' || num || ' for ' || app.usd(amt) || E'.\nRecorded by ' || app.me_name() || '.',
        array['Jared', pm, app.wo_step_who(j, 1)], j.id);
    end if;
  else
    raise exception 'Unknown invoice type' using errcode = '23514';
  end if;
end
$$;

create function public.record_retainage_received(p_job uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.jobs;
  amt numeric;
begin
  select * into j from public.jobs where id = p_job;
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin records retainage' using errcode = '42501'; end if;
  amt := app.retainage_outstanding_cents(j);
  if amt <= 0 then raise exception 'No retainage outstanding on this job' using errcode = '23514'; end if;
  insert into public.retainage_receipts (job_id, amount_cents, received_on, recorded_by) values (p_job, amt, app.today(), app.me_name());
end
$$;

-- Billing alerts: the month's pay apps, late pay apps, ready to invoice, waiting on sign-off, late invoices.
create function app.bill_check() returns void
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
  select count(distinct job_id), string_agg(distinct (select number || ' ' || customer from public.jobs where id = _due.job_id), E'\n')
    into n, lines from _due;
  if n > 0 and not exists (select 1 from public.alert_state where key = 'bill-period|' || cp) then
    insert into public.alert_state (key, value) values ('bill-period|' || cp, 'sent');
    perform app.post_alert('bill', 'Progress billing for ' || to_char(w, 'FMMonth YYYY') || ': ' || n || ' job' || case when n > 1 then 's' else '' end,
      lines || E'\nPay applications due by the ' || pay_day || 'th.', array['Accounting', 'Jared']);
  end if;
  for r in select d.job_id, d.period, j.number, j.customer from _due d join public.jobs j on j.id = d.job_id
            where (d.period || '-' || lpad(pay_day::text, 2, '0'))::date < w loop
    k := 'bill-late|' || r.job_id || '|' || r.period;
    continue when exists (select 1 from public.alert_state where key = k);
    insert into public.alert_state (key, value) values (k, 'sent');
    perform app.post_alert('bill', 'Progress invoice late: ' || r.number || ' ' || r.customer,
      to_char((r.period || '-01')::date, 'FMMonth YYYY') || ' was due ' || app.d((r.period || '-' || lpad(pay_day::text, 2, '0'))::date) || '.',
      array['Accounting', 'Jared', 'Leadership'], r.job_id);
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
          || ' to get the sign-off so accounting can invoice.', array['Accounting', 'Jared', 'PM ' || app.wo_step_who(rj, 2)], rj.id);
    else
      ready := greatest(signed, coalesce(rj.actual_finish, signed));
      k := 'bill-ready|' || rj.id;
      if not exists (select 1 from public.alert_state where key = k) then
        insert into public.alert_state (key, value) values (k, ready::text);
        perform app.post_alert('bill', 'Ready to invoice: ' || rj.number || ' ' || rj.customer,
          'Job complete ' || app.d(rj.actual_finish) || E' and signed off by the customer.\nFinal invoice '
            || app.usd(app.contract_cents(rj) - app.billed_cents(rj.id)) || E'.\nInvoice due by ' || app.d(ready + app.setting('invoiceDays')::integer) || '.',
          array['Accounting', 'Jared', 'PM ' || app.wo_step_who(rj, 2), 'Leadership'], rj.id);
      end if;
      k := 'bill-inv-late|' || rj.id;
      if ready + app.setting('invoiceDays')::integer < w and not exists (select 1 from public.alert_state where key = k) then
        insert into public.alert_state (key, value) values (k, 'sent');
        perform app.post_alert('bill', 'Invoice late: ' || rj.number || ' ' || rj.customer,
          'Ready to invoice since ' || app.d(ready) || '; it was due ' || app.d(ready + app.setting('invoiceDays')::integer) || '.',
          array['Accounting', 'Jared', 'Leadership'], rj.id);
      end if;
    end if;
  end loop;
end
$$;

-- The final invoice checkpoint ticks itself once the final invoice is recorded.
create or replace function app.checkpoint_auto_done(p_job uuid, p_source text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select case p_source
    when 'wo_final' then coalesce((select final from public.work_orders where job_id = p_job), true)
    when 'mobilized' then exists (select 1 from public.jobs where id = p_job and status in ('active', 'complete'))
                       or exists (select 1 from public.actual_hours where job_id = p_job and active)
    when 'work_complete' then exists (select 1 from public.jobs where id = p_job and status = 'complete')
    when 'final_invoice' then exists (select 1 from public.invoices where job_id = p_job and kind = 'final' and active)
    else false
  end
$$;

-- Account-only changes (billing method, change-order hours) skip the field check; everything else is checked.
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
                  old.estimate_hrs, old.contract_cents, old.material_cost_cents, old.material_revenue_cents, old.exterior,
                  old.billing_method, old.retainage_pct, old.retainage_release, old.retainage_release_note, old.active,
                  old.customer_po, old.bill_to, old.lien_waivers, old.certified_payroll)
          is distinct from (new.number, new.customer, new.job_type, new.location, new.rep_code, new.pm_code, new.estimator,
                  new.estimate_hrs, new.contract_cents, new.material_cost_cents, new.material_revenue_cents, new.exterior,
                  new.billing_method, new.retainage_pct, new.retainage_release, new.retainage_release_note, new.active,
                  new.customer_po, new.bill_to, new.lien_waivers, new.certified_payroll))
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

-- 'percent', 'changeOrders' and 'milestones' join the field rules (same table as src/domain/permissions.ts).
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
    when 'crewSize' then any_roles := '{admin,ceo,cfo}'; own_roles := '{superintendent}';
    when 'leaderId' then any_roles := '{admin,ceo,cfo}';
    when 'projectedHrs' then any_roles := '{admin,ceo,cfo}';
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

-- ---------------------------------------------------------------- security
do $$
declare
  t text;
begin
  foreach t in array array['percent_complete', 'change_orders', 'milestones', 'invoices', 'retainage_receipts'] loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function app.touch()', t);
    execute format('create trigger log_change after insert or update on public.%I for each row execute function app.log_change()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- Money is visible to the roles that see revenue and billing, on the jobs they can see.
create function app.sees_money() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'pm', 'sales_rep', 'accounting', 'job_setup')
$$;
create policy read on public.percent_complete for select to authenticated using (app.sees_money() and app.can_see_job(job_id));
create policy read on public.change_orders for select to authenticated using (app.sees_money() and app.can_see_job(job_id));
create policy read on public.milestones for select to authenticated using (app.sees_money() and app.can_see_job(job_id));
create policy read on public.invoices for select to authenticated using (app.sees_money() and app.can_see_job(job_id));
create policy read on public.retainage_receipts for select to authenticated using (app.sees_money() and app.can_see_job(job_id));

-- Billing sweeps run with the other checks.
create or replace function app.capacity_check_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.capacity_check();
  perform app.wo_check();
  perform app.bill_check();
  return null;
end
$$;
create trigger capacity_check after insert or update on public.invoices for each statement execute function app.capacity_check_trigger();
create trigger capacity_check after insert or update on public.job_checkpoints for each statement execute function app.capacity_check_trigger();

revoke all on all functions in schema app from public;
grant execute on function app.sees_money() to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['company_revenue_totals()', 'record_percent(uuid, numeric, numeric)', 'add_change_order(jsonb)',
    'set_billing_method(uuid, public.billing_method)', 'save_milestones(uuid, jsonb)', 'mark_milestone_reached(uuid)',
    'record_invoice(jsonb)', 'record_retainage_received(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
