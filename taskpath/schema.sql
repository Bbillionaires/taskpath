-- TaskPath Database Schema
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard → your project → SQL Editor
--
-- TaskPath is a multi-tenant SaaS: every operational table carries a
-- company_id, and every RLS policy scopes rows to the caller's own company
-- via current_user_company_id(). New companies are created either through
-- self-service signup (SignupPage.jsx, company_name in auth metadata) or by
-- an existing admin inviting a team member (api/create-user.js).

-- ── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Companies (tenants) ──────────────────────────────────────────────────────
create table companies (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  industry   text not null check (industry in ('sweeper','trash','lawn','tree','delivery','roofing')),
  created_at timestamptz default now()
);

-- ── Zones ────────────────────────────────────────────────────────────────────
create table zones (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  city         text not null,
  state        text not null default 'FL',
  created_at   timestamptz default now(),
  company_id   uuid not null references companies(id)
);

-- ── Profiles (extends Supabase auth.users) ───────────────────────────────────
create table profiles (
  id                 uuid primary key default uuid_generate_v4(),
  auth_user_id       uuid references auth.users(id) on delete cascade,
  full_name          text not null,
  role               text not null check (role in ('driver', 'supervisor', 'admin', 'dispatcher', 'processor')),
  phone              text,
  assigned_zone_id   uuid references zones(id),
  created_at         timestamptz default now(),
  vehicle_tag        text,
  insurance_policy   text,
  vehicle_make_model text,
  vehicle_owner      text,
  vehicle_company    text,
  scheduled_hours    text,
  pay_rate           text,
  notes              text,
  created_by         uuid references profiles(id),
  company_id         uuid not null references companies(id)
);

-- Auto-create profile row (and, for self-service signup, a new company) when
-- a new auth user signs up. Distinguishes three cases via auth metadata:
--   1. company_name present  -> brand new company signup, actor becomes admin
--   2. company_id present    -> invited member, already knows its company
--   3. neither present       -> legacy/fallback path, defaults to the first
--      company (only correct for single-tenant installs; kept only until
--      every invite path explicitly passes company_id)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid;
  meta jsonb := new.raw_user_meta_data;
