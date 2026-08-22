-- Madame Bla booking/opening hours from 2026-08-23 through 2026-10-11.
-- Weekends stay open but are drop-in only in the app/API.

with target_settings as (
  select public_id, hours
  from booking_public_settings
  where public_id in (
    '77832d94-da22-464c-aa60-1ceecea4b3f9',
    '70b7c285-2b34-48d5-b42c-e16dc883f5af',
    '8300e19c-6f0f-42fb-8a96-9eac38268a1d'
  )
),
kept_periods as (
  select
    public_id,
    coalesce(jsonb_agg(period order by period->>'from') filter (where period is not null), '[]'::jsonb) as periods
  from target_settings
  left join lateral jsonb_array_elements(coalesce(hours->'periods', '[]'::jsonb)) as period on true
  where period is null or period->>'to' < '2026-08-17'
  group by public_id
),
desired_periods as (
  select
    public_id,
    periods || '[
      {
        "id": "madame-bla-2026-08-17-22",
        "name": "Oppet 17-22 aug 2026",
        "from": "2026-08-17",
        "to": "2026-08-22",
        "days": {
          "måndag": {"closed": false, "open": "11:00", "close": "17:00"},
          "tisdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "onsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "torsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "fredag": {"closed": false, "open": "11:00", "close": "17:00"},
          "lördag": {"closed": false, "open": "16:00", "close": "21:00"},
          "söndag": {"closed": false, "open": "16:00", "close": "17:00"}
        }
      },
      {
        "id": "madame-bla-2026-08-23-31",
        "name": "Oppet 23-31 aug 2026",
        "from": "2026-08-23",
        "to": "2026-08-31",
        "days": {
          "måndag": {"closed": false, "open": "11:00", "close": "17:00"},
          "tisdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "onsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "torsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "fredag": {"closed": false, "open": "11:00", "close": "17:00"},
          "lördag": {"closed": false, "open": "11:00", "close": "17:00"},
          "söndag": {"closed": false, "open": "11:00", "close": "17:00"}
        }
      },
      {
        "id": "madame-bla-2026-09-01-06",
        "name": "Oppet 1-6 sep 2026",
        "from": "2026-09-01",
        "to": "2026-09-06",
        "days": {
          "måndag": {"closed": false, "open": "11:00", "close": "17:00"},
          "tisdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "onsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "torsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "fredag": {"closed": false, "open": "11:00", "close": "17:00"},
          "lördag": {"closed": false, "open": "11:00", "close": "17:00"},
          "söndag": {"closed": false, "open": "11:00", "close": "17:00"}
        }
      },
      {
        "id": "madame-bla-2026-09-07-10-11",
        "name": "Oppet 7 sep-11 okt 2026",
        "from": "2026-09-07",
        "to": "2026-10-11",
        "days": {
          "måndag": {"closed": true, "open": "11:00", "close": "17:00"},
          "tisdag": {"closed": true, "open": "11:00", "close": "17:00"},
          "onsdag": {"closed": true, "open": "11:00", "close": "17:00"},
          "torsdag": {"closed": false, "open": "11:00", "close": "17:00"},
          "fredag": {"closed": false, "open": "11:00", "close": "17:00"},
          "lördag": {"closed": false, "open": "11:00", "close": "17:00"},
          "söndag": {"closed": false, "open": "11:00", "close": "17:00"}
        }
      },
      {
        "id": "madame-bla-2026-10-12-12-31",
        "name": "Stangt efter 11 okt 2026",
        "from": "2026-10-12",
        "to": "2026-12-31",
        "days": {
          "måndag": {"closed": true, "open": "11:00", "close": "17:00"},
          "tisdag": {"closed": true, "open": "11:00", "close": "17:00"},
          "onsdag": {"closed": true, "open": "11:00", "close": "17:00"},
          "torsdag": {"closed": true, "open": "11:00", "close": "17:00"},
          "fredag": {"closed": true, "open": "11:00", "close": "17:00"},
          "lördag": {"closed": true, "open": "11:00", "close": "17:00"},
          "söndag": {"closed": true, "open": "11:00", "close": "17:00"}
        }
      }
    ]'::jsonb as periods
  from kept_periods
)
update booking_public_settings settings
set
  hours = jsonb_set(
    jsonb_set(
      coalesce(settings.hours, '{}'::jsonb),
      '{special}',
      coalesce(
        (
          select jsonb_agg(special_day)
          from jsonb_array_elements(coalesce(settings.hours->'special', '[]'::jsonb)) as special_day
          where special_day->>'date' not in ('2026-09-19', '2026-09-26')
        ),
        '[]'::jsonb
      ),
      true
    ),
    '{periods}',
    desired_periods.periods,
    true
  ),
  updated_at = now()
from desired_periods
where settings.public_id = desired_periods.public_id;
