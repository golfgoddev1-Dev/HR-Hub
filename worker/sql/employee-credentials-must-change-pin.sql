-- Draft only: this file was not run against any database.
--
-- The "จัดการรหัสผ่านพนักงาน" page issues an initial PIN for an employee. That
-- PIN is a one-time way in, so the employee must replace it with their own PIN
-- before it is treated as final. The flag below records that obligation; the
-- HR endpoint sets it to true and /api/auth/set-pin clears it once the employee
-- has chosen a PIN themselves.
--
-- Apply after review:
--   psql "$DATABASE_URL" -f worker/sql/employee-credentials-must-change-pin.sql

alter table employee_credentials
  add column if not exists must_change_pin boolean not null default false;

comment on column employee_credentials.must_change_pin is
  'true when the current PIN was issued by HR and the employee has not yet chosen their own';
