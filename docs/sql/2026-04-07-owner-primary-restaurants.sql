create table if not exists owner_primary_restaurants (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

with restaurant_stats as (
  select
    r.owner_id,
    r.id as restaurant_id,
    count(b.id)::bigint as bookings_count,
    max(b.created_at) as latest_booking_at
  from restaurants r
  left join bookings b on b.restaurant_id = r.id
  where r.owner_id is not null
  group by r.owner_id, r.id
),
ranked as (
  select
    owner_id,
    restaurant_id,
    row_number() over (
      partition by owner_id
      order by bookings_count desc, latest_booking_at desc nulls last, restaurant_id asc
    ) as rank_no
  from restaurant_stats
)
insert into owner_primary_restaurants (owner_id, restaurant_id, updated_at)
select owner_id, restaurant_id, now()
from ranked
where rank_no = 1
on conflict (owner_id)
do update
set restaurant_id = excluded.restaurant_id,
    updated_at = excluded.updated_at;

with canonical_owner as (
  select id as owner_id
  from auth.users
  where lower(email) = lower('cafe.madame.bla@gmail.com')
  order by id asc
  limit 1
)
insert into owner_primary_restaurants (owner_id, restaurant_id, updated_at)
select owner_id, '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid, now()
from canonical_owner
on conflict (owner_id)
do update
set restaurant_id = excluded.restaurant_id,
    updated_at = excluded.updated_at;

select
  opr.owner_id,
  opr.restaurant_id,
  r.name as restaurant_name,
  au.email as owner_email,
  opr.updated_at
from owner_primary_restaurants opr
left join restaurants r on r.id = opr.restaurant_id
left join auth.users au on au.id = opr.owner_id
where lower(coalesce(au.email, '')) = lower('cafe.madame.bla@gmail.com')
   or opr.owner_id in (
     select owner_id
     from restaurants
     group by owner_id
     having count(*) > 1
   )
order by au.email nulls last, opr.owner_id;
