-- Fixes from the demo review (Oct 27): firmness wording, a new leader takes over the crew,
-- journey checkpoints added later don't reach back, and estimators come from the Access list.

create function app.firmness_label(f public.firmness) returns text
  language sql immutable set search_path = public, pg_temp as $$
  select case f
    when 'locked' then 'Locked'
    when 'confirmed' then 'Confirmed, some flexibility'
    when 'waiting' then 'Waiting on another job'
    when 'flexible' then 'Very flexible'
    when 'best_guess' then 'TMI’s best guess'
    when 'fill_in' then 'Fill-in work'
  end
$$;

create or replace function app.firmness_note() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.firmness is distinct from old.firmness and coalesce(trim(new.firmness_reason), '') <> ''
     and new.firmness_reason is distinct from old.firmness_reason then
    insert into public.job_notes (job_id, body, pinned, author_name)
    values (new.id, 'Firmness ' || app.firmness_label(old.firmness) || ' → ' || app.firmness_label(new.firmness) || ': ' || new.firmness_reason,
            old.firmness = 'locked',
            coalesce((select name from public.app_users where auth_user_id = auth.uid()), 'system'));
  end if;
  return null;
end
$$;

create or replace function app.job_alerts() returns trigger
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
      app.firmness_label(old.firmness) || ' → ' || app.firmness_label(new.firmness) || coalesce(E'\nReason: ' || nullif(trim(new.firmness_reason), ''), '') || E'\nChanged by ' || who || '.',
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

-- A new job leader takes the old one's place on the crew from the planning week on.
-- Past weeks keep who was actually there.
create function app.swap_leader() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w date;
begin
  if current_setting('app.seeding', true) = 'on' or new.leader_id is not distinct from old.leader_id then return null; end if;
  for w in
    update public.assignments set active = false
     where job_id = new.id and person_id = old.leader_id and active and week >= app.planning_week()
    returning week
  loop
    if new.leader_id is not null then
      insert into public.assignments (job_id, person_id, week) values (new.id, new.leader_id, w)
      on conflict (job_id, person_id, week) do update set active = true;
    end if;
  end loop;
  return null;
end
$$;
create trigger swap_leader after update of leader_id on public.jobs for each row execute function app.swap_leader();

-- Checkpoints an admin adds from now on apply only where they fall due on or after that day.
alter table public.journey_checkpoints add column applies_from date;
alter table public.journey_checkpoints alter column applies_from set default current_date;

-- Estimators for the Add job pick list, from the Access list.
create or replace function public.staff_names() returns jsonb
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.is_member() then jsonb_build_object(
    'schedulers', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'scheduler' and active), '[]'::jsonb),
    'jobSetup', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'job_setup' and active), '[]'::jsonb),
    'estimators', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'estimator' and active), '[]'::jsonb)) end
$$;

revoke all on all functions in schema app from public;
