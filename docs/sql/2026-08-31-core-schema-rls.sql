-- Bokata core schema and RLS baseline.
-- Idempotent baseline for the tables used by the app/API. Review against production
-- before applying if the existing schema has hand-made differences.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null default '',
  slug text unique,
  address text,
  phone text,
  email text,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table if not exists public.owner_primary_restaurants (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  assistant_name text,
  knowledge text,
  web_search_enabled boolean not null default false,
  site_url text,
  google_maps_url text,
  facebook_url text,
  instagram_url text,
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_public_settings (
  public_id uuid primary key references public.restaurants(id) on delete cascade,
  hours jsonb not null default '{}'::jsonb,
  seating jsonb not null default '{}'::jsonb,
  knowledge_public text,
  notify_email text,
  notify_enabled boolean not null default false,
  require_manual_confirmation boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.floorplans (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  layout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  date date not null,
  time text not null,
  guests integer not null,
  name text not null,
  notes text,
  status text not null default 'confirmed',
  source text not null default 'web',
  duration_min integer not null default 90,
  table_id integer,
  client_email text,
  client_phone text,
  confirm_token uuid,
  confirm_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_events (
  stripe_event_id text primary key,
  type text,
  created_at timestamptz not null default now()
);

create table if not exists public.stripe_subscriptions (
  stripe_subscription_id text primary key,
  stripe_customer_id text,
  user_id uuid references auth.users(id) on delete set null,
  status text,
  current_period_end timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (restaurant_id, email)
);

create index if not exists restaurants_owner_id_idx on public.restaurants (owner_id);
create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists bookings_restaurant_date_time_idx on public.bookings (restaurant_id, date, time);
create index if not exists bookings_confirm_token_idx on public.bookings (confirm_token);
create index if not exists bookings_client_email_date_idx on public.bookings (restaurant_id, date, (lower(client_email)));
create index if not exists stripe_subscriptions_user_id_idx on public.stripe_subscriptions (user_id);

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.memberships enable row level security;
alter table public.owner_primary_restaurants enable row level security;
alter table public.ai_settings enable row level security;
alter table public.booking_public_settings enable row level security;
alter table public.floorplans enable row level security;
alter table public.bookings enable row level security;
alter table public.stripe_events enable row level security;
alter table public.stripe_subscriptions enable row level security;
alter table public.email_unsubscribes enable row level security;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "users upsert own profile" on public.profiles;
create policy "users upsert own profile" on public.profiles
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "members read restaurants" on public.restaurants;
create policy "members read restaurants" on public.restaurants
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.restaurant_id = restaurants.id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "owners manage restaurants" on public.restaurants;
create policy "owners manage restaurants" on public.restaurants
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "users read own memberships" on public.memberships;
create policy "users read own memberships" on public.memberships
  for select using (user_id = auth.uid());

drop policy if exists "owners manage memberships" on public.memberships;
create policy "owners manage memberships" on public.memberships
  for all using (
    exists (
      select 1 from public.restaurants r
      where r.id = memberships.restaurant_id
        and r.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.restaurants r
      where r.id = memberships.restaurant_id
        and r.owner_id = auth.uid()
    )
  );

drop policy if exists "owners read primary restaurant" on public.owner_primary_restaurants;
create policy "owners read primary restaurant" on public.owner_primary_restaurants
  for select using (owner_id = auth.uid());

drop policy if exists "members manage ai settings" on public.ai_settings;
create policy "members manage ai settings" on public.ai_settings
  for all using (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = ai_settings.restaurant_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = ai_settings.restaurant_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "public reads booking settings" on public.booking_public_settings;
create policy "public reads booking settings" on public.booking_public_settings
  for select using (true);

drop policy if exists "members manage booking settings" on public.booking_public_settings;
create policy "members manage booking settings" on public.booking_public_settings
  for all using (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = booking_public_settings.public_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = booking_public_settings.public_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "members manage floorplans" on public.floorplans;
create policy "members manage floorplans" on public.floorplans
  for all using (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = floorplans.restaurant_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = floorplans.restaurant_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "members manage bookings" on public.bookings;
create policy "members manage bookings" on public.bookings
  for all using (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = bookings.restaurant_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.restaurant_id = bookings.restaurant_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "service role manages stripe events" on public.stripe_events;
create policy "service role manages stripe events" on public.stripe_events
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "users read own subscriptions" on public.stripe_subscriptions;
create policy "users read own subscriptions" on public.stripe_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "service role manages subscriptions" on public.stripe_subscriptions;
create policy "service role manages subscriptions" on public.stripe_subscriptions
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manages unsubscribes" on public.email_unsubscribes;
create policy "service role manages unsubscribes" on public.email_unsubscribes
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
