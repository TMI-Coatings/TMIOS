-- Austin's calls after the review (Oct 27): leaders don't open work order drafts, three more
-- thresholds become admin settings, and people are told apart by more than their display name.

-- 1. Work order drafts can carry contract terms, so job leaders and crew don't open them.
--    Estimators still do: they sign off on hours and scope. A file whose folder isn't a job id
--    is never readable (rather than breaking the bucket listing).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $p$drop policy if exists "work order drafts: read" on storage.objects$p$;
    execute $p$create policy "work order drafts: read" on storage.objects for select to authenticated
      using (bucket_id = 'work-orders'
             and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             and not app.role_in('superintendent', 'field_crew')
             and app.can_see_job(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end
$$;

-- 2. Three more thresholds become admin settings (hard rule 8).
insert into public.settings (key, value, label) values
  ('gapWindowWeeks', '8', 'Flag capacity gaps this many weeks ahead'),
  ('journeySoonDays', '7', 'Job journey: a checkpoint is due soon this many days ahead'),
  ('milestoneDefaults', '[{"label": "Mobilization", "pct": 20}, {"label": "Surface prep complete", "pct": 30}, {"label": "Coatings applied", "pct": 40}]',
   'Default milestones for milestone billing');

create or replace function app.setting_limits() returns table (key text, min numeric, max numeric, whole boolean)
  language sql immutable as $$
  values
    ('absencePct', 0, 50, false),
    ('hoursPerManWeek', 1, 80, false),
    ('dedicatedLeaderHrs', 1, 100000, true),
    ('smallJobLeaderWeight', 0, 1, false),
    ('overrunPct', 1, 200, false),
    ('burdenedRateCents', 100, 50000, true),
    ('targetHeadcount', 1, 1000, true),
    ('confirmDatesDays', 1, 365, true),
    ('openCapacityHrs', 0, 100000, true),
    ('openWindowStartWeeks', 0, 26, true),
    ('openWindowEndWeeks', 1, 26, true),
    ('certFirstDays', 1, 365, true),
    ('certSecondDays', 1, 365, true),
    ('autoFillWeeksOut', 0, 12, true),
    ('woReviewDays', 1, 30, true),
    ('woStartSoonDays', 1, 90, true),
    ('journeyLookaheadDays', 1, 120, true),
    ('payAppDay', 1, 28, true),
    ('invoiceDays', 0, 90, true),
    ('underBilledFlagCents', 0, 100000000, true),
    ('overBilledFlagPct', 0, 100, false),
    ('laborDivergencePts', 1, 100, false),
    ('marginFadePts', 1, 100, false),
    ('scorecardMonths', 1, 60, true),
    ('gapWindowWeeks', 1, 26, true),
    ('journeySoonDays', 1, 60, true)
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
  if new.key = 'milestoneDefaults' and (
       jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) = 0
       or exists (select 1 from jsonb_array_elements(new.value) m
                   where coalesce(trim(m ->> 'label'), '') = '' or jsonb_typeof(m -> 'pct') <> 'number'
                      or (m ->> 'pct')::numeric <= 0 or (m ->> 'pct')::numeric > 100)
       or (select sum((m ->> 'pct')::numeric) from jsonb_array_elements(new.value) m) > 100) then
    raise exception 'Each milestone needs a name and a percent from 1 to 100, adding up to no more than 100' using errcode = '23514';
  end if;
  if new.key = 'closeoutCauses' and (jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) = 0) then
    raise exception 'Keep at least one cause' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function app.capacity_check() returns void
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
    from app.week_totals(w0, app.setting('gapWindowWeeks')::int) where sold > available or leaders_needed > leaders_available;
  if gap_key is not null and gap_key is distinct from (select value from public.alert_state where key = 'gap') then
    perform app.post_alert('gap', 'Capacity gap in ' || n || ' of the next ' || app.setting('gapWindowWeeks') || ' weeks', lines, array['Leadership']);
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

create or replace function public.set_billing_method(p_job uuid, p_method public.billing_method) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'accounting') then raise exception 'Only accounting or an admin changes the billing method' using errcode = '42501'; end if;
  perform app.guard_bypass(true);
  update public.jobs set billing_method = p_method where id = p_job;
  perform app.guard_bypass(false);
  if p_method = 'milestone' and not exists (select 1 from public.milestones where job_id = p_job and active) then
    insert into public.milestones (job_id, label, pct, sort)
    select p_job, m.value ->> 'label', (m.value ->> 'pct')::numeric, m.ordinality
      from jsonb_array_elements((select value from public.settings where key = 'milestoneDefaults')) with ordinality m;
  end if;
end
$$;

-- 3. Alerts and work order sign-offs find people by name, so no two people on the access list,
--    and no two people on the roster, share a name. Renaming an estimator carries their jobs along.
create unique index app_users_unique_name on public.app_users (lower(trim(name))) where active;
create unique index people_unique_name on public.people (lower(trim(name))) where active;

create function app.rename_user() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.name is distinct from old.name then
    perform app.guard_bypass(true);
    update public.jobs set estimator = new.name where estimator = old.name;
    perform app.guard_bypass(false);
  end if;
  return null;
end
$$;
create trigger rename_user after update of name on public.app_users for each row execute function app.rename_user();

revoke all on all functions in schema app from public;
