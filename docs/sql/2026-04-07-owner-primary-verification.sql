select
  r.owner_id,
  count(*) as restaurant_count,
  count(opr.owner_id) as primary_mapping_count
from restaurants r
left join owner_primary_restaurants opr on opr.owner_id = r.owner_id
where r.owner_id is not null
group by r.owner_id
having count(*) > 1
order by restaurant_count desc, r.owner_id;

select
  au.email,
  opr.owner_id,
  opr.restaurant_id,
  rr.name as restaurant_name,
  opr.updated_at
from owner_primary_restaurants opr
left join auth.users au on au.id = opr.owner_id
left join restaurants rr on rr.id = opr.restaurant_id
where lower(coalesce(au.email, '')) = lower('cafe.madame.bla@gmail.com');

select
  r.id as restaurant_id,
  r.name,
  r.owner_id,
  count(b.id)::bigint as bookings_count,
  max(b.created_at) as latest_booking_at,
  length(coalesce(ai.knowledge, '')) as ai_knowledge_len,
  length(coalesce(bs.knowledge_public, '')) as booking_knowledge_len,
  bs.updated_at as booking_settings_updated_at,
  ai.updated_at as ai_settings_updated_at
from restaurants r
left join bookings b on b.restaurant_id = r.id
left join ai_settings ai on ai.restaurant_id = r.id
left join booking_public_settings bs on bs.public_id = r.id
where r.owner_id in (
  select id from auth.users where lower(email) = lower('cafe.madame.bla@gmail.com')
)
group by r.id, r.name, r.owner_id, ai.knowledge, bs.knowledge_public, bs.updated_at, ai.updated_at
order by bookings_count desc, booking_knowledge_len desc, ai_knowledge_len desc, r.id;
