-- TMI Ops, Phase 1: who can see and change what (hard rule 4), the change log (rule 5)
-- and no deletes (rule 6). The rules mirror src/domain/permissions.ts; tests/db checks
-- every rule there against this file.

-- ---------------------------------------------------------------- helpers
-- The signed-in person's app_users row. Security definer so policies can read it without
-- recursing through app_users' own policies.

create function app.my_role() returns public.app_role
  language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.app_users where auth_user_id = auth.uid() and active
$$;

create function app.is_member() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.my_role() is not null
$$;

create function app.role_in(variadic roles public.app_role[]) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() = any (roles), false)
$$;

-- "Their own job": the leader on it, its sales rep, or its PM.
create function app.owns(p_leader uuid, p_rep text, p_pm text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid() and u.active and (
      (u.role = 'superintendent' and u.person_id = p_leader) or
      (u.role = 'sales_rep' and u.rep_code = p_rep) or
      (u.role = 'pm' and u.pm_code = p_pm)))
$$;

create function app.can_see(p_leader uuid, p_rep text, p_pm text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup', 'estimator', 'accounting')
      or app.owns(p_leader, p_rep, p_pm)
$$;

create function app.can_see_job(p_job uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select app.can_see(j.leader_id, j.rep_code, j.pm_code) from public.jobs j where j.id = p_job), false)
$$;

-- Same table as JOB_FIELD_RULES in src/domain/permissions.ts.
create function app.can_edit(p_field text, p_leader uuid, p_rep text, p_pm text) returns boolean
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
    else return false;
  end case;
  return r = any (any_roles) or (r = any (own_roles) and app.owns(p_leader, p_rep, p_pm));
end
$$;

create function app.can_edit_job(p_job uuid, p_field text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select app.can_edit(p_field, j.leader_id, j.rep_code, j.pm_code) from public.jobs j where j.id = p_job), false)
$$;

-- ---------------------------------------------------------------- triggers
-- Stamp who and when; nobody can rewrite created_*.
create function app.touch() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end
$$;

-- Field-level edit rights on jobs. RLS decides which rows; this decides which columns.
-- Requests with no signed-in user (migrations, seed, server jobs) are not checked here;
-- browsers always carry a user, and anonymous requests have no table rights at all.
create function app.jobs_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  grp record;
begin
  if auth.uid() is null then return new; end if;
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
                  old.billing_method, old.retainage_pct, old.retainage_release, old.retainage_release_note, old.active)
          is distinct from (new.number, new.customer, new.job_type, new.location, new.rep_code, new.pm_code, new.estimator,
                  new.estimate_hrs, new.contract_cents, new.material_cost_cents, new.material_revenue_cents, new.exterior,
                  new.billing_method, new.retainage_pct, new.retainage_release, new.retainage_release_note, new.active))
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
  -- The baseline finish is the first projected finish; it never moves after intake.
  new.baseline_finish := old.baseline_finish;
  return new;
end
$$;

-- A firmness change with a reason goes into the job notes; pinned when the job left Locked.
create function app.firmness_note() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.firmness is distinct from old.firmness and coalesce(trim(new.firmness_reason), '') <> ''
     and new.firmness_reason is distinct from old.firmness_reason then
    insert into public.job_notes (job_id, body, pinned, author_name)
    values (new.id, 'Firmness ' || old.firmness || ' → ' || new.firmness || ': ' || new.firmness_reason,
            old.firmness = 'locked',
            coalesce((select name from public.app_users where auth_user_id = auth.uid()), 'system'));
  end if;
  return null;
end
$$;

-- Only admin and CEO take someone off or put someone back on the roster.
create function app.people_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and old.active is distinct from new.active and not app.role_in('admin', 'ceo', 'cfo') then
    raise exception 'Only an admin can change who is on the active roster' using errcode = '42501';
  end if;
  return new;
end
$$;

-- One change-log row per changed field; one "added" row per new record.
create function app.log_change() returns trigger
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
    else n ->> 'id'
  end;
  jid := case when tg_table_name = 'jobs' then (n ->> 'id')::uuid else (n ->> 'job_id')::uuid end;
  pid := case when tg_table_name = 'people' then (n ->> 'id')::uuid else (n ->> 'person_id')::uuid end;
  if jid is not null then
    lbl := coalesce((select 'Job ' || number from public.jobs where id = jid), '');
  end if;
  if pid is not null then
    lbl := concat_ws(' · ', nullif(lbl, ''), (select name from public.people where id = pid));
  end if;
  if tg_table_name = 'app_users' then lbl := 'User ' || (n ->> 'email'); end if;
  if tg_table_name = 'settings' then lbl := 'Setting ' || (n ->> 'label'); end if;

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