begin
  if meta ? 'company_name' then
    insert into companies (name, industry)
    values (meta->>'company_name', coalesce(meta->>'industry', 'sweeper'))
    returning id into new_company_id;

    insert into profiles (auth_user_id, full_name, role, company_id)
    values (new.id, coalesce(meta->>'full_name', new.email), 'admin', new_company_id);
  else
    insert into profiles (auth_user_id, full_name, role, company_id, assigned_zone_id)
    values (
      new.id,
      coalesce(meta->>'full_name', new.email),
      coalesce(meta->>'role', 'driver'),
      coalesce((meta->>'company_id')::uuid, (select id from companies order by created_at limit 1)),
      nullif(meta->>'zone_id','')::uuid
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ── Routes ───────────────────────────────────────────────────────────────────
create table routes (
  id          uuid primary key default uuid_generate_v4(),
  zone_id     uuid references zones(id),
  name        text not null,
  description text,
  geojson     jsonb,           -- GeoJSON LineString of the sweep path
  pdf_url     text,            -- URL to original PDF in Supabase Storage
  status      text not null default 'active' check (status in ('active', 'inactive', 'draft')),
  created_at  timestamptz default now(),
  created_by  uuid references profiles(id),
  company_id  uuid not null references companies(id)
);

-- ── Schedule Variants ────────────────────────────────────────────────────────
create table schedule_variants (
  id           uuid primary key default uuid_generate_v4(),
  route_id     uuid references routes(id) on delete cascade,
  label        text not null,        -- e.g. "Weekday", "Saturday", "Special Event"
  service_type text not null,        -- e.g. "Commercial + Residential"
  day_rule     text not null check (day_rule in ('weekday', 'saturday', 'sunday', 'special')),
  color_code   text default '#F59E0B',
  sort_order   int default 0,
  company_id   uuid not null references companies(id)
);

-- ── Assignments ──────────────────────────────────────────────────────────────
create table assignments (
  id               uuid primary key default uuid_generate_v4(),
  driver_id        uuid references profiles(id),
  route_id         uuid references routes(id),
  variant_id       uuid references schedule_variants(id),
  scheduled_date   date not null,
  status           text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  created_at       timestamptz default now(),
  created_by       uuid references profiles(id),
  company_id       uuid not null references companies(id)
);

-- ── Job Records ──────────────────────────────────────────────────────────────
create table job_records (
  id             uuid primary key default uuid_generate_v4(),
  assignment_id  uuid references assignments(id),
  driver_id      uuid references profiles(id),
  route_id       uuid references routes(id),
  variant_id     uuid references schedule_variants(id),
  started_at     timestamptz not null,
  completed_at   timestamptz,
  coverage_pct   int default 0 check (coverage_pct between 0 and 100),
  gps_track      jsonb,       -- GeoJSON LineString of actual path driven
  proof_url      text,        -- Screenshot/PDF of completed coverage map
  notes          text,
  created_at     timestamptz default now(),
  start_lat      double precision,
  start_lng      double precision,
  end_lat        double precision,
  end_lng        double precision,
  pause_events   jsonb default '[]'::jsonb,
  company_id     uuid not null references companies(id)
);

-- ── Job Edits (audit trail for driver-reported job corrections) ─────────────
create table job_edits (
  id             uuid primary key default uuid_generate_v4(),
  job_record_id  uuid references job_records(id),
  driver_id      uuid references profiles(id),
  reason         text not null,
  field_changed  text,
  old_value      text,
  new_value      text,
  created_at     timestamptz default now(),
  company_id     uuid not null references companies(id)
);

-- ── Driver Locations (live GPS while a job is active) ────────────────────────
create table driver_locations (
  id            uuid primary key default uuid_generate_v4(),
  driver_id     uuid unique references profiles(id),
  assignment_id uuid references assignments(id),
  lat           double precision not null,
  lng           double precision not null,
  heading       double precision,
  accuracy      double precision,
  updated_at    timestamptz default now(),
  company_id    uuid not null references companies(id)
);

-- ── Feature Flags (per-company, per-supervisor operational toggles) ─────────
create table feature_flags (
  id            uuid primary key default uuid_generate_v4(),
  supervisor_id uuid references profiles(id),
  flag_name     text not null,
  enabled       boolean default false,
  updated_at    timestamptz default now(),
  company_id    uuid not null references companies(id)
);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table companies         enable row level security;
alter table profiles          enable row level security;
alter table zones             enable row level security;
alter table routes            enable row level security;
alter table schedule_variants enable row level security;
alter table assignments       enable row level security;
alter table job_records       enable row level security;
alter table job_edits         enable row level security;
alter table driver_locations  enable row level security;
alter table feature_flags     enable row level security;

-- Helper to look up the current user's role without recursing into profiles'
-- own RLS policies (a plain subquery inside a profiles policy would deadlock).
create or replace function public.current_user_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where auth_user_id = auth.uid()
$$;

revoke execute on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- Helper to look up the current user's company_id — the tenant-scoping
-- equivalent of current_user_role(), same SECURITY DEFINER pattern to avoid
-- recursion when used inside a profiles policy.
create or replace function public.current_user_company_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select company_id from profiles where auth_user_id = auth.uid()
$$;

revoke execute on function public.current_user_company_id() from public;
grant execute on function public.current_user_company_id() to authenticated;

-- Companies: members can see their own company's row (name/industry for
-- settings UI); nothing else is exposed cross-tenant.
create policy "Members can view own company" on companies
  for select using (id = current_user_company_id());

-- Profiles ────────────────────────────────────────────────────────────────
create policy "Users can view own profile" on profiles
  for select using (
    auth.role() = 'authenticated' and company_id = current_user_company_id()
  );

create policy "Users can update own profile" on profiles
  for update using (auth_user_id = auth.uid());

create policy "Admins and supervisors can manage profiles" on profiles
  for all
  using (current_user_role() = any (array['admin','supervisor']) and company_id = current_user_company_id())
  with check (current_user_role() = any (array['admin','supervisor']) and company_id = current_user_company_id());

create policy "Service can insert profiles" on profiles
  for insert with check (true); -- only ever exercised by the SECURITY DEFINER handle_new_user() trigger, which bypasses RLS anyway

-- Users can update their own row via "Users can update own profile" above,
-- but must not be able to self-promote (role) or hop tenants (company_id).
-- Postgres column-level GRANTs can't distinguish which policy let an UPDATE
-- through (every authenticated user shares one Postgres role), so this is
-- enforced with a trigger instead: if the acting user isn't already an
-- admin/supervisor, role/company_id are silently reset to their old values.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() not in ('admin','supervisor') then
    new.role := old.role;
    new.company_id := old.company_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_self_role_escalation() from public, anon, authenticated;

create trigger trg_prevent_self_role_escalation
  before update on profiles
  for each row execute function public.prevent_self_role_escalation();

-- Auto-stamp company_id on insert for tables the client still inserts into
-- without knowing about company_id, so existing app code needs zero changes.
create or replace function public.set_company_id_from_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.current_user_company_id();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_company_id_from_user() from public, anon, authenticated;

create trigger trg_set_company_id before insert on zones
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on routes
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on schedule_variants
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on assignments
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on job_records
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on job_edits
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on feature_flags
  for each row execute function public.set_company_id_from_user();
