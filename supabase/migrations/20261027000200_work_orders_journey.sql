-- TMI Ops, batch B: work orders (draft, four sign-offs in order, send-back, final filed in
-- Procore) and the job journey (admin-editable stages and checkpoints, decision 23).

insert into public.settings (key, value, label) values
  ('woReviewDays', '2', 'Work order review deadline (days per step)'),
  ('woStartSoonDays', '14', 'Flag jobs starting within this many days without a final work order'),
  ('journeyLookaheadDays', '21', 'Job journey: "starting soon" window (days)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- work orders
create table public.work_orders (
  job_id uuid primary key references public.jobs (id),
  version integer not null default 0,
  current_step integer not null default 0 check (current_step between 0 and 4),
  since date not null default app.today(),
  final boolean not null default false,
  filed boolean not null default false,
  file_name text,
  file_path text,
  returned_by text,
  returned_role text,
  returned_comment text,
  returned_at timestamptz,
  last_ping_key text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.work_order_signoffs (
  job_id uuid not null references public.jobs (id),
  version integer not null,
  step integer not null check (step between 0 and 3),
  by_name text not null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, version, step)
);

create table public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  at timestamptz not null default now(),
  who text not null,
  action text not null,
  note text not null default ''
);
create index on public.work_order_events (job_id, at desc);

-- Step 0 estimator (hours and scope), 1 sales rep (contract terms), 2 PM (execution plan), 3 scheduler (crew and dates).
create function app.wo_step_role(p_step integer) returns text language sql immutable as $$
  select (array['Estimator', 'Sales rep', 'PM', 'Scheduler'])[p_step + 1] $$;
create function app.wo_step_what(p_step integer) returns text language sql immutable as $$
  select (array['Hours and scope', 'Contract terms', 'Execution plan', 'Crew and dates'])[p_step + 1] $$;

-- The person who signs a step on this job, by name (the name alerts are addressed to).
create function app.wo_step_who(j public.jobs, p_step integer) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select case p_step
    when 0 then j.estimator
    when 1 then coalesce((select name from public.sales_reps where code = j.rep_code), j.rep_code)
    when 2 then coalesce((select name from public.project_managers where code = j.pm_code), j.pm_code)
    else coalesce((select string_agg(name, ', ' order by name) from public.app_users where role = 'scheduler' and active), 'Scheduler')
  end
$$;

create function app.job_setup_names() returns text[]
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(name order by name), array['Job setup']) from public.app_users where role = 'job_setup' and active
$$;

create function app.wo_status(w public.work_orders) returns text language sql immutable as $$
  select case when w.final then 'Final' when w.returned_comment is not null then 'Returned'
              when w.file_name is null then 'Awaiting draft' when w.current_step = 0 then 'Draft' else 'In review' end
$$;

-- Is the signed-in person the one this step waits on?
create function app.wo_is_mine(j public.jobs, p_step integer) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users u where u.auth_user_id = auth.uid() and u.active and (
    (p_step = 0 and u.role = 'estimator' and u.name = j.estimator) or
    (p_step = 1 and u.role = 'sales_rep' and u.rep_code = j.rep_code) or
    (p_step = 2 and u.role = 'pm' and u.pm_code = j.pm_code) or
    (p_step = 3 and u.role = 'scheduler')))
$$;

create function app.wo_event(p_job uuid, p_action text, p_note text default '') returns void
  language sql security definer set search_path = public, pg_temp as $$
  insert into public.work_order_events (job_id, who, action, note) values (p_job, app.me_name(), p_action, coalesce(p_note, ''))
$$;

-- A sold job is booked at once; its work order opens beside it, waiting for Lori's draft.
create function app.wo_open_for_job() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.work_orders (job_id, since) values (new.id, app.today()) on conflict do nothing;
  if current_setting('app.seeding', true) is distinct from 'on' then
    perform app.wo_event(new.id, 'Job booked on the schedule. Work order opened, awaiting a draft.');
    perform app.post_alert('wo', 'New job booked, draft the work order: ' || new.number || ' ' || new.customer,
      'Booked on the schedule now for ' || app.d(new.start) || ' to ' || app.d(new.projected_finish) || E'. The work order runs alongside it.\n'
      || 'Draft it in Claude from the estimate and the proposal or contract, using the TMI work order template, then upload it to the job. Estimator: ' || new.estimator || '.',
      app.job_setup_names(), new.id);
  end if;
  return null;
end
$$;
create trigger wo_open after insert on public.jobs for each row execute function app.wo_open_for_job();
-- Jobs that already exist get a work order waiting for a draft.
insert into public.work_orders (job_id) select id from public.jobs on conflict do nothing;

