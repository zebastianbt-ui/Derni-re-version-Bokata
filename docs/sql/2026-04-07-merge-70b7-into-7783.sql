create table if not exists restore_backup_ai_settings_20260407 as
select now() as backup_created_at, *
from ai_settings
where restaurant_id in (
  '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid,
  '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid
);

create table if not exists restore_backup_booking_public_settings_20260407 as
select now() as backup_created_at, *
from booking_public_settings
where public_id in (
  '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid,
  '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid
);

with params as (
  select
    '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid as source_id,
    '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid as target_id
),
target_row as (
  select coalesce(a.knowledge, '') as txt
  from ai_settings a
  join params p on p.target_id = a.restaurant_id
),
source_row as (
  select coalesce(a.knowledge, '') as txt
  from ai_settings a
  join params p on p.source_id = a.restaurant_id
),
all_lines as (
  select 1 as source_rank, line_ord::bigint as line_ord, btrim(raw_line) as line_text
  from target_row tr,
       regexp_split_to_table(tr.txt, E'\\r?\\n') with ordinality as parts(raw_line, line_ord)
  union all
  select 2 as source_rank, line_ord::bigint as line_ord, btrim(raw_line) as line_text
  from source_row sr,
       regexp_split_to_table(sr.txt, E'\\r?\\n') with ordinality as parts(raw_line, line_ord)
),
dedup as (
  select line_text, min(source_rank * 1000000 + line_ord) as ord_key
  from all_lines
  where line_text <> ''
  group by line_text
),
merged as (
  select coalesce(string_agg(line_text, E'\n' order by ord_key), '') as merged_knowledge
  from dedup
),
upsert_target as (
  insert into ai_settings (restaurant_id, knowledge, updated_at)
  select p.target_id, merged.merged_knowledge, now()
  from params p
  cross join merged
  on conflict (restaurant_id)
  do update
  set knowledge = excluded.knowledge,
      updated_at = excluded.updated_at
  returning restaurant_id, length(coalesce(knowledge, '')) as merged_len
)
select * from upsert_target;

with params as (
  select
    '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid as source_id,
    '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid as target_id
),
target_row as (
  select coalesce(b.knowledge_public, '') as txt
  from booking_public_settings b
  join params p on p.target_id = b.public_id
),
source_row as (
  select coalesce(b.knowledge_public, '') as txt
  from booking_public_settings b
  join params p on p.source_id = b.public_id
),
all_lines as (
  select 1 as source_rank, line_ord::bigint as line_ord, btrim(raw_line) as line_text
  from target_row tr,
       regexp_split_to_table(tr.txt, E'\\r?\\n') with ordinality as parts(raw_line, line_ord)
  union all
  select 2 as source_rank, line_ord::bigint as line_ord, btrim(raw_line) as line_text
  from source_row sr,
       regexp_split_to_table(sr.txt, E'\\r?\\n') with ordinality as parts(raw_line, line_ord)
),
dedup as (
  select line_text, min(source_rank * 1000000 + line_ord) as ord_key
  from all_lines
  where line_text <> ''
  group by line_text
),
merged as (
  select coalesce(string_agg(line_text, E'\n' order by ord_key), '') as merged_knowledge_public
  from dedup
),
updated_target as (
  update booking_public_settings b
  set knowledge_public = merged.merged_knowledge_public,
      updated_at = now()
  from params p
  cross join merged
  where b.public_id = p.target_id
  returning
    b.public_id,
    length(coalesce(b.knowledge_public, '')) as merged_len,
    (b.hours is not null) as has_hours,
    (b.seating is not null) as has_seating,
    b.notify_email,
    b.notify_enabled
)
select * from updated_target;

select restaurant_id, count(*)::bigint as bookings_count
from bookings
where restaurant_id in (
  '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid,
  '77832d94-da22-464c-aa60-1ceecea4b3f9'::uuid
)
group by restaurant_id
order by restaurant_id;

select
  case
    when exists (
      select 1
      from bookings
      where restaurant_id = '70b7c285-2b34-48d5-b42c-e16dc883f5af'::uuid
      limit 1
    )
      then 'MANUAL_REVIEW_REQUIRED_SOURCE_HAS_BOOKINGS'
    else 'OK_SOURCE_HAS_NO_BOOKINGS'
  end as booking_migration_status;
