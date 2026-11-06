-- Account-level push preference, separate from notify_pending_on_logout.
--
-- NOT RUN as part of this change. Apply deliberately in the Supabase SQL editor
-- before deploying the Worker that reads this column.
--
-- Existing employees default to off; the user turns it on from the push switch.
-- Logout never changes this value.

alter table public.employees
  add column if not exists notifications_enabled boolean not null default false;

comment on column public.employees.notifications_enabled is
  'Account chose to receive leave push notifications; does not track a browser subscription';
