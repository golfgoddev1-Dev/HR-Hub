-- Phase 2a: approval by email link.
-- Run once in the Supabase SQL editor before deploying the Worker.
-- The raw link token is never stored: token_hash is its SHA-256 hex.

create table if not exists public.approval_tokens (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references public.leave_requests(id) on delete cascade,
  approver_employee_id uuid not null references public.employees(id) on delete restrict,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_by uuid references public.employees(id) on delete set null
);

create unique index if not exists approval_tokens_token_hash_key
  on public.approval_tokens (token_hash);

create index if not exists approval_tokens_request_open_idx
  on public.approval_tokens (leave_request_id, invalidated_at);

-- The Worker uses the service role key, which bypasses RLS. RLS with no policy
-- keeps anon/authenticated clients out of the table entirely.
alter table public.approval_tokens enable row level security;
