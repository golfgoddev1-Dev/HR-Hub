-- RLS hardening and missing indexes. Safe to run more than once.
--
-- Why: the Worker reaches Supabase only with the service role key, which
-- bypasses RLS. Nothing in the browser talks to Supabase directly. So every
-- table in `public` can be locked against the anon and authenticated roles
-- (the keys exposed by the project's REST API) without changing the app.
-- With RLS on and no policy, those roles see no rows.

-- 1. Enable RLS on every table in public.
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 2. Remove the default grants the public API roles hold, now and for tables
--    created later.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 3. Backup tables hold names and attendance data and are not used by the app.
--    Review them, then drop them when no longer needed:
--      drop table public.backup_meeting_sessions_20261102;
--      drop table public.backup_meeting_attendance_20261102;
--      drop table public.employees_fullname_backup_20261111;
--    Step 1 already locks them in the meantime.

-- 4. Indexes for the queries the Worker runs on every request or list page.
create index if not exists auth_sessions_employee_id_idx
  on public.auth_sessions (employee_id);
create index if not exists leave_requests_approver_status_idx
  on public.leave_requests (approver_id, status);
create index if not exists leave_requests_employee_start_idx
  on public.leave_requests (employee_id, start_date desc);
create index if not exists notification_queue_due_idx
  on public.notification_queue (status, next_attempt_at);
create index if not exists meeting_attendance_session_idx
  on public.meeting_attendance (session_id);
create index if not exists employees_department_idx
  on public.employees (department_id);
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at);
