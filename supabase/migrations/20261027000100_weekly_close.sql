-- TMI Ops, batch A: weekly close, forecast snapshots, board metrics, alerts, My week,
-- crew confirmations. The planning math here mirrors src/domain/schedule.ts; tests/db
-- checks the two give the same hours for every job and week.

-- ---------------------------------------------------------------- settings
insert into public.settings (key, value, label) values
  ('openCapacityHrs', '400', 'Open capacity alert: hours open in a week'),
  ('openWindowStartWeeks', '4', 'Open capacity alert: from this many weeks out'),
  ('openWindowEndWeeks', '8', 'Open capacity alert: to this many weeks out'),
  ('certFirstDays', '60', 'First certification reminder (days before expiry)'),
  ('certSecondDays', '30', 'Second certification reminder (days before expiry)'),
  ('autoFillWeeksOut', '3', 'Crew auto-fill looks this many weeks out')
on conflict (key) do nothing;

create function app.setting(p_key text) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select (value #>> '{}')::numeric from public.settings where key = p_key
$$;

-- ---------------------------------------------------------------- weeks
-- "Today" in Central time. Tests pin it with: set app.today = 'YYYY-MM-DD'.
create function app.today() returns date
  language sql stable as $$
  select coalesce(nullif(current_setting('app.today', true), '')::date, (now() at time zone 'America/Chicago')::date)
$$;

create function app.week_ending(d date) returns date
  language sql immutable as $$ select d + ((5 - extract(dow from d)::int + 7) % 7) $$;

-- ---------------------------------------------------------------- tables
create table public.week_closes (
  week date primary key check (app.is_friday(week)),
  entered integer not null,
  total_hrs numeric(10, 1) not null,
  missing_job_ids uuid[] not null default '{}',
  completed_job_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- The week the schedule plans from: the first week not yet closed, never behind the calendar.
create function app.planning_week() returns date
  language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(app.week_ending(app.today()), coalesce((select max(week) + 7 from public.week_closes), app.week_ending(app.today())))
$$;

-- The week the next close is for; null when this week is already closed.
create function app.week_to_close() returns date
  language sql stable security definer set search_path = public, pg_temp as $$
  select w from (select coalesce((select max(week) + 7 from public.week_closes), app.week_ending(app.today())) w) x
   where w <= app.week_ending(app.today())
$$;

-- Hours a PM or the scheduler typed or imported for the open week, before the close makes them actuals.
create table public.hour_entries (
  job_id uuid not null references public.jobs (id),
  week date not null check (app.is_friday(week)),
  hours numeric(8, 1) not null check (hours >= 0),
  source text not null default 'typed' check (source in ('typed', 'csv', 'import')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, week)
);

create table public.forecast_snapshots (
  made_week date not null check (app.is_friday(made_week)),
  target_week date not null check (app.is_friday(target_week)),
  job_id uuid not null references public.jobs (id),
  hours integer not null,
  created_at timestamptz not null default now(),
  primary key (made_week, target_week, job_id)
);

create table public.weekly_metrics (
  week date primary key check (app.is_friday(week)),
  utilization numeric(6, 4),
  utilization_roster numeric(6, 4),
  backlog_weeks numeric(8, 2),
  backlog_cents bigint,
  accuracy numeric(6, 4),
  on_time numeric(6, 4),
  illustrative boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.crew_confirmations (
  job_id uuid not null references public.jobs (id),
  week date not null check (app.is_friday(week)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, week)
);

create table public.field_acknowledgments (
  person_id uuid not null references public.people (id),
  week date not null check (app.is_friday(week)),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (person_id, week)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  rule text not null check (rule in ('wo', 'bill', 'open', 'date', 'overrun', 'crew', 'gap', 'digest', 'cert')),
  title text not null,
  body text not null,
  recipients text[] not null default '{}',
  job_id uuid references public.jobs (id),
  person_id uuid references public.people (id)
);
create index on public.alerts (at desc);

create table public.alert_mutes (
  user_id uuid not null references public.app_users (id),
  rule text not null,
  muted boolean not null default true,
  primary key (user_id, rule)
);

-- Keys that stop the same alert firing twice (last gap set, reminders already sent).
create table public.alert_state (
  key text primary key,
  value text not null,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- planning math
create function app.job_plan(j public.jobs, p_week date) returns table (week date, hours integer)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  left_hrs numeric;
  rem numeric;
  ws date[];
  w date;
  ov integer;
  nfree integer := 0;
begin
  if not j.active or j.status = 'complete' then return; end if;
  left_hrs := j.projected_hrs - coalesce((select sum(a.hours) from public.actual_hours a where a.job_id = j.id and a.active), 0);
  ws := array(select d::date from generate_series(p_week, p_week + 39 * 7, interval '7 days') d
               where j.start <= d::date and j.projected_finish >= d::date - 4 order by d);
  if cardinality(ws) = 0 then
    if j.start <= p_week and left_hrs > 0 then ws := array[p_week]; else return; end if;
  end if;
  rem := greatest(0, left_hrs);
  foreach w in array ws loop
    select o.hours into ov from public.plan_overrides o where o.job_id = j.id and o.week = w and o.active;
    if found then rem := rem - ov; else nfree := nfree + 1; end if;
  end loop;
  rem := greatest(0, rem);
  foreach w in array ws loop
    select o.hours into ov from public.plan_overrides o where o.job_id = j.id and o.week = w and o.active;
    week := w;
    hours := case when found then ov else round(rem / nfree)::integer end;
    return next;
  end loop;
end
$$;

create function app.plan_all(p_week date) returns table (job_id uuid, week date, hours integer, on_hold boolean, projected_hrs integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select j.id, p.week, p.hours, j.status = 'on_hold', j.projected_hrs
    from public.jobs j, lateral app.job_plan(j, p_week) p
   where j.active and j.status <> 'complete'
$$;

create function app.available_men(p_week date, p_leaders boolean default false) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(1 - (
           select count(*) from generate_series(p_week - 4, p_week, interval '1 day') d
            where exists (select 1 from public.time_off t where t.person_id = pp.id and t.active and t.first_day <= d::date and t.last_day >= d::date)
         )::numeric / 5), 0)
    from public.people pp
   where pp.active and pp.kind <> 'leadership' and (not p_leaders or pp.kind = 'leader')
$$;

create function app.capacity(p_week date) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.available_men(p_week) * app.setting('hoursPerManWeek') * (1 - app.setting('absencePct') / 100)
$$;

create function app.week_totals(p_from date, p_weeks integer)
  returns table (week date, sold numeric, on_hold numeric, available numeric, leaders_needed numeric, leaders_available numeric)
  language sql stable security definer set search_path = public, pg_temp as $$
  with p as (select * from app.plan_all(p_from)),
  ws as (select d::date w from generate_series(p_from, p_from + (p_weeks - 1) * 7, interval '7 days') d)
  select ws.w,
         coalesce((select sum(hours) from p where p.week = ws.w and not p.on_hold), 0),
         coalesce((select sum(hours) from p where p.week = ws.w and p.on_hold), 0),
         app.capacity(ws.w),
         coalesce((select sum(case when p.projected_hrs >= app.setting('dedicatedLeaderHrs') then 1 else app.setting('smallJobLeaderWeight') end)
                     from p where p.week = ws.w and not p.on_hold and p.hours > 0), 0),
         app.available_men(ws.w, true)
    from ws order by ws.w
$$;

-- Estimate at completion: average of the last two actual weeks x weeks left + actual to date.
create function app.eac(j public.jobs) returns numeric
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  last_week date;
  burn numeric;
  act numeric;
  rem integer := 0;
  w date;
begin
  select max(week), coalesce(sum(hours), 0) into last_week, act from public.actual_hours where job_id = j.id and active;
  if last_week is null then return j.projected_hrs; end if;
  select avg(hours) into burn from (select hours from public.actual_hours where job_id = j.id and active order by week desc limit 2) x;
  w := last_week + 7;
  while w - 4 <= j.projected_finish loop rem := rem + 1; w := w + 7; end loop;
  return case when rem > 0 then act + burn * rem else greatest(act, j.projected_hrs) end;
end
$$;

-- ---------------------------------------------------------------- alerts
create function app.post_alert(p_rule text, p_title text, p_body text, p_to text[], p_job uuid default null, p_person uuid default null) returns void
  language sql security definer set search_path = public, pg_temp as $$
  insert into public.alerts (rule, title, body, recipients, job_id, person_id) values (p_rule, p_title, p_body, p_to, p_job, p_person)
$$;

create function app.d(x date) returns text language sql immutable as $$ select coalesce(to_char(x, 'Mon FMDD'), 'blank') $$;
create function app.n0(x numeric) returns text language sql immutable as $$ select to_char(round(x), 'FM999,999,990') $$;
create function app.n1(x numeric) returns text language sql immutable as $$ select rtrim(rtrim(to_char(round(x, 1), 'FM999,990.0'), '0'), '.') $$;
create function app.me_name() returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select name from public.app_users where auth_user_id = auth.uid()), 'system')
$$;

create function app.job_recipients(j public.jobs) returns text[]
  language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    'PM ' || coalesce((select name from public.project_managers where code = j.pm_code), j.pm_code),
    (select name from public.people where id = j.leader_id),
    'Leadership'], null)
