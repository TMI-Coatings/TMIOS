-- TMI Ops, Phase 1: core tables.
-- Money is whole cents (bigint). Weeks are the Friday date. Nothing that carries history is
-- deleted: rows are marked inactive (hard rule 6).

create schema if not exists app;

create type public.app_role as enum (
  'admin', 'ceo', 'scheduler', 'job_setup', 'estimator', 'pm',
  'superintendent', 'sales_rep', 'field_crew', 'accounting', 'cfo'
);
create type public.firmness as enum ('locked', 'confirmed', 'waiting', 'flexible', 'best_guess', 'fill_in');
create type public.job_status as enum ('scheduled', 'active', 'on_hold', 'complete');
create type public.must_finish_reason as enum ('shutdown', 'contract');
create type public.retainage_release as enum ('substantial_completion', 'final_completion', 'other');
create type public.billing_method as enum ('final', 'monthly', 'milestone');
create type public.person_kind as enum ('leader', 'field', 'leadership');
create type public.time_off_type as enum ('PTO', 'Holiday', 'Hunting', 'Medical', 'Other');

create function app.is_friday(d date) returns boolean
  language sql immutable as $$ select extract(isodow from d) = 5 $$;

-- Columns every table carries.
-- created_by / updated_by hold the auth user id; app.touch() fills them.

create table public.sales_reps (
  code text primary key check (code ~ '^[A-Z]{2,4}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.project_managers (
  code text primary key check (code ~ '^[A-Z]{2,4}$'),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.qualifications (
  name text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind public.person_kind not null default 'field',
  state text not null default 'MN',
  driver boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Phone and DOT physical expiry are kept apart so only the crew office reads them.
-- DOT is an expiry date only, never medical detail.
create table public.people_private (
  person_id uuid primary key references public.people (id),
  phone text not null default '',
  dot_expires date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.person_qualifications (
  person_id uuid not null references public.people (id),
  qualification text not null references public.qualifications (name),
  expires date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (person_id, qualification)
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null unique check (email = lower(email) and email like '%@%'),
  name text not null,
  role public.app_role not null,
  person_id uuid references public.people (id),
  rep_code text references public.sales_reps (code),
  pm_code text references public.project_managers (code),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint leader_needs_person check (role <> 'superintendent' or person_id is not null),
  constraint rep_needs_code check (role <> 'sales_rep' or rep_code is not null),
  constraint pm_needs_code check (role <> 'pm' or pm_code is not null)
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id),
  first_day date not null,
  last_day date not null,
  type public.time_off_type not null default 'PTO',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (last_day >= first_day)
);
create index on public.time_off (person_id) where active;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^[0-9]{4}$'),
  customer text not null check (length(trim(customer)) > 0),
  job_type text not null default '',
  location text not null default '',
  rep_code text not null references public.sales_reps (code),
  pm_code text not null references public.project_managers (code),
  estimator text not null check (length(trim(estimator)) > 0),
  leader_id uuid references public.people (id),
  crew_size integer not null default 4 check (crew_size between 1 and 40),
  estimate_hrs integer not null check (estimate_hrs >= 0),
  projected_hrs integer not null check (projected_hrs >= 0),
  contract_cents bigint not null check (contract_cents >= 0),
  material_cost_cents bigint not null default 0 check (material_cost_cents >= 0),
  -- Frozen at intake; a change to the burdened rate never rewrites it (decision 22).
  material_revenue_cents bigint not null default 0 check (material_revenue_cents >= 0 and material_revenue_cents <= contract_cents),
  start date not null,
  projected_finish date not null,
  baseline_finish date not null,
  must_finish date,
  must_finish_reason public.must_finish_reason,
  actual_finish date,
  status public.job_status not null default 'scheduled',
  firmness public.firmness not null,
  waits_on_job_id uuid references public.jobs (id),
  -- Why the firmness last changed. Required when a job leaves Locked; copied into the job notes.
  firmness_reason text,
  hold_reason text,
  hold_until date,
  exterior boolean not null default false,
  billing_method public.billing_method not null default 'final',
  -- Retainage varies by contract (decision 17): percent and release terms set at intake.
  retainage_pct numeric(5, 2) not null default 0 check (retainage_pct between 0 and 100),
  retainage_release public.retainage_release,
  retainage_release_note text,
  site_address text not null default '',
  site_start_time text not null default '',
  site_contact text not null default '',
  site_orientation text not null default '',
  site_ppe text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (projected_finish >= start),
  check ((must_finish is null) = (must_finish_reason is null)),
  check (firmness <> 'waiting' or waits_on_job_id is not null),
  check (waits_on_job_id is null or waits_on_job_id <> id),
  check (status <> 'on_hold' or (hold_reason is not null and length(trim(hold_reason)) > 0 and hold_until is not null)),
  check (retainage_pct = 0 or retainage_release is not null)
);

create table public.job_requirements (
  job_id uuid not null references public.jobs (id),
  qualification text not null references public.qualifications (name),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, qualification)
);

create table public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  body text not null check (length(trim(body)) > 0),
  pinned boolean not null default false,
  crew_visible boolean not null default false,
  author_name text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index on public.job_notes (job_id);

-- A week of planned hours set by hand. Clearing it marks it inactive so the week goes back to automatic.
create table public.plan_overrides (
  job_id uuid not null references public.jobs (id),
  week date not null check (app.is_friday(week)),
  hours integer not null check (hours >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (job_id, week)
);

create table public.actual_hours (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  week date not null check (app.is_friday(week)),
  hours numeric(8, 1) not null check (hours >= 0),
  source text not null default 'typed' check (source in ('typed', 'csv', 'import', 'procore')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index on public.actual_hours (job_id, week) where active;

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  person_id uuid not null references public.people (id),
  week date not null check (app.is_friday(week)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (job_id, person_id, week)
);
create index on public.assignments (week) where active;

-- Thresholds an admin can edit (hard rule 8).
create table public.settings (
  key text primary key,
  value jsonb not null,
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.settings (key, value, label) values
  ('absencePct', '10', 'Absence rate (%)'),
  ('hoursPerManWeek', '40', 'Hours per man-week'),
  ('dedicatedLeaderHrs', '400', 'Job size that needs a dedicated leader (hrs)'),
  ('overrunPct', '15', 'Overrun warning threshold (%)'),
  ('burdenedRateCents', '5500', 'Burdened labor cost per hour (cents)'),
  ('targetHeadcount', '50', 'Target working headcount'),
  ('winterStart', '"12-01"', 'Winter window starts (MM-DD)'),
  ('winterEnd', '"03-15"', 'Winter window ends (MM-DD)'),
  ('confirmDatesDays', '28', 'Ask to confirm best-guess dates this many days out'),
  ('smallJobLeaderWeight', '0.5', 'Leaders counted for a job under the dedicated-leader size');

-- Who, when, what, old value, new value (hard rule 5). Written only by triggers.
create table public.change_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text not null default 'system',
  table_name text not null,
  record_id text not null,
  record_label text not null default '',
  job_id uuid,
  field text not null,
  old_value text,
  new_value text
);
create index on public.change_log (job_id, at desc);
create index on public.change_log (at desc);
