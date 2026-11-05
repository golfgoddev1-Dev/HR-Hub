-- DRAFT ONLY: not run by the Worker and not applied to any database.
-- The self-service profile page edits two contact columns and filters the
-- department dropdown by an active flag. No existing Worker code or SQL draft
-- names `employees.email`, `employees.phone` or `departments.is_active`, so this
-- draft adds them. IF NOT EXISTS keeps it safe if a column already exists.
--
-- Apply by hand on Supabase after a backup (DEPLOY.md section 4), then check the
-- profile page in a browser. Until it is applied the profile route cannot read
-- email/phone and answers 500 on save.

alter table public.employees
  add column if not exists email text,
  add column if not exists phone text;

alter table public.departments
  add column if not exists is_active boolean not null default true;

-- The profile dropdown offers only active prefixes, like the department one.
-- The lookup table already exists (worker/src/routes/hr-employees.js reads
-- name_prefixes.name for the import); only the flag is new.
alter table public.name_prefixes
  add column if not exists is_active boolean not null default true;

-- No unique index on email: many employees have none yet and nobody signs in
-- with an email address.
