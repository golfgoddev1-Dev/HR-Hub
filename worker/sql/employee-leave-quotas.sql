-- Employee leave quotas: one row per employee, leave type and year.
--
-- NOT run by this change. Run once in the Supabase SQL editor before deploying
-- the Worker (step 1 of the deploy order in the change report). The Worker
-- tolerates the table being absent on read, but every save fails until it
-- exists.
--
-- Types come from the code, not a guess:
--   employees.id and leave_types.id are uuid (leave-hr.js validates
--   employeeId/leaveTypeId with the same UUID pattern before selecting by id).
--   quota_days is numeric(4,1) because leave_requests.days stores 0.5 for a
--   half-day shift and whole days otherwise (worker/src/leave-rules.js
--   computeLeave), so a quota can be a half day too.
--
-- The primary key is the identity of a quota: one value per employee, leave
-- type and year. updated_by is the HR employee who saved it last.

create table if not exists public.employee_leave_quotas (
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  quota_days numeric(4,1) not null check (quota_days between 0 and 366),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  primary key (employee_id, leave_type_id, year)
);

-- The same lock-down every other table in worker/sql uses: the Worker reaches
-- the table with the service role, the anon key gets no rows.
alter table public.employee_leave_quotas enable row level security;