create function public.wo_upload(p_job uuid, p_file_name text, p_file_path text default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders;
  j public.jobs;
  was_returned boolean;
begin
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

create function public.wo_approve(p_job uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders;
  j public.jobs;
  s integer;
  who text;
begin
  select * into w from public.work_orders where job_id = p_job for update;
  select * into j from public.jobs where id = p_job;
  if app.wo_status(w) not in ('Draft', 'In review') then raise exception 'Nothing to sign off on this work order' using errcode = '23514'; end if;
  s := w.current_step;
  if not (app.role_in('admin', 'ceo', 'cfo') or app.wo_is_mine(j, s)) then
    raise exception 'This step is waiting on %', app.wo_step_who(j, s) using errcode = '42501';
  end if;
  who := app.wo_step_who(j, s);
  insert into public.work_order_signoffs (job_id, version, step, by_name) values (p_job, w.version, s, app.me_name());
  perform app.wo_event(p_job, app.wo_step_role(s) || ' sign-off: ' || lower(app.wo_step_what(s)) || ' approved'
    || case when app.wo_is_mine(j, s) then '' else ', for ' || who end || '.');
  if s = 3 then
    update public.work_orders set current_step = 4, final = true, since = app.today() where job_id = p_job;
    perform app.wo_event(p_job, 'Work order final. All four sign-offs complete.');
    perform app.post_alert('wo', 'Work order final: ' || j.number || ' ' || j.customer,
      E'Estimator, rep, PM and scheduler have all signed off.\nLori files the final in Procore as the work order of record. TMI Ops shows it from there.',
      app.job_setup_names() || array[app.wo_step_who(j, 2), app.wo_step_who(j, 1), app.wo_step_who(j, 3)], p_job);
  else
    update public.work_orders set current_step = s + 1, since = app.today() where job_id = p_job;
    perform app.post_alert('wo', 'Work order ready for your sign-off: ' || j.number || ' ' || j.customer,
      app.wo_step_role(s) || ' signed off on ' || lower(app.wo_step_what(s)) || '. Your step: ' || lower(app.wo_step_what(s + 1))
      || '. Due in ' || app.setting('woReviewDays') || ' days.', array[app.wo_step_who(j, s + 1)], p_job);
  end if;
end
$$;

create function public.wo_return(p_job uuid, p_comment text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w public.work_orders;
  j public.jobs;
  s integer;
begin
  select * into w from public.work_orders where job_id = p_job for update;
  select * into j from public.jobs where id = p_job;
  if app.wo_status(w) not in ('Draft', 'In review') then raise exception 'Nothing to send back on this work order' using errcode = '23514'; end if;
  s := w.current_step;
  if not (app.role_in('admin', 'ceo', 'cfo') or app.wo_is_mine(j, s)) then
    raise exception 'This step is waiting on %', app.wo_step_who(j, s) using errcode = '42501';
  end if;
  if coalesce(trim(p_comment), '') = '' then raise exception 'Add a comment so Lori knows what to fix' using errcode = '23514'; end if;
  update public.work_orders set returned_by = app.me_name(), returned_role = app.wo_step_role(s), returned_comment = trim(p_comment),
         returned_at = now(), current_step = 0, since = app.today()
   where job_id = p_job;
  perform app.wo_event(p_job, 'Sent back by the ' || lower(app.wo_step_role(s)) || '.', trim(p_comment));
  perform app.post_alert('wo', 'Work order sent back: ' || j.number || ' ' || j.customer,
    app.me_name() || ', at the ' || case when s = 2 then 'PM' else lower(app.wo_step_role(s)) end || ' step: ' || trim(p_comment)
      || E'\nLori revises the draft and re-uploads it. Sign-offs restart with the estimator.',
    app.job_setup_names() || array[app.wo_step_who(j, 2)], p_job);
end
$$;

create function public.wo_mark_filed(p_job uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup') then
    raise exception 'Only job setup, the scheduler or an admin marks it filed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_orders where job_id = p_job and final and not filed) then
    raise exception 'Only a final work order can be marked filed' using errcode = '23514';
  end if;
  update public.work_orders set filed = true where job_id = p_job;
  perform app.wo_event(p_job, 'Final filed in Procore as the work order of record.');
end
$$;

-- A step past its deadline pings the PM, once per step.
create function app.wo_check() returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  k text;
  st text;
  lori boolean;
  who text;
  what text;
begin
  if current_setting('app.seeding', true) = 'on' then return; end if;
  for r in select w.*, j.number, j.customer, j.start, j.estimator, j.rep_code, j.pm_code, j.id jid
             from public.work_orders w join public.jobs j on j.id = w.job_id
            where j.active and j.status <> 'complete' and not w.final and app.today() - w.since > app.setting('woReviewDays') loop
    st := case when r.returned_comment is not null then 'Returned' when r.file_name is null then 'Awaiting draft' when r.current_step = 0 then 'Draft' else 'In review' end;
    k := r.since || '|' || st || '|' || r.current_step;
    continue when r.last_ping_key is not distinct from k;
    update public.work_orders set last_ping_key = k where job_id = r.job_id;
    lori := st in ('Awaiting draft', 'Returned');
    who := case when lori then array_to_string(app.job_setup_names(), ', ')
                else app.wo_step_who((select j from public.jobs j where j.id = r.jid), r.current_step) end;
    what := case st when 'Awaiting draft' then 'the draft' when 'Returned' then 'the revised draft' else lower(app.wo_step_what(r.current_step)) end;
    perform app.post_alert('wo', 'Work order review late: ' || r.number || ' ' || r.customer,
      'Waiting ' || (app.today() - r.since) || ' days on ' || who || ' for ' || what || '. The review deadline is ' || app.setting('woReviewDays')
        || E' days.\nJob starts ' || app.d(r.start) || '. PM ' || app.wo_step_who((select j from public.jobs j where j.id = r.jid), 2) || ' pinged.',
      array[app.wo_step_who((select j from public.jobs j where j.id = r.jid), 2)] || case when lori then app.job_setup_names() else array[who] end,
      r.job_id);
  end loop;
end
$$;

-- ---------------------------------------------------------------- job journey
create table public.journey_stages (
  key text primary key,
  label text not null,
  sort integer not null,
  startup boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.journey_checkpoints (
  key text primary key,
  stage_key text not null references public.journey_stages (key),
  label text not null,
  owner text not null check (owner in ('sales_rep', 'job_setup', 'pm', 'scheduler', 'accounting')),
  offset_days integer not null,
  anchor text not null check (anchor in ('start', 'finish')),
  auto_source text check (auto_source in ('wo_final', 'mobilized', 'work_complete', 'final_invoice')),
  sort integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.job_checkpoints (
  job_id uuid not null references public.jobs (id),
  checkpoint_key text not null references public.journey_checkpoints (key),
  done_by text not null,
  done_at timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, checkpoint_key)
);

-- The demo's journey, as starting definitions an admin can change.
insert into public.journey_stages (key, label, sort, startup) values
  ('sold', 'Sold and set up', 1, true),
  ('wo', 'Work order', 2, true),
  ('paper', 'Paperwork', 3, true),
  ('mat', 'Materials', 4, true),
  ('equip', 'Equipment and travel', 5, true),
  ('hand', 'Crew handoff', 6, true),
  ('prog', 'In progress', 7, false),
  ('punch', 'Punch and acceptance', 8, false),
  ('close', 'Closeout', 9, false);

insert into public.journey_checkpoints (key, stage_key, label, owner, offset_days, anchor, auto_source, sort) values
  ('po', 'sold', 'Contract or PO received', 'sales_rep', -35, 'start', null, 1),
  ('setup', 'sold', 'Job entered and Procore project created', 'job_setup', -30, 'start', null, 2),
  ('wofinal', 'wo', 'Work order final', 'pm', -21, 'start', 'wo_final', 3),
  ('sub', 'paper', 'Submittals and product data approved', 'pm', -21, 'start', null, 4),
  ('coi', 'paper', 'Insurance certificate and bonds', 'job_setup', -14, 'start', null, 5),
  ('safety', 'paper', 'Safety plan, hazard analysis and permits', 'pm', -7, 'start', null, 6),
  ('ord', 'mat', 'Materials ordered, lead time confirmed', 'pm', -21, 'start', null, 7),
  ('del', 'mat', 'Materials delivered', 'pm', -3, 'start', null, 8),
  ('rent', 'equip', 'Lifts, rentals, trucks and hotels booked', 'scheduler', -7, 'start', null, 9),
  ('crew', 'hand', 'Leader and crew confirmed', 'scheduler', -7, 'start', null, 10),
  ('badge', 'hand', 'Orientation or badging booked', 'pm', -5, 'start', null, 11),
  ('prejob', 'hand', 'Pre-job meeting with the leader', 'pm', -3, 'start', null, 12),
  ('mob', 'prog', 'Crew mobilized', 'scheduler', 0, 'start', 'mobilized', 13),
  ('wdone', 'prog', 'Work complete', 'pm', 0, 'finish', 'work_complete', 14),
  ('walk', 'punch', 'Final walk and customer sign-off', 'pm', 3, 'finish', null, 15),
  ('inv', 'close', 'Final invoice sent', 'accounting', 7, 'finish', 'final_invoice', 16),
  ('cause', 'close', 'Closeout cause tagged for the scorecard', 'pm', 7, 'finish', null, 17),
  ('warr', 'close', 'Warranty letter and closeout documents sent', 'pm', 14, 'finish', null, 18);

-- Automatic checkpoints read the state they stand for. The final invoice joins in batch C.
create function app.checkpoint_auto_done(p_job uuid, p_source text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select case p_source
    when 'wo_final' then coalesce((select final from public.work_orders where job_id = p_job), true)
    when 'mobilized' then exists (select 1 from public.jobs where id = p_job and status in ('active', 'complete'))
                       or exists (select 1 from public.actual_hours where job_id = p_job and active)
    when 'work_complete' then exists (select 1 from public.jobs where id = p_job and status = 'complete')
    else false
  end
$$;

-- Who may tick a checkpoint: its owner on their own jobs, the scheduler or job setup on theirs,
-- accounting and the CFO on accounting's, admin/CEO/CFO on any. Automatic ones tick themselves.
create function app.can_check(p_job uuid, p_key text) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.journey_checkpoints;
  r public.app_role := app.my_role();
begin
  select * into c from public.journey_checkpoints where key = p_key and active;
  if not found or c.auto_source is not null or r is null or not app.can_see_job(p_job) then return false; end if;
  if r in ('admin', 'ceo', 'cfo') then return true; end if;
  return case c.owner
    when 'scheduler' then r = 'scheduler'
    when 'job_setup' then r = 'job_setup'
    when 'accounting' then r = 'accounting'
    when 'pm' then r = 'pm' and app.can_see_job(p_job)
    when 'sales_rep' then r = 'sales_rep' and app.can_see_job(p_job)
    else false
  end;
end
$$;

create function public.set_checkpoint(p_job uuid, p_key text, p_done boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_check(p_job, p_key) then raise exception 'That checkpoint belongs to someone else' using errcode = '42501'; end if;
  if p_done then
    insert into public.job_checkpoints (job_id, checkpoint_key, done_by) values (p_job, p_key, app.me_name())
    on conflict (job_id, checkpoint_key) do update set active = true, done_by = excluded.done_by, done_at = now();
  else
    update public.job_checkpoints set active = false where job_id = p_job and checkpoint_key = p_key;
  end if;
end
$$;

-- ---------------------------------------------------------------- security
do $$
declare
  t text;
begin
  foreach t in array array['work_orders', 'work_order_signoffs', 'journey_stages', 'journey_checkpoints', 'job_checkpoints'] loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function app.touch()', t);
    execute format('create trigger log_change after insert or update on public.%I for each row execute function app.log_change()', t);
  end loop;
  foreach t in array array['work_orders', 'work_order_signoffs', 'work_order_events', 'journey_stages', 'journey_checkpoints', 'job_checkpoints'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- The change log names a checkpoint and a stage by its key.
create or replace function app.log_change() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  who uuid := auth.uid();
  who_name text;
  rid text;
  jid uuid;
  pid uuid;
  lbl text := '';
  k text;
  skip text[] := array['created_at', 'created_by', 'updated_at', 'updated_by'];
begin
  if current_setting('app.seeding', true) = 'on' then return null; end if;
  who_name := coalesce((select name from public.app_users where auth_user_id = who), case when who is null then 'system' else 'unknown user' end);
  rid := case tg_table_name
    when 'plan_overrides' then (n ->> 'job_id') || '|' || (n ->> 'week')
    when 'job_requirements' then (n ->> 'job_id') || '|' || (n ->> 'qualification')
    when 'person_qualifications' then (n ->> 'person_id') || '|' || (n ->> 'qualification')
    when 'people_private' then n ->> 'person_id'
    when 'settings' then n ->> 'key'
    when 'sales_reps' then n ->> 'code'
    when 'project_managers' then n ->> 'code'
    when 'qualifications' then n ->> 'name'
    when 'journey_stages' then n ->> 'key'
    when 'journey_checkpoints' then n ->> 'key'
    when 'job_checkpoints' then (n ->> 'job_id') || '|' || (n ->> 'checkpoint_key')
    when 'work_order_signoffs' then (n ->> 'job_id') || '|' || (n ->> 'version') || '|' || (n ->> 'step')
    else coalesce(n ->> 'id', concat_ws('|', n ->> 'job_id', n ->> 'person_id', n ->> 'week'))
  end;
  jid := case when tg_table_name = 'jobs' then (n ->> 'id')::uuid else (n ->> 'job_id')::uuid end;
  pid := case when tg_table_name = 'people' then (n ->> 'id')::uuid else (n ->> 'person_id')::uuid end;
  if jid is not null then lbl := coalesce((select 'Job ' || number from public.jobs where id = jid), ''); end if;
  if pid is not null then lbl := concat_ws(' · ', nullif(lbl, ''), (select name from public.people where id = pid)); end if;
  if tg_table_name = 'app_users' then lbl := 'User ' || (n ->> 'email'); end if;
  if tg_table_name = 'settings' then lbl := 'Setting ' || (n ->> 'label'); end if;
  if tg_table_name in ('journey_stages', 'journey_checkpoints') then lbl := 'Journey ' || (n ->> 'label'); end if;
  if tg_table_name = 'job_checkpoints' then
    lbl := lbl || ' · ' || coalesce((select label from public.journey_checkpoints where key = n ->> 'checkpoint_key'), n ->> 'checkpoint_key');
  end if;

  if tg_op = 'INSERT' then
    insert into public.change_log (user_id, user_name, table_name, record_id, record_label, job_id, field, old_value, new_value)
    values (who, who_name, tg_table_name, rid, lbl, jid, 'added', null, (n - skip)::text);
  else
    for k in select jsonb_object_keys(n) loop
      continue when k = any (skip);
      if (o -> k) is distinct from (n -> k) then
        insert into public.change_log (user_id, user_name, table_name, record_id, record_label, job_id, field, old_value, new_value)
        values (who, who_name, tg_table_name, rid, lbl, jid, k, o ->> k, n ->> k);
      end if;
    end loop;
  end if;
  return null;
end
$$;

grant select on public.work_orders, public.work_order_signoffs, public.work_order_events, public.journey_stages, public.job_checkpoints to authenticated;
grant select, insert, update on public.journey_checkpoints, public.journey_stages to authenticated;

create policy read on public.work_orders for select to authenticated using (app.can_see_job(job_id));
create policy read on public.work_order_signoffs for select to authenticated using (app.can_see_job(job_id));
create policy read on public.work_order_events for select to authenticated using (app.can_see_job(job_id));
create policy read on public.job_checkpoints for select to authenticated using (app.can_see_job(job_id));
create policy read on public.journey_stages for select to authenticated using (app.is_member());
create policy edit on public.journey_stages for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));
create policy write on public.journey_stages for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));
create policy read on public.journey_checkpoints for select to authenticated using (app.is_member());
create policy edit on public.journey_checkpoints for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));
create policy write on public.journey_checkpoints for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));

