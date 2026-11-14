-- The HR home menu shortcuts: 1 to 5 HR menu routes, per person, in the order
-- that person chose them.
--
-- NOT RUN as part of this change. Apply deliberately in the Supabase SQL editor
-- before deploying the Worker that reads this column.
--
-- An empty array means "nothing chosen": the HR home shows the system default
-- (ใบลาทั้งหมด, รายชื่อพนักงาน, วันหยุด). The check constraint keeps a saved
-- choice between one and five, so a partial edit cannot leave an empty list and
-- the home page never has to guess between "empty" and "broken".
--
-- The routes are validated in the Worker against the HR navigation list, not in
-- SQL: the allowlist moves with src/lib/nav-config.js, the column does not.

alter table public.employees
  add column if not exists hr_menu_shortcuts text[] not null default '{}';

alter table public.employees
  add constraint employees_hr_menu_shortcuts_len
  check (cardinality(hr_menu_shortcuts) between 1 and 5);

comment on column public.employees.hr_menu_shortcuts is
  'HR home menu shortcuts, in the order the person chose; empty means the system default';
