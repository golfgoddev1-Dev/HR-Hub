-- Leave data retention settings.
--
-- Extends the existing single-row public.leave_settings table (id = 1); no new
-- table and no new key/value area.
--
-- Run once in the Supabase SQL editor before deploying the Worker that reads
-- these columns. The Worker does not run this file.

alter table public.leave_settings
  add column if not exists leave_retention_enabled boolean not null default false,
  add column if not exists leave_retention_days integer not null default 730;

alter table public.leave_settings
  drop constraint if exists leave_settings_leave_retention_days_check;

alter table public.leave_settings
  add constraint leave_settings_leave_retention_days_check
  check (leave_retention_days between 730 and 3650);

-- An existing row receives the defaults from the ADD COLUMN: deletion off and
-- 730 days (2 years). No UPDATE is needed, so a value already set is never overwritten.