-- Late work order reviews are checked with the capacity checks.
create or replace function app.capacity_check_trigger() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.capacity_check();
  perform app.wo_check();
  return null;
end
$$;
create trigger capacity_check after insert or update on public.work_orders for each statement execute function app.capacity_check_trigger();

-- Names of the scheduler and job setup people, so screens can say who a step waits on.
create function public.staff_names() returns jsonb
  language sql stable security definer set search_path = public, pg_temp as $$
  select case when app.is_member() then jsonb_build_object(
    'schedulers', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'scheduler' and active), '[]'::jsonb),
    'jobSetup', coalesce((select jsonb_agg(name order by name) from public.app_users where role = 'job_setup' and active), '[]'::jsonb)) end
$$;
revoke all on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;

revoke all on all functions in schema app from public;
grant execute on function app.can_check(uuid, text) to authenticated;
revoke all on function public.wo_upload(uuid, text, text), public.wo_approve(uuid), public.wo_return(uuid, text),
  public.wo_mark_filed(uuid), public.set_checkpoint(uuid, text, boolean) from public, anon;
grant execute on function public.wo_upload(uuid, text, text), public.wo_approve(uuid), public.wo_return(uuid, text),
  public.wo_mark_filed(uuid), public.set_checkpoint(uuid, text, boolean) to authenticated;

-- Draft files: a private Supabase Storage bucket, one folder per job. Read by anyone who can
-- see the job; added by the roles that upload drafts; never changed or deleted.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('work-orders', 'work-orders', false, 20971520,
            array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    on conflict (id) do nothing;
    execute $p$create policy "work order drafts: read" on storage.objects for select to authenticated
      using (bucket_id = 'work-orders' and app.can_see_job(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "work order drafts: upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'work-orders' and app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup')
                  and app.can_see_job(((storage.foldername(name))[1])::uuid))$p$;
  end if;
end
$$;
