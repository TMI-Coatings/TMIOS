-- Controls from the demo review (Oct 27): settings stay in a sensible range, and an admin
-- can't lock themselves out.

-- Same limits as src/domain/settingsRules.ts (the database tests compare the two).
create function app.setting_limits() returns table (key text, min numeric, max numeric, whole boolean)
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
    ('scorecardMonths', 1, 60, true)

$$;

create function app.settings_guard() returns trigger
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
create trigger settings_guard before update on public.settings for each row execute function app.settings_guard();

-- Crew members sign in linked to their person on the roster, like leaders.
alter table public.app_users add constraint crew_needs_person check (role <> 'field_crew' or person_id is not null) not valid;

-- Nobody changes their own role or switches themselves off; another admin does it. And the
-- last person with full rights can't be removed.
create function app.access_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and old.auth_user_id = auth.uid() and (new.role <> old.role or not new.active) then
    raise exception 'You can''t change your own access. Ask another admin' using errcode = '42501';
  end if;
  if old.active and old.role in ('admin', 'ceo', 'cfo') and (not new.active or new.role not in ('admin', 'ceo', 'cfo'))
     and not exists (select 1 from public.app_users where id <> old.id and active and role in ('admin', 'ceo', 'cfo')) then
    raise exception 'Someone has to keep full rights' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger access_guard before update on public.app_users for each row execute function app.access_guard();

revoke all on all functions in schema app from public;
