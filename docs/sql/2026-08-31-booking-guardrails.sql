-- Booking guardrails for production hardening.
-- Apply in Supabase SQL editor before enabling strict reliance on the guarded RPC.

create extension if not exists pgcrypto;

create table if not exists public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  booking_id text,
  purpose text not null,
  recipient text not null,
  subject text not null,
  html text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists outbound_emails_status_send_after_idx
  on public.outbound_emails (status, send_after);

alter table public.outbound_emails enable row level security;

drop policy if exists "service role manages outbound emails" on public.outbound_emails;
create policy "service role manages outbound emails"
  on public.outbound_emails
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.bokata_time_to_minutes(p_time text)
returns integer
language sql
immutable
as $$
  select split_part(left(p_time, 5), ':', 1)::integer * 60
       + split_part(left(p_time, 5), ':', 2)::integer;
$$;

create or replace function public.create_booking_guarded(
  p_restaurant_id uuid,
  p_date date,
  p_time text,
  p_guests integer,
  p_duration_min integer,
  p_max_guests integer,
  p_max_tables integer,
  p_same_email_limit integer,
  p_name text,
  p_notes text,
  p_status text,
  p_source text,
  p_table_id integer,
  p_client_email text,
  p_client_phone text,
  p_confirm_token uuid,
  p_confirm_expires_at timestamptz
)
returns table(id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start integer;
  v_end integer;
  v_overlap_guests integer;
  v_overlap_tables integer;
  v_same_email_count integer;
  v_booking_id text;
begin
  if p_guests is null or p_guests < 1 then
    raise exception 'BOKATA_INVALID_GUEST_COUNT';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_restaurant_id::text || ':' || p_date::text));

  v_start := public.bokata_time_to_minutes(p_time);
  v_end := v_start + greatest(coalesce(p_duration_min, 90), 1);

  select count(*)::integer
  into v_same_email_count
  from public.bookings b
  where b.restaurant_id = p_restaurant_id
    and b.date = p_date
    and lower(coalesce(b.client_email, '')) = lower(coalesce(p_client_email, ''))
    and lower(coalesce(b.status, '')) <> 'cancelled';

  if v_same_email_count >= greatest(coalesce(p_same_email_limit, 2), 1) then
    raise exception 'BOKATA_SAME_EMAIL_LIMIT';
  end if;

  select
    coalesce(sum(coalesce(b.guests, 0)), 0)::integer,
    count(*)::integer
  into v_overlap_guests, v_overlap_tables
  from public.bookings b
  where b.restaurant_id = p_restaurant_id
    and b.date = p_date
    and lower(coalesce(b.status, '')) <> 'cancelled'
    and public.bokata_time_to_minutes(b.time::text) < v_end
    and v_start < public.bokata_time_to_minutes(b.time::text) + greatest(coalesce(b.duration_min, p_duration_min, 90), 1);

  if v_overlap_guests + p_guests > greatest(coalesce(p_max_guests, 60), 1) then
    raise exception 'BOKATA_GUEST_CAPACITY_EXCEEDED';
  end if;

  if v_overlap_tables + 1 > greatest(coalesce(p_max_tables, 20), 1) then
    raise exception 'BOKATA_TABLE_CAPACITY_EXCEEDED';
  end if;

  insert into public.bookings (
    restaurant_id,
    date,
    time,
    guests,
    name,
    notes,
    status,
    source,
    duration_min,
    table_id,
    client_email,
    client_phone,
    confirm_token,
    confirm_expires_at
  )
  values (
    p_restaurant_id,
    p_date,
    p_time,
    p_guests,
    p_name,
    p_notes,
    p_status,
    p_source,
    p_duration_min,
    p_table_id,
    lower(trim(p_client_email)),
    p_client_phone,
    p_confirm_token,
    p_confirm_expires_at
  )
  returning public.bookings.id::text into v_booking_id;

  return query select v_booking_id;
end;
$$;