$$;

-- Men or leaders short in the next 8 weeks. Fires when the set of gap weeks changes.
create function app.capacity_check() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w0 date := app.planning_week();
  gap_key text;
  lines text;
  n integer;
  open_key text;
  open_lines text;
  open_n integer;
begin
  -- Loading sample data runs the check once at the end, not on every insert.
  if current_setting('app.seeding', true) = 'on' then return; end if;
  select string_agg(week::text, ','), count(*),
         string_agg('Week ending ' || app.d(week) || ': ' || concat_ws('; ',
           case when sold > available then app.n0(sold) || ' hrs scheduled vs ' || app.n0(available) || ' available' end,
           case when leaders_needed > leaders_available then app.n1(leaders_needed) || ' leaders needed vs ' || app.n1(leaders_available) || ' available' end), E'\n' order by week)
    into gap_key, n, lines
    from app.week_totals(w0, 8) where sold > available or leaders_needed > leaders_available;
  if gap_key is not null and gap_key is distinct from (select value from public.alert_state where key = 'gap') then
    perform app.post_alert('gap', 'Capacity gap in ' || n || ' of the next 8 weeks', lines, array['Leadership']);
  end if;
  insert into public.alert_state (key, value) values ('gap', coalesce(gap_key, ''))
    on conflict (key) do update set value = excluded.value, at = now();

  select string_agg(week::text, ','), count(*),
         string_agg('Week ending ' || app.d(week) || ': ' || app.n0(available - sold) || ' hrs open, about ' || app.n0((available - sold) / app.setting('hoursPerManWeek')) || ' men', E'\n' order by week)
    into open_key, open_n, open_lines
    from app.week_totals(w0, 13)
   where week between w0 + (app.setting('openWindowStartWeeks')::int * 7) and w0 + (app.setting('openWindowEndWeeks')::int * 7)
     and available - sold >= app.setting('openCapacityHrs');
  if open_key is not null and open_key is distinct from (select value from public.alert_state where key = 'open') then
    perform app.post_alert('open', 'Open capacity to sell: ' || open_n || ' week' || case when open_n > 1 then 's' else '' end || ' '
      || app.setting('openWindowStartWeeks') || ' to ' || app.setting('openWindowEndWeeks') || ' weeks out',
      open_lines || E'\nFast lane: existing accounts run about a month from quote to crews, so this is the window to sell into.',
      array['Sales team', 'Leadership']);
  end if;
  insert into public.alert_state (key, value) values ('open', coalesce(open_key, ''))
    on conflict (key) do update set value = excluded.value, at = now();