create trigger trg_set_company_id before insert on driver_locations
  for each row execute function public.set_company_id_from_user();

-- Zones ──────────────────────────────────────────────────────────────────
create policy "Authenticated users can view zones" on zones
  for select using (auth.role() = 'authenticated' and company_id = current_user_company_id());

create policy "Admins and supervisors can manage zones" on zones
  for all
  using ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id())
  with check ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id());

-- Routes ─────────────────────────────────────────────────────────────────
create policy "Authenticated users can view active routes" on routes
  for select using (auth.role() = 'authenticated' and status = 'active' and company_id = current_user_company_id());

create policy "Processors can view routes" on routes
  for select using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor','processor','driver'])
    and company_id = current_user_company_id()
  );

create policy "Admins and supervisors can manage routes" on routes
  for all
  using ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id())
  with check ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id());

-- Schedule variants ──────────────────────────────────────────────────────
create policy "Authenticated users can view variants" on schedule_variants
  for select using (auth.role() = 'authenticated' and company_id = current_user_company_id());

create policy "Admins and supervisors can manage variants" on schedule_variants
  for all
  using ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id())
  with check ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id());

-- Assignments ────────────────────────────────────────────────────────────
create policy "Admins and supervisors can manage assignments" on assignments
  for all
  using ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id())
  with check ((select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor']) and company_id = current_user_company_id());

create policy "Processors can manage assignments" on assignments
  for all using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor','processor'])
    and company_id = current_user_company_id()
  );

create policy "Drivers can view own assignments" on assignments
  for select using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

create policy "Drivers can update own assignments" on assignments
  for update using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

-- Job records ────────────────────────────────────────────────────────────
create policy "Admin can delete job records" on job_records
  for delete using (
    (select role from profiles where auth_user_id = auth.uid()) = 'admin'
    and company_id = current_user_company_id()
  );

create policy "Admins and supervisors can view job records" on job_records
  for select using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor'])
    and company_id = current_user_company_id()
  );

create policy "Supervisors and admins can update job records" on job_records
  for update using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor'])
    and company_id = current_user_company_id()
  );

create policy "Drivers can view own job records" on job_records
  for select using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

create policy "Drivers can update own job records" on job_records
  for update using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

create policy "Drivers can insert own job records" on job_records
  for insert with check (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
  );

-- Job edits ──────────────────────────────────────────────────────────────
create policy "Admin can delete job edits" on job_edits
  for delete using (
    (select role from profiles where auth_user_id = auth.uid()) = 'admin'
    and company_id = current_user_company_id()
  );

create policy "Supervisors and admins can view edits" on job_edits
  for select using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor'])
    and company_id = current_user_company_id()
  );

create policy "Drivers can view own edits" on job_edits
  for select using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

create policy "Drivers supervisors admins can insert edits" on job_edits
  for insert with check (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['admin','supervisor','driver'])
  );

-- Driver locations ───────────────────────────────────────────────────────
create policy "Drivers can manage own location" on driver_locations
  for all using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
    and company_id = current_user_company_id()
  );

create policy "Supervisors and admins can view locations" on driver_locations
  for select using (
    (select role from profiles where auth_user_id = auth.uid()) = any (array['supervisor','admin'])
    and company_id = current_user_company_id()
  );

-- Feature flags ──────────────────────────────────────────────────────────
create policy "Admins can manage all flags" on feature_flags
  for all using (
    (select role from profiles where auth_user_id = auth.uid()) = 'admin'
    and company_id = current_user_company_id()
  );

create policy "Processors and drivers can read flags" on feature_flags
  for select using (
    auth.role() = 'authenticated' and company_id = current_user_company_id()
  );

create policy "Supervisors can manage own flags" on feature_flags
  for all using (
    (select id from profiles where auth_user_id = auth.uid()) = supervisor_id
    and company_id = current_user_company_id()
  );

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index idx_assignments_driver_date on assignments(driver_id, scheduled_date);
create index idx_assignments_status on assignments(status);
create index idx_job_records_driver on job_records(driver_id);
create index idx_job_records_route on job_records(route_id);
create index idx_profiles_auth_user on profiles(auth_user_id);

create index idx_zones_company_id on zones(company_id);
create index idx_profiles_company_id on profiles(company_id);
create index idx_routes_company_id on routes(company_id);
create index idx_schedule_variants_company_id on schedule_variants(company_id);
create index idx_assignments_company_id on assignments(company_id);
create index idx_job_records_company_id on job_records(company_id);
create index idx_driver_locations_company_id on driver_locations(company_id);
create index idx_feature_flags_company_id on feature_flags(company_id);
create index idx_job_edits_company_id on job_edits(company_id);
