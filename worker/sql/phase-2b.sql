-- Phase 2b: shift-lead notices, employee report emails and token cleanup.
-- Run once in the Supabase SQL editor before deploying the Worker.

-- At most two leads per department is enforced by the application, which
-- replaces the whole list in one guarded write (delete, then insert <= 2 rows).
-- The database enforces one row per person and one label per department.
create table if not exists public.department_shift_leads (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_label text not null check (char_length(btrim(shift_label)) between 1 and 30),
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,
  unique (department_id, employee_id)
);

create unique index if not exists department_shift_leads_label_key
  on public.department_shift_leads (department_id, lower(btrim(shift_label)));

-- Durable dedupe for the decision emails. The unique key is the idempotency
-- key: (leave_request_id, recipient_employee_id, kind, decision). The row
-- holds ids only; the message text is rebuilt at send time from the source
-- tables, so no name, address or reason is copied into the queue.
create table if not exists public.decision_email_jobs (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  recipient_employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('shift_lead_approved', 'shift_lead_rejected', 'employee_approved', 'employee_rejected')),
  decision text not null check (decision in ('approved', 'rejected')),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (leave_request_id, recipient_employee_id, kind, decision)
);

create index if not exists decision_email_jobs_status_idx
  on public.decision_email_jobs (status, created_at);

-- The daily cleanup selects old rows, then deletes the selected ids; this
-- index keeps that first read bounded as the token table grows.
create index if not exists approval_tokens_cleanup_idx
  on public.approval_tokens (created_at);

alter table public.department_shift_leads enable row level security;
alter table public.decision_email_jobs enable row level security;

-- Phase 2b correction: the employee is also emailed on a rejection.
alter table public.decision_email_jobs drop constraint if exists decision_email_jobs_kind_check;
alter table public.decision_email_jobs add constraint decision_email_jobs_kind_check
  check (kind in ('shift_lead_approved', 'shift_lead_rejected', 'employee_approved', 'employee_rejected'));

-- One certificate-view audit row per viewer, request and Bangkok calendar day.
-- The insert uses resolution=ignore-duplicates, so a repeat open is a no-op.
create unique index if not exists audit_logs_medical_cert_day_key
  on public.audit_logs (
    actor_id,
    entity_id,
    ((created_at AT TIME ZONE 'Asia/Bangkok')::date)
  )
  where action = 'view_medical_cert';
