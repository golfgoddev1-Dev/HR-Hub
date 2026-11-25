-- Drops four indexes that repeat another index on the same columns and
-- predicate. Each kept index is checked first; the migration stops if one is
-- missing, so nothing is dropped unless its twin exists.
-- No Worker query uses these index names; no ON CONFLICT target depends on them.

do $$
declare
  kept text;
begin
  foreach kept in array array[
    'audit_logs_created_at_idx',
    'auth_sessions_employee_id_idx',
    'leave_requests_approver_idx',
    'employee_credentials_national_id_hash_unique'
  ] loop
    if to_regclass('public.' || kept) is null then
      raise exception 'kept index % is missing; nothing dropped', kept;
    end if;
  end loop;
end $$;

drop index if exists public.audit_logs_created_idx;
drop index if exists public.auth_sessions_employee_idx;
drop index if exists public.leave_requests_approver_pending_idx;
drop index if exists public.employee_credentials_nid_uidx;
