-- 20260415000000_live_test.sql
-- Live test persistence: devices, sessions, session_cells, session_stage_aggregates + save RPC.

create extension if not exists "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- devices
-- ─────────────────────────────────────────────────────────────
create table if not exists public.devices (
  device_id      text primary key,
  device_type    text not null,
  nickname       text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- sessions
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id                 uuid primary key,
  started_at         timestamptz not null,
  ended_at           timestamptz not null,
  device_id          text not null references public.devices(device_id),
  device_type        text not null,
  model_id           text,
  tester_name        text,
  body_weight_n      numeric,
  grid_rows          int  not null,
  grid_cols          int  not null,
  n_cells_captured   int  not null,
  n_cells_expected   int  not null,
  overall_pass_rate  numeric,
  session_passed     boolean,
  app_version        text
);
create index if not exists sessions_started_at_desc
  on public.sessions (started_at desc);

-- ─────────────────────────────────────────────────────────────
-- session_cells
-- ─────────────────────────────────────────────────────────────
create table if not exists public.session_cells (
  id              uuid primary key default uuid_generate_v4(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  stage_index     int  not null,
  stage_name      text not null,
  stage_type      text not null check (stage_type in ('dumbbell','two_leg','one_leg')),
  stage_location  text not null check (stage_location in ('A','B')),
  target_n        numeric not null,
  tolerance_n     numeric not null,
  row             int  not null,
  col             int  not null,
  mean_fz_n       numeric not null,
  std_fz_n        numeric not null,
  error_n         numeric not null,
  signed_error_n  numeric not null,
  error_ratio     numeric not null,
  color_bin       text not null,
  pass            boolean not null,
  captured_at     timestamptz not null
);
create index if not exists session_cells_session_id
  on public.session_cells (session_id);
create index if not exists session_cells_session_stage_type
  on public.session_cells (session_id, stage_type);

-- ─────────────────────────────────────────────────────────────
-- session_stage_aggregates
-- ─────────────────────────────────────────────────────────────
create table if not exists public.session_stage_aggregates (
  session_id         uuid not null references public.sessions(id) on delete cascade,
  stage_type         text not null check (stage_type in ('dumbbell','two_leg','one_leg')),
  n_cells            int  not null,
  mae                numeric,
  signed_mean_error  numeric,
  std_error          numeric,
  pass_rate          numeric,
  primary key (session_id, stage_type)
);

-- ─────────────────────────────────────────────────────────────
-- RPC: save_live_session (atomic)
-- ─────────────────────────────────────────────────────────────
create or replace function public.save_live_session(payload jsonb)
returns uuid
language plpgsql
as $$
declare
  s uuid;
  inserted_id uuid;
begin
  -- Upsert device first
  insert into public.devices (device_id, device_type, last_seen_at)
  values (
    payload->'session'->>'device_id',
    payload->'session'->>'device_type',
    now()
  )
  on conflict (device_id) do update
    set device_type  = excluded.device_type,
        last_seen_at = excluded.last_seen_at;

  -- Insert session idempotently
  insert into public.sessions (
    id, started_at, ended_at, device_id, device_type, model_id, tester_name,
    body_weight_n, grid_rows, grid_cols, n_cells_captured, n_cells_expected,
    overall_pass_rate, session_passed, app_version
  )
  values (
    (payload->'session'->>'id')::uuid,
    (payload->'session'->>'started_at')::timestamptz,
    (payload->'session'->>'ended_at')::timestamptz,
    payload->'session'->>'device_id',
    payload->'session'->>'device_type',
    payload->'session'->>'model_id',
    payload->'session'->>'tester_name',
    nullif(payload->'session'->>'body_weight_n','')::numeric,
    (payload->'session'->>'grid_rows')::int,
    (payload->'session'->>'grid_cols')::int,
    (payload->'session'->>'n_cells_captured')::int,
    (payload->'session'->>'n_cells_expected')::int,
    nullif(payload->'session'->>'overall_pass_rate','')::numeric,
    nullif(payload->'session'->>'session_passed','')::boolean,
    payload->'session'->>'app_version'
  )
  on conflict (id) do nothing
  returning id into inserted_id;

  -- If already existed, idempotent retry — nothing more to do
  if inserted_id is null then
    return (payload->'session'->>'id')::uuid;
  end if;

  s := inserted_id;

  -- Insert cells
  insert into public.session_cells (
    session_id, stage_index, stage_name, stage_type, stage_location,
    target_n, tolerance_n, row, col, mean_fz_n, std_fz_n, error_n,
    signed_error_n, error_ratio, color_bin, pass, captured_at
  )
  select
    s,
    (c->>'stage_index')::int,
    c->>'stage_name',
    c->>'stage_type',
    c->>'stage_location',
    (c->>'target_n')::numeric,
    (c->>'tolerance_n')::numeric,
    (c->>'row')::int,
    (c->>'col')::int,
    (c->>'mean_fz_n')::numeric,
    (c->>'std_fz_n')::numeric,
    (c->>'error_n')::numeric,
    (c->>'signed_error_n')::numeric,
    (c->>'error_ratio')::numeric,
    c->>'color_bin',
    (c->>'pass')::boolean,
    (c->>'captured_at')::timestamptz
  from jsonb_array_elements(payload->'cells') as t(c);

  -- Insert aggregates
  insert into public.session_stage_aggregates (
    session_id, stage_type, n_cells, mae, signed_mean_error, std_error, pass_rate
  )
  select
    s,
    a->>'stage_type',
    (a->>'n_cells')::int,
    nullif(a->>'mae','')::numeric,
    nullif(a->>'signed_mean_error','')::numeric,
    nullif(a->>'std_error','')::numeric,
    nullif(a->>'pass_rate','')::numeric
  from jsonb_array_elements(payload->'aggregates') as t(a);

  return s;
end;
$$;