end
$$;

create function app.capacity_check_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.capacity_check();
  return null;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'plan_overrides', 'time_off', 'people', 'actual_hours', 'settings'] loop
    execute format('create trigger capacity_check after insert or update on public.%I for each statement execute function app.capacity_check_trigger()', t);
  end loop;
end
$$;

-- Date moved, firmness off or onto Locked, on or off hold, crew size or leader changed.
create function app.job_alerts() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who text := app.me_name();
  lines text[] := '{}';
  title text := new.number || ' ' || new.customer;
begin
  if new.start is distinct from old.start then lines := lines || ('Start ' || app.d(old.start) || ' → ' || app.d(new.start)); end if;
  if new.projected_finish is distinct from old.projected_finish then lines := lines || ('Projected finish ' || app.d(old.projected_finish) || ' → ' || app.d(new.projected_finish)); end if;
  if new.must_finish is distinct from old.must_finish then lines := lines || ('Must finish ' || app.d(old.must_finish) || ' → ' || app.d(new.must_finish)); end if;
  if cardinality(lines) > 0 then
    if new.must_finish is not null and new.projected_finish > new.must_finish then
      lines := lines || ('Projected finish is now after the must-finish date of ' || app.d(new.must_finish) || '.');
    end if;
    perform app.post_alert('date', 'Date moved: ' || title, array_to_string(lines || ('Changed by ' || who || '.'), E'\n'), app.job_recipients(new), new.id);
  end if;

  if new.firmness is distinct from old.firmness and 'locked' in (old.firmness, new.firmness) then
    perform app.post_alert('date', 'Firmness changed: ' || title,
      old.firmness || ' → ' || new.firmness || coalesce(E'\nReason: ' || nullif(trim(new.firmness_reason), ''), '') || E'\nChanged by ' || who || '.',
      app.job_recipients(new), new.id);
  end if;

  if new.status is distinct from old.status and 'on_hold' in (old.status, new.status) then
    perform app.post_alert('date',
      case when new.status = 'on_hold' then 'On hold: ' else 'Off hold: ' end || title,
      case when new.status = 'on_hold'
        then new.hold_reason || '. Expected restart ' || app.d(new.hold_until) || '. Hours come out of capacity until then.'
        else 'Back in the capacity count from ' || app.d(new.start) || '.' end || E'\nChanged by ' || who || '.',
      app.job_recipients(new), new.id);
  end if;

  lines := '{}';
  if new.crew_size is distinct from old.crew_size then lines := lines || ('Crew size ' || old.crew_size || ' → ' || new.crew_size); end if;
  if new.leader_id is distinct from old.leader_id then
    lines := lines || ('Job leader ' || coalesce((select name from public.people where id = old.leader_id), 'none') || ' → '
                                     || coalesce((select name from public.people where id = new.leader_id), 'none'));
  end if;
  if cardinality(lines) > 0 then
    perform app.post_alert('crew', 'Crew change: ' || title, array_to_string(lines || ('Changed by ' || who || '.'), E'\n'), app.job_recipients(new), new.id);
  end if;
  return null;
