-- TaskPath Database Schema
-- Run this in your Supabase SQL editor: https://supabase.com/dashboard → your project → SQL Editor

-- ── Enable UUID extension ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Zones ────────────────────────────────────────────────────────────────────
create table zones (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  city         text not null,
  state        text not null default 'FL',
  created_at   timestamptz default now()
);

-- ── Profiles (extends Supabase auth.users) ───────────────────────────────────
create table profiles (
  id               uuid primary key default uuid_generate_v4(),
  auth_user_id     uuid references auth.users(id) on delete cascade,
  full_name        text not null,
  role             text not null check (role in ('driver', 'supervisor', 'admin')),
  phone            text,
  assigned_zone_id uuid references zones(id),
  created_at       timestamptz default now()
);

-- Auto-create profile row when a new auth user signs up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (auth_user_id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'driver');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Routes ───────────────────────────────────────────────────────────────────
create table routes (
  id          uuid primary key default uuid_generate_v4(),
  zone_id     uuid references zones(id),
  name        text not null,
  description text,
  geojson     jsonb,           -- GeoJSON LineString of the sweep path
  pdf_url     text,            -- URL to original PDF in Supabase Storage
  status      text not null default 'active' check (status in ('active', 'inactive', 'draft')),
  created_at  timestamptz default now()
);

-- ── Schedule Variants ────────────────────────────────────────────────────────
create table schedule_variants (
  id           uuid primary key default uuid_generate_v4(),
  route_id     uuid references routes(id) on delete cascade,
  label        text not null,        -- e.g. "Weekday", "Saturday", "Special Event"
  service_type text not null,        -- e.g. "Commercial + Residential"
  day_rule     text not null check (day_rule in ('weekday', 'saturday', 'sunday', 'special')),
  color_code   text default '#F59E0B',
  sort_order   int default 0
);

-- ── Assignments ──────────────────────────────────────────────────────────────
create table assignments (
  id               uuid primary key default uuid_generate_v4(),
  driver_id        uuid references profiles(id),
  route_id         uuid references routes(id),
  variant_id       uuid references schedule_variants(id),
  scheduled_date   date not null,
  status           text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'skipped')),
  created_at       timestamptz default now()
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
  created_at     timestamptz default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table profiles          enable row level security;
alter table zones             enable row level security;
alter table routes            enable row level security;
alter table schedule_variants enable row level security;
alter table assignments       enable row level security;
alter table job_records       enable row level security;

-- Profiles: users can read their own profile
create policy "Users can view own profile"
  on profiles for select using (auth_user_id = auth.uid());

create policy "Users can update own profile"
  on profiles for update using (auth_user_id = auth.uid());

-- Zones: all authenticated users can read zones
create policy "Authenticated users can view zones"
  on zones for select using (auth.role() = 'authenticated');

-- Routes: all authenticated users can view active routes
create policy "Authenticated users can view active routes"
  on routes for select using (auth.role() = 'authenticated' and status = 'active');

-- Schedule variants: all authenticated users can view
create policy "Authenticated users can view variants"
  on schedule_variants for select using (auth.role() = 'authenticated');

-- Assignments: drivers can only see their own assignments
create policy "Drivers can view own assignments"
  on assignments for select using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
  );

create policy "Drivers can update own assignments"
  on assignments for update using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
  );

-- Job records: drivers can view and insert their own
create policy "Drivers can view own job records"
  on job_records for select using (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
  );

create policy "Drivers can insert own job records"
  on job_records for insert with check (
    driver_id = (select id from profiles where auth_user_id = auth.uid())
  );

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index idx_assignments_driver_date on assignments(driver_id, scheduled_date);
create index idx_assignments_status on assignments(status);
create index idx_job_records_driver on job_records(driver_id);
create index idx_job_records_route on job_records(route_id);
create index idx_profiles_auth_user on profiles(auth_user_id);
