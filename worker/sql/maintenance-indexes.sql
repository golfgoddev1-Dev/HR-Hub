-- Indexes for session authentication and the 02:00 retention cleanup.
--
-- NOT RUN as part of this change. Apply deliberately in the Supabase SQL editor.
-- This file only creates indexes; it drops nothing and changes no data.
--
-- Existing worker/sql/ files define no indexes. `auth_sessions.id` is the
-- primary key used by revokeSession; token_hash is the separate lookup column.

-- readSession looks up by token_hash, while rejecting revoked/expired rows.
create index if not exists auth_sessions_token_hash_idx
  on public.auth_sessions (token_hash);

-- Login/set-pin revokes all live sessions for one employee.
create index if not exists auth_sessions_employee_id_idx
  on public.auth_sessions (employee_id);

-- Daily cleanup: expires_at < cutoff and revoked_at < cutoff.
create index if not exists auth_sessions_expires_at_idx
  on public.auth_sessions (expires_at);

create index if not exists auth_sessions_revoked_at_idx
  on public.auth_sessions (revoked_at);

-- Daily cleanup: audit_logs.created_at < cutoff. The app never writes this
-- column; the table default supplies it.
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at);

-- Daily cleanup: notification_queue created_at < cutoff, limited to the final
-- statuses. pending and sending rows are never matched.
create index if not exists notification_queue_status_created_at_idx
  on public.notification_queue (status, created_at);

-- Leave cleanup and the history read: final requests by end_date, and one
-- approver's decisions newest first.
create index if not exists leave_requests_status_end_date_idx
  on public.leave_requests (status, end_date);

create index if not exists leave_requests_approver_status_decided_at_idx
  on public.leave_requests (approver_id, status, decided_at desc);

create index if not exists leave_requests_status_decided_at_idx
  on public.leave_requests (status, decided_at desc);

-- Leave cleanup reads the queue rows of the requests it is about to delete.
create index if not exists notification_queue_leave_request_id_idx
  on public.notification_queue (leave_request_id);