end
$$;
create trigger job_alerts after update on public.jobs for each row execute function app.job_alerts();

-- DOT physicals (drivers only) and certifications at 60 and 30 days, and on expiry. Once per step.
create function app.cert_reminders() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w date := app.planning_week();
  r record;
  days integer;
  step integer;
  k text;
  sent integer := 0;
begin
  for r in
    select pp.id, pp.name, 'DOT physical' item, pv.dot_expires expires
      from public.people pp join public.people_private pv on pv.person_id = pp.id
     where pp.active and pp.driver and pv.dot_expires is not null
    union all
    select pp.id, pp.name, pq.qualification, pq.expires
      from public.people pp join public.person_qualifications pq on pq.person_id = pp.id
     where pp.active and pq.active and pq.expires is not null
  loop
    days := r.expires - w;
    step := case when days < 0 then 0 when days <= app.setting('certSecondDays') then app.setting('certSecondDays')
                 when days <= app.setting('certFirstDays') then app.setting('certFirstDays') end;
    continue when step is null;
    k := 'cert|' || r.id || '|' || r.item || '|' || r.expires || '|' || step;
    continue when exists (select 1 from public.alert_state where key = k);
    insert into public.alert_state (key, value) values (k, 'sent');
    perform app.post_alert('cert',
      r.item || case when days < 0 then ' expired: ' else ' expiring: ' end || r.name,
      r.name || '’s ' || r.item || ' ' || case when days < 0 then 'expired ' || to_char(r.expires, 'Mon FMDD, YYYY')
        else 'expires in ' || days || ' days (' || to_char(r.expires, 'Mon FMDD, YYYY') || ')' end || '. Reminder to '
        || split_part(r.name, ' ', 1) || ', copy to the scheduler.'
        || case when r.item = 'DOT physical' then ' Without a current card they can’t drive company vehicles, and the schedule will flag them.' else '' end,
      array[r.name, 'Scheduler'], null, r.id);
    sent := sent + 1;
  end loop;
  return sent;
end
$$;

