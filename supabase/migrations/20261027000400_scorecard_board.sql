-- TMI Ops, batch D: closeout outcomes for the leader scorecard (PM tags overrun causes,
-- decision 10; starts empty at go-live, decision 30) and the counts behind the board pack.

insert into public.settings (key, value, label) values
  ('closeoutCauses', '["Field", "Estimate", "Change order not captured", "Customer delay", "Weather"]', 'Overrun causes the PM can tag at closeout'),
  ('scorecardMonths', '12', 'Leader scorecard looks back this many months')
on conflict (key) do nothing;

-- One row per finished job. Illustrative rows (sample data only) have no job behind them.
create table public.closeout_outcomes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.jobs (id),
  number text not null,
  customer text not null,
  job_type text not null default '',
  leader_id uuid references public.people (id),
  pm_code text references public.project_managers (code),
  finished_on date not null,
  estimate_hrs numeric not null,
  actual_hrs numeric not null,
  contract_cents bigint not null,
  gp_bid numeric(6, 4) not null,
  gp_final numeric(6, 4) not null,
  on_time boolean not null,
  cause text,
  illustrative boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- When a job completes, record how it went against the bid.
create function app.record_outcome() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  act numeric;
  val bigint;
  rate numeric := app.setting('burdenedRateCents');
begin
  if new.status <> 'complete' or old.status = 'complete' then return null; end if;
  act := coalesce((select sum(hours) from public.actual_hours where job_id = new.id and active), 0);
  val := app.contract_cents(new);
  insert into public.closeout_outcomes (job_id, number, customer, job_type, leader_id, pm_code, finished_on, estimate_hrs, actual_hrs,
                                        contract_cents, gp_bid, gp_final, on_time)
  values (new.id, new.number, new.customer, new.job_type, new.leader_id, new.pm_code, coalesce(new.actual_finish, app.today()),
          new.estimate_hrs, act, val,
          1 - (new.material_cost_cents + new.estimate_hrs * rate) / greatest(new.contract_cents, 1),
          1 - (app.material_cost_cents(new) + act * rate) / greatest(val, 1),
          coalesce(new.actual_finish, app.today()) <= coalesce(new.must_finish, new.baseline_finish))
  on conflict (job_id) do update set actual_hrs = excluded.actual_hrs, gp_final = excluded.gp_final, on_time = excluded.on_time,
    finished_on = excluded.finished_on, contract_cents = excluded.contract_cents;
  return null;
end
$$;
create trigger record_outcome after update on public.jobs for each row execute function app.record_outcome();

-- The PM tags why a job ran over; admin, CEO, CFO and the scheduler can correct it. Tagging ticks the journey checkpoint.
create function public.tag_closeout_cause(p_outcome uuid, p_cause text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.closeout_outcomes;
begin
  select * into o from public.closeout_outcomes where id = p_outcome;
  if not found then raise exception 'Outcome not found' using errcode = '23514'; end if;
  if not (app.role_in('admin', 'ceo', 'cfo', 'scheduler')
          or (app.role_in('pm') and o.pm_code = (select pm_code from public.app_users where auth_user_id = auth.uid() and active))) then
    raise exception 'The job''s PM tags the cause' using errcode = '42501';
  end if;
  if p_cause is not null and not (select value ? p_cause from public.settings where key = 'closeoutCauses') then
    raise exception 'Pick one of the listed causes' using errcode = '23514';
  end if;
  update public.closeout_outcomes set cause = p_cause where id = p_outcome;
  if o.job_id is not null and p_cause is not null then
    insert into public.job_checkpoints (job_id, checkpoint_key, done_by) values (o.job_id, 'cause', app.me_name())
    on conflict (job_id, checkpoint_key) do update set active = true, done_by = excluded.done_by, done_at = now();
  end if;
end
$$;

-- The board pack's communication record: counts only.
create function public.board_counts() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo') then raise exception 'The board pack is for admin, CEO and CFO' using errcode = '42501'; end if;
  return jsonb_build_object(
    'changes', (select count(*) from public.change_log),
    'alerts', (select count(*) from public.alerts),
    'digests', (select count(*) from public.alerts where rule = 'digest'),
    'closes', (select count(*) from public.week_closes),
    'acknowledgments', (select count(*) from public.field_acknowledgments));
end
$$;

create trigger touch before insert or update on public.closeout_outcomes for each row execute function app.touch();
create trigger log_change after insert or update on public.closeout_outcomes for each row execute function app.log_change();
alter table public.closeout_outcomes enable row level security;
revoke all on public.closeout_outcomes from anon, authenticated;
grant select on public.closeout_outcomes to authenticated;

-- Office roles see every leader; a PM sees their jobs; a leader sees only their own line.
create policy read on public.closeout_outcomes for select to authenticated using (
  app.role_in('admin', 'ceo', 'cfo', 'scheduler')
  or (app.role_in('pm') and pm_code = (select pm_code from public.app_users where auth_user_id = auth.uid() and active))
  or (app.role_in('superintendent') and leader_id = (select person_id from public.app_users where auth_user_id = auth.uid() and active)));

revoke all on all functions in schema app from public;
revoke all on function public.tag_closeout_cause(uuid, text), public.board_counts() from public, anon;
grant execute on function public.tag_closeout_cause(uuid, text), public.board_counts() to authenticated;
