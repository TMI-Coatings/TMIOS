-- Finance views for Jared (Austin, Oct 27): payments received, the cash view, and a month-end
-- WIP snapshot locked for the books. TMI Ops never writes to Sage; accounting marks payments here.

alter table public.invoices add column paid_on date;
alter table public.invoices add column paid_by text;

-- Accounting marks the customer's payment received (the invoice less retainage held).
create function public.record_payment(p_invoice uuid, p_paid_on date default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.invoices;
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin records payments' using errcode = '42501'; end if;
  select * into i from public.invoices where id = p_invoice and active;
  if not found or i.kind = 'skip' then raise exception 'That invoice isn''t on file' using errcode = '23514'; end if;
  if i.paid_on is not null then raise exception 'Already marked paid' using errcode = '23514'; end if;
  if coalesce(p_paid_on, app.today()) < i.invoiced_on or coalesce(p_paid_on, app.today()) > app.today() then
    raise exception 'The payment date has to be between the invoice date and today' using errcode = '23514';
  end if;
  update public.invoices set paid_on = coalesce(p_paid_on, app.today()), paid_by = app.me_name() where id = p_invoice;
end
$$;

-- One WIP line per job: open jobs, plus jobs finished in the month. Same as wipRows in src/domain/money.ts.
create function app.wip_rows(p_month text)
  returns table (job_id uuid, number text, customer text, pm_code text, contract_cents bigint, materials_pct integer, labor_pct integer,
                 recognized_cents bigint, billed_cents bigint, over_under_cents bigint, cost_to_complete_cents bigint,
                 gp_bid numeric, gp_now numeric, retainage_cents bigint)
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, j.number, j.customer, j.pm_code, app.contract_cents(j),
         round(case when j.status = 'complete' then 100 else coalesce(p.materials, 0) * 100 end)::integer,
         round(case when j.status = 'complete' then 100 else coalesce(p.labor, 0) * 100 end)::integer,
         round(app.recognized_cents(j))::bigint,
         app.billed_cents(j.id),
         round(app.billed_cents(j.id) - app.recognized_cents(j))::bigint,
         round(case when j.status = 'complete' then 0
               else greatest(0, app.eac(j) - coalesce((select sum(hours) from public.actual_hours a where a.job_id = j.id and a.active), 0)) * j.burdened_rate_cents
                    + app.material_cost_cents(j) * (1 - coalesce(p.materials, 0)) end)::bigint,
         app.gp_bid(j), app.gp_now(j, app.eac(j)),
         app.retainage_outstanding_cents(j)::bigint
    from public.jobs j
    left join lateral app.latest_pct(j.id) p on true
   where j.active and (j.status <> 'complete' or to_char(j.actual_finish, 'YYYY-MM') = p_month)
   order by j.number
$$;

create table public.wip_snapshots (
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  job_id uuid not null references public.jobs (id),
  number text not null,
  customer text not null,
  pm_code text not null,
  contract_cents bigint not null,
  materials_pct integer not null,
  labor_pct integer not null,
  recognized_cents bigint not null,
  billed_cents bigint not null,
  over_under_cents bigint not null,
  cost_to_complete_cents bigint not null,
  gp_bid numeric(8, 6) not null,
  gp_now numeric(8, 6) not null,
  retainage_cents bigint not null,
  taken_at timestamptz not null default now(),
  taken_by text not null,
  primary key (month, job_id)
);
alter table public.wip_snapshots enable row level security;
revoke all on public.wip_snapshots from anon, authenticated;
grant select on public.wip_snapshots to authenticated;
create policy read on public.wip_snapshots for select to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'accounting'));

-- Lock this month’s (or last month’s) WIP for the books. Once taken it can’t be retaken or changed;
-- each row carries who took it and when.
create function public.take_wip_snapshot(p_month text) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n integer;
  cur text := to_char(app.today(), 'YYYY-MM');
  prev text := to_char(date_trunc('month', app.today()) - interval '1 day', 'YYYY-MM');
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin takes the month-end WIP' using errcode = '42501'; end if;
  if p_month not in (cur, prev) then raise exception 'Take the snapshot for this month or last month' using errcode = '23514'; end if;
  if exists (select 1 from public.wip_snapshots where month = p_month) then raise exception 'That month is already locked' using errcode = '23514'; end if;
  insert into public.wip_snapshots (month, job_id, number, customer, pm_code, contract_cents, materials_pct, labor_pct, recognized_cents, billed_cents,
                                    over_under_cents, cost_to_complete_cents, gp_bid, gp_now, retainage_cents, taken_by)
  select p_month, r.*, app.me_name() from app.wip_rows(p_month) r;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.record_payment(uuid, date), public.take_wip_snapshot(text) from public, anon;
grant execute on function public.record_payment(uuid, date), public.take_wip_snapshot(text) to authenticated;
revoke all on all functions in schema app from public;