-- Who sees which alert: the demo's routing (alertsFor), checked here so it holds in the database.
create function app.can_see_alert(p_rule text, p_job uuid, p_to text[]) returns boolean
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
    when 'pm' then return p_rule = 'digest' or (p_rule = 'wo' and u.name = any (p_to)) or (p_rule <> 'bill' and j.pm_code = u.pm_code);
    when 'sales_rep' then return p_rule in ('open', 'digest') or (p_rule = 'wo' and u.name = any (p_to)) or (p_rule <> 'bill' and j.rep_code = u.rep_code);
    when 'superintendent' then return p_rule = 'digest' or (p_rule not in ('bill', 'wo') and j.leader_id = u.person_id) or (p_rule = 'cert' and my_person_name = any (p_to));
    when 'field_crew' then return (p_rule = 'cert' and my_person_name = any (p_to))
      or (p_rule not in ('bill', 'wo') and exists (select 1 from public.assignments a where a.job_id = p_job and a.person_id = u.person_id and a.active
                                                 and a.week in (app.planning_week(), app.planning_week() + 7)));
    else return false;
  end case;
end
$$;

-- ---------------------------------------------------------------- the weekly close
-- Archives the week's hours, marks finished jobs complete, records the board metrics,
-- snapshots the forecast, fires alerts and rolls the schedule to the next week, in one step.
create function public.close_week(p jsonb) returns jsonb
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

  for e in select * from jsonb_array_elements(coalesce(p -> 'entries', '[]'::jsonb)) loop
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
         round(sum(j.contract_cents::numeric * greatest(0, j.projected_hrs - coalesce(a.done, 0)) / greatest(1, j.projected_hrs))),
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

-- The week the schedule is on, and the next week to close, for the app header and Weekly close.
create function public.schedule_weeks() returns jsonb
  language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('planningWeek', app.planning_week(), 'weekToClose', app.week_to_close(),
                            'lastClosed', (select max(week) from public.week_closes))
$$;

-- The Monday digest, written by the app from the same numbers the dashboard shows.
create function public.post_digest(p_title text, p_body text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler') then
    raise exception 'Only the scheduler or an admin sends the digest' using errcode = '42501';
  end if;
  perform app.post_alert('digest', p_title, p_body, array['Leadership team']);
end
$$;

-- A leader confirms the crews on their jobs for the week.
create function public.confirm_my_crews() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := (select person_id from public.app_users where auth_user_id = auth.uid() and active and role = 'superintendent');
  w date := app.planning_week();
  n integer;
begin
  if me is null then raise exception 'Only a job leader confirms crews' using errcode = '42501'; end if;
  insert into public.crew_confirmations (job_id, week)
  select j.id, w from public.jobs j
   where j.leader_id = me and j.active and j.status not in ('complete', 'on_hold') and j.start <= w and j.projected_finish >= w - 4
  on conflict (job_id, week) do update set active = true;
  get diagnostics n = row_count;
  return n;
end
$$;

-- "Got it": a crew member saw their week.
create function public.acknowledge_week(p_week date) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := (select person_id from public.app_users where auth_user_id = auth.uid() and active);
begin
  if me is null then raise exception 'This sign-in isn''t linked to a person on the roster' using errcode = '42501'; end if;
  insert into public.field_acknowledgments (person_id, week) values (me, p_week) on conflict do nothing;
end
$$;

-- My week: only what the person needs about the jobs they're on this week and next.
create function public.my_week() returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := (select person_id from public.app_users where auth_user_id = auth.uid() and active);
  w date := app.planning_week();
begin
  if me is null then return null; end if;
  return jsonb_build_object(
    'person', (select jsonb_build_object('id', pp.id, 'name', pp.name, 'driver', pp.driver, 'dotExpires', pv.dot_expires)
                 from public.people pp left join public.people_private pv on pv.person_id = pp.id where pp.id = me),
    'certs', coalesce((select jsonb_agg(jsonb_build_object('name', qualification, 'expires', expires) order by qualification)
                         from public.person_qualifications where person_id = me and active), '[]'::jsonb),
    'weeks', (select jsonb_agg(jsonb_build_object(
        'week', wk,
        'acknowledged', (select to_char(fa.created_at at time zone 'America/Chicago', 'Dy FMHH12:MI AM') from public.field_acknowledgments fa where fa.person_id = me and fa.week = wk),
        'timeOff', coalesce((select jsonb_agg(jsonb_build_object('firstDay', t.first_day, 'lastDay', t.last_day, 'type', t.type))
                               from public.time_off t where t.person_id = me and t.active and t.first_day <= wk and t.last_day >= wk - 4), '[]'::jsonb),
        'jobs', coalesce((select jsonb_agg(jsonb_build_object(
            'number', j.number, 'customer', j.customer, 'jobType', j.job_type, 'location', j.location,
            'from', greatest(j.start, wk - 4), 'to', least(j.projected_finish, wk),
            'siteAddress', j.site_address, 'siteStartTime', j.site_start_time, 'siteContact', j.site_contact,
            'siteOrientation', j.site_orientation, 'sitePpe', j.site_ppe,
            'leader', (select name from public.people where id = j.leader_id),
            'leaderPhone', (select phone from public.people_private where person_id = j.leader_id),
            'notes', coalesce((select jsonb_agg(n.body order by n.created_at) from public.job_notes n where n.job_id = j.id and n.active and n.crew_visible), '[]'::jsonb),
            'crew', coalesce((select jsonb_agg(split_part(cp.name, ' ', 1) order by cp.name) from public.assignments ca join public.people cp on cp.id = ca.person_id
                               where ca.job_id = j.id and ca.week = wk and ca.active), '[]'::jsonb)) order by j.start)
            from public.jobs j join public.assignments a on a.job_id = j.id and a.person_id = me and a.week = wk and a.active
           where j.active and j.status not in ('complete', 'on_hold')), '[]'::jsonb)) order by wk)
      from unnest(array[w, w + 7]) wk));
end
$$;

-- ---------------------------------------------------------------- security
do $$
declare
  t text;
begin
  foreach t in array array['week_closes', 'hour_entries', 'crew_confirmations', 'field_acknowledgments'] loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function app.touch()', t);
    execute format('create trigger log_change after insert or update on public.%I for each row execute function app.log_change()', t);
  end loop;
  foreach t in array array['week_closes', 'hour_entries', 'forecast_snapshots', 'weekly_metrics', 'crew_confirmations',
                           'field_acknowledgments', 'alerts', 'alert_mutes', 'alert_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

grant select on public.week_closes, public.forecast_snapshots, public.weekly_metrics, public.crew_confirmations, public.alerts to authenticated;
grant select, insert, update on public.hour_entries, public.alert_mutes to authenticated;

create policy read on public.week_closes for select to authenticated using (app.is_member() and not app.role_in('field_crew'));
create policy read on public.weekly_metrics for select to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy read on public.forecast_snapshots for select to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy read on public.crew_confirmations for select to authenticated using (app.can_see_job(job_id));
create policy read on public.alerts for select to authenticated using (app.can_see_alert(rule, job_id, recipients));

-- PMs enter hours for their own jobs during the week; the scheduler and admins for any job (decision 9).
create policy read on public.hour_entries for select to authenticated using (app.can_see_job(job_id));
create policy write on public.hour_entries for insert to authenticated with check (app.can_edit_job(job_id, 'actuals'));
create policy edit on public.hour_entries for update to authenticated using (app.can_edit_job(job_id, 'actuals'));

create policy own on public.alert_mutes for all to authenticated
  using (user_id = (select id from public.app_users where auth_user_id = auth.uid()))
  with check (user_id = (select id from public.app_users where auth_user_id = auth.uid()));

-- The 'actuals' rule joins the field rules in app.can_edit (same table as src/domain/permissions.ts).
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
    else return false;
  end case;
  return r = any (any_roles) or (r = any (own_roles) and app.owns(p_leader, p_rep, p_pm));
end
$$;

-- Internal math stays internal; the app reaches it only through the functions above.
revoke all on all functions in schema app from public;
grant execute on function app.my_role(), app.is_member(), app.role_in(public.app_role[]), app.owns(uuid, text, text),
  app.can_see(uuid, text, text), app.can_see_job(uuid), app.can_edit(text, uuid, text, text), app.can_edit_job(uuid, text),
  app.can_see_alert(text, uuid, text[]), app.is_friday(date), app.today(), app.week_ending(date)
  to authenticated;
revoke all on function public.close_week(jsonb), public.schedule_weeks(), public.post_digest(text, text),
  public.confirm_my_crews(), public.acknowledge_week(date), public.my_week() from public, anon;
grant execute on function public.close_week(jsonb), public.schedule_weeks(), public.post_digest(text, text),
  public.confirm_my_crews(), public.acknowledge_week(date), public.my_week() to authenticated;
