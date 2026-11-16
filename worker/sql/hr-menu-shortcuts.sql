-- HR home menu shortcuts: 0 to 5 HR menu routes, per person, in the order
-- that person chose them.
--
-- Run once in the Supabase SQL editor before deploying the Worker that reads
-- this column. Safe to run again.
--
-- An empty array (0 routes) means "nothing chosen": the HR home shows the
-- system default. The Worker never saves an empty list; its PUT endpoint
-- requires 1 to 5 routes. The check constraint therefore allows 0 so that the
-- default rows already in the table pass.
--
-- The routes are validated in the Worker against the HR navigation list, not
-- in SQL: the allowlist moves with src/lib/nav-config.js, the column does not.

alter table public.employees
  add column if not exists hr_menu_shortcuts text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_hr_menu_shortcuts_len'
  ) then
    alter table public.employees
      add constraint employees_hr_menu_shortcuts_len
      check (cardinality(hr_menu_shortcuts) between 0 and 5);
  end if;
end $$;

comment on column public.employees.hr_menu_shortcuts is
  'HR home menu shortcuts, in the order the person chose; empty means the system default';
