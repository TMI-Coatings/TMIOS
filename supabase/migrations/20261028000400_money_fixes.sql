-- Money fixes from the demo review (Oct 27).
-- * Change orders carry their own materials cost, who approved them and when (decision 19).
-- * Each job keeps the burdened labor rate it was set up with, so a rate change never rewrites
--   its margin (decision 22). Bid margin includes approved change orders at their own margin.
-- * Retainage is held per invoice at the job's % when billed (decision 17).
-- * Billing alerts go to the CFO role, not a name (decision 11), with the demo's detail.
-- * Invoices can't be empty or bill more than is left on the contract.

alter table public.jobs add column burdened_rate_cents bigint;
update public.jobs set burdened_rate_cents = app.setting('burdenedRateCents');
alter table public.jobs alter column burdened_rate_cents set not null;
alter table public.jobs add check (burdened_rate_cents >= 0);

create function app.job_rate() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.burdened_rate_cents := coalesce(new.burdened_rate_cents, app.setting('burdenedRateCents'));
  else
    new.burdened_rate_cents := old.burdened_rate_cents;
  end if;
  return new;
end
$$;
create trigger job_rate before insert or update on public.jobs for each row execute function app.job_rate();

alter table public.change_orders add column material_cost_cents bigint not null default 0 check (material_cost_cents >= 0);
alter table public.change_orders add column approved_by text not null default '';
-- Until now the CO's materials revenue stood in for its cost.
update public.change_orders set material_cost_cents = material_cents;

alter table public.invoices add column retainage_cents bigint check (retainage_cents >= 0);
update public.invoices i set retainage_cents = round(i.amount_cents * j.retainage_pct / 100) from public.jobs j where j.id = i.job_id;

create function app.invoice_retainage() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.retainage_cents := coalesce(new.retainage_cents,
    round(new.amount_cents * (select retainage_pct from public.jobs where id = new.job_id) / 100));
  return new;
end
$$;
create trigger invoice_retainage before insert on public.invoices for each row execute function app.invoice_retainage();

create or replace function app.material_cost_cents(j public.jobs) returns bigint
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.material_cost_cents + coalesce((select sum(material_cost_cents) from public.change_orders where job_id = j.id and active), 0)
$$;

create or replace function app.retainage_outstanding_cents(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0, coalesce((select sum(retainage_cents) from public.invoices where job_id = j.id and active and kind <> 'skip'), 0)
    - coalesce((select sum(amount_cents) from public.retainage_receipts where job_id = j.id and active), 0))
$$;

-- Bid margin: the estimate plus approved change orders, at the job's own labor rate.
create function app.gp_bid(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select 1 - (app.material_cost_cents(j)
              + (j.estimate_hrs + coalesce((select sum(hours) from public.change_orders where job_id = j.id and active), 0)) * j.burdened_rate_cents)::numeric
             / greatest(app.contract_cents(j), 1)
$$;
create function app.gp_now(j public.jobs, p_eac numeric) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select 1 - (app.material_cost_cents(j) + p_eac * j.burdened_rate_cents)::numeric / greatest(app.contract_cents(j), 1)
$$;

create function app.progress_suggest_cents(j public.jobs) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0, round((app.recognized_cents(j) - app.billed_cents(j.id)) / 10000) * 10000)
$$;

create or replace function public.company_revenue_totals() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  w date := app.planning_week();
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'pm', 'sales_rep', 'accounting') then
    raise exception 'Company totals are not available for your role' using errcode = '42501';
  end if;
  return (
    with j as (
      select jb.*, jb jb_row, app.recognized_cents(jb) rec, app.contract_cents(jb) val, app.billed_cents(jb.id) billed, app.material_cost_cents(jb) mc,
             app.eac(jb) e, (select sum(hours) from public.actual_hours where job_id = jb.id and active) act,
             (select week from app.latest_pct(jb.id)) pct_week, (select labor from app.latest_pct(jb.id)) lab
        from public.jobs jb where jb.active)
    select jsonb_build_object(
      'remainingCents', round(coalesce(sum(greatest(0, val - rec)) filter (where status <> 'complete'), 0)),
      'netBillingCents', round(coalesce(sum(billed - rec) filter (where billed > 0 or rec > 0), 0)),
      'reviewCount', count(*) filter (where status <> 'complete' and (
          (start <= w and pct_week is distinct from w)
          or (coalesce(act, 0) > 0 and abs(coalesce(lab, 0) - least(1, act / greatest(e, 1))) > app.setting('laborDivergencePts') / 100)
          or (app.gp_now(jb_row, e) - app.gp_bid(jb_row) < -app.setting('marginFadePts') / 100))))
    from j);
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

create or replace function app.record_outcome() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  act numeric;
  val bigint;
  rate numeric := new.burdened_rate_cents;
begin
  if new.status <> 'complete' or old.status = 'complete' then return null; end if;
  act := coalesce((select sum(hours) from public.actual_hours where job_id = new.id and active), 0);
  val := app.contract_cents(new);
  insert into public.closeout_outcomes (job_id, number, customer, job_type, leader_id, pm_code, finished_on, estimate_hrs, actual_hrs,
                                        contract_cents, gp_bid, gp_final, on_time)
  values (new.id, new.number, new.customer, new.job_type, new.leader_id, new.pm_code, coalesce(new.actual_finish, app.today()),
          new.estimate_hrs, act, val,
          app.gp_bid(new),
          1 - (app.material_cost_cents(new) + act * rate) / greatest(val, 1),
          coalesce(new.actual_finish, app.today()) <= coalesce(new.must_finish, new.baseline_finish))
  on conflict (job_id) do update set actual_hrs = excluded.actual_hrs, gp_final = excluded.gp_final, on_time = excluded.on_time,
    finished_on = excluded.finished_on, contract_cents = excluded.contract_cents;
  return null;
end
$$;

create or replace function public.mark_milestone_reached(p_milestone uuid) returns void
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
    array['Accounting', 'CFO', 'PM ' || app.wo_step_who(j, 2)], j.id);
end
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
    insert into public.invoices (job_id, kind, milestone_id, number, amount_cents, invoiced_on, recorded_by) values (j.id, 'milestone', m.id, num, amt, app.today(), app.me_name());
    perform app.post_alert('bill', 'Milestone invoiced: ' || j.number || ' ' || j.customer,
      m.label || ': invoice ' || num || ' for ' || app.usd(amt) || E'.\nRecorded by ' || app.me_name() || '.', array['CFO', pm, app.wo_step_who(j, 1)], j.id);
  elsif k in ('progress', 'skip') then
    if j.billing_method <> 'monthly' then raise exception 'This job isn''t billed monthly' using errcode = '23514'; end if;
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
      lines || E'\nPay applications due by the ' || pay_day || 'th.', array['Accounting', 'CFO']);
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

revoke all on all functions in schema app from public;