do $$
declare
  t text;
begin
  foreach t in array array['sales_reps', 'project_managers', 'qualifications', 'people', 'people_private',
    'person_qualifications', 'app_users', 'time_off', 'jobs', 'job_requirements', 'job_notes',
    'plan_overrides', 'actual_hours', 'assignments', 'settings']
  loop
    execute format('create trigger touch before insert or update on public.%I for each row execute function app.touch()', t);
    execute format('create trigger log_change after insert or update on public.%I for each row execute function app.log_change()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

create trigger guard before update on public.jobs for each row execute function app.jobs_guard();
create trigger firmness_note after update on public.jobs for each row execute function app.firmness_note();
create trigger guard before update on public.people for each row execute function app.people_guard();
alter table public.change_log enable row level security;

-- ---------------------------------------------------------------- grants
-- Nothing for anonymous visitors. Signed-in users read, add and update through the policies
-- below. Nobody deletes (rule 6); the change log is written only by the trigger.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke insert, update on public.change_log from authenticated;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------- policies
-- Lookups
create policy read on public.sales_reps for select to authenticated using (app.is_member());
create policy write on public.sales_reps for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));
create policy edit on public.sales_reps for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));
create policy read on public.project_managers for select to authenticated using (app.is_member());
create policy write on public.project_managers for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));
create policy edit on public.project_managers for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));
create policy read on public.qualifications for select to authenticated using (app.is_member());
create policy write on public.qualifications for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));
create policy edit on public.qualifications for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));

-- People: names and quals for office roles; phone, DOT and time off for the crew office only.
create policy read on public.people for select to authenticated using (app.is_member() and not app.role_in('field_crew'));
create policy write on public.people for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy edit on public.people for update to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy read on public.people_private for select to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy write on public.people_private for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy edit on public.people_private for update to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy read on public.person_qualifications for select to authenticated using (app.is_member() and not app.role_in('field_crew'));
create policy write on public.person_qualifications for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy edit on public.person_qualifications for update to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy read on public.time_off for select to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy write on public.time_off for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));
create policy edit on public.time_off for update to authenticated using (app.role_in('admin', 'ceo', 'cfo', 'scheduler'));

-- Users: everyone reads their own row; admin and CEO manage access.
create policy read on public.app_users for select to authenticated using (auth_user_id = auth.uid() or app.role_in('admin', 'ceo', 'cfo'));
create policy write on public.app_users for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo'));
create policy edit on public.app_users for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));

-- Jobs
create policy read on public.jobs for select to authenticated using (app.can_see(leader_id, rep_code, pm_code));
create policy write on public.jobs for insert to authenticated with check (app.role_in('admin', 'ceo', 'cfo', 'scheduler', 'job_setup'));
create policy edit on public.jobs for update to authenticated
  using (app.can_see(leader_id, rep_code, pm_code))
  with check (app.can_see(leader_id, rep_code, pm_code) or app.role_in('admin', 'ceo', 'cfo', 'job_setup'));

create policy read on public.job_requirements for select to authenticated using (app.can_see_job(job_id));
create policy write on public.job_requirements for insert to authenticated with check (app.can_edit_job(job_id, 'intake'));
create policy edit on public.job_requirements for update to authenticated using (app.can_edit_job(job_id, 'intake'));

create policy read on public.job_notes for select to authenticated using (app.can_see_job(job_id));
create policy write on public.job_notes for insert to authenticated with check (app.can_edit_job(job_id, 'notes'));
create policy edit on public.job_notes for update to authenticated using (app.can_edit_job(job_id, 'pinNotes'));

create policy read on public.plan_overrides for select to authenticated using (app.can_see_job(job_id));
create policy write on public.plan_overrides for insert to authenticated with check (app.can_edit_job(job_id, 'plan'));
create policy edit on public.plan_overrides for update to authenticated using (app.can_edit_job(job_id, 'plan'));

-- Actuals are read-only in Phase 1; the weekly close adds write rights in Phase 2.
create policy read on public.actual_hours for select to authenticated using (app.can_see_job(job_id));

create policy read on public.assignments for select to authenticated using (app.can_see_job(job_id));
create policy write on public.assignments for insert to authenticated with check (app.can_edit_job(job_id, 'crew'));
create policy edit on public.assignments for update to authenticated using (app.can_edit_job(job_id, 'crew'));

create policy read on public.settings for select to authenticated using (app.is_member());
create policy edit on public.settings for update to authenticated using (app.role_in('admin', 'ceo', 'cfo'));

create policy read on public.change_log for select to authenticated
  using (app.role_in('admin', 'ceo', 'cfo', 'scheduler') or (job_id is not null and app.can_see_job(job_id)));
