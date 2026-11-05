-- Signed-out approver pushes: the per-employee opt-in and 60-minute throttle,
-- plus the signed-out mark on the browser subscription row.
--
-- NOT RUN as part of this change. Apply deliberately in the Supabase SQL editor
-- before deploying the Worker that reads these columns.

alter table public.employees
  add column if not exists notify_pending_on_logout boolean not null default true,
  add column if not exists pending_notice_at timestamptz;

alter table public.push_subscriptions
  add column if not exists signed_out boolean not null default false,
  add column if not exists signed_out_at timestamptz;

comment on column public.employees.notify_pending_on_logout is
  'Approver opt-in for a generic pending-count push after logout; default on';
comment on column public.employees.pending_notice_at is
  'Last generic signed-out pending notice, throttled to once per hour';
comment on column public.push_subscriptions.signed_out is
  'The owner signed out but kept this endpoint for generic pending counts';