# Cron Schedule

The daily notification cron is defined in `vercel.json` and runs via Vercel Cron.

> Note: Vercel's `vercel.json` schema does not permit comments or unknown top-level fields, so this file is the canonical source of documentation for the cron schedule.

## Current schedule

`0 12 * * *` — daily at 12:00 UTC.

## Seasonal time shift

Vercel Cron runs in UTC and has no DST awareness, so a fixed UTC time will drift by one hour twice a year as Central time enters and exits DST.

| Season | Central offset | Local fire time |
|--------|----------------|-----------------|
| Summer (CDT, ~Mar → Nov) | UTC − 5 | **7:00 AM CDT** (on time) |
| Winter (CST, ~Nov → Mar) | UTC − 6 | **6:00 AM CST** (one hour early) |

## Why this schedule

Summer is when seasonal income lands and bills are heavier, so the schedule is tuned for 7:00 AM sharp in CDT. In winter it fires an hour early rather than drifting across the DST boundary unpredictably.

## If winter accuracy is preferred instead

Change the schedule to `0 13 * * *` in `vercel.json`. That gives:
- 7:00 AM CST in winter (on time)
- 8:00 AM CDT in summer (one hour late)
