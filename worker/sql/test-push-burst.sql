-- Push burst test: queues 8 pending notification_queue rows for TEST accounts only.
-- Run in the Supabase SQL editor. Not a migration; do not apply it anywhere else.
--
-- 1. Fill in the two code lists in `cfg` (employees.employee_code, exact match).
-- 2. Run with do_insert = false: nothing is written, the result is the preview.
-- 3. Change do_insert to true and run again: the rows are queued.
-- 4. Run QUERY 2 to watch them drain, QUERY 3 to clean up.
--
-- Safety: a row is only created for an employee whose code is in the lists, who is
-- active, and who has at least one active, not-signed-out device. Everyone else is
-- never selected. Row ids are fixed (d0d0d0d0-0000-4000-8000-0000000000NN), so
-- running it twice cannot double-queue and cleanup matches exactly these rows.
-- leave_request_id is null, so no real leave request is linked or touched.

-- ===== QUERY 1: preview (do_insert = false) / queue (do_insert = true) =====
with cfg as (
  select
    array['KCS-00663']::text[] as approver_codes,
    array['EM001']::text[] as employee_codes,
    false as do_insert
),
rcpt as (
  select 'approver' as role, e.id, e.employee_code, e.full_name,
         row_number() over (order by e.employee_code) as n,
         count(*) over () as cnt
  from public.employees e, cfg
  where e.employee_code = any (cfg.approver_codes)
    and e.is_active
    and (exists (select 1 from public.employee_approvers a
                 where a.approver_id = e.id and a.is_active)
         or exists (select 1 from public.department_approvers d
                    where d.employee_id = e.id and d.is_active))
    and exists (select 1 from public.push_subscriptions s
                where s.employee_id = e.id and s.is_active and not s.signed_out)
  union all
  select 'employee', e.id, e.employee_code, e.full_name,
         row_number() over (order by e.employee_code),
         count(*) over ()
  from public.employees e, cfg
  where e.employee_code = any (cfg.employee_codes)
    and e.is_active
    and exists (select 1 from public.push_subscriptions s
                where s.employee_id = e.id and s.is_active and not s.signed_out)
),
slots as (
  select v.*, row_number() over (partition by v.role order by v.slot) as k
  from (values
    (1, 'leave_submitted', 'approver'),
    (2, 'leave_submitted', 'approver'),
    (3, 'leave_decided',   'employee'),
    (4, 'leave_submitted', 'approver'),
    (5, 'leave_decided',   'employee'),
    (6, 'leave_backdated', 'employee'),
    (7, 'leave_submitted', 'approver'),
    (8, 'leave_decided',   'employee')
  ) as v(slot, kind, role)
),
plan as (
  select
    s.slot, s.kind, s.role,
    format('d0d0d0d0-0000-4000-8000-%s', lpad(s.slot::text, 12, '0'))::uuid as id,
    r.id as employee_id, r.employee_code, r.full_name,
    (select count(*) from public.push_subscriptions p
      where p.employee_id = r.id and p.is_active and not p.signed_out) as devices,
    now() - make_interval(secs => 9 - s.slot) as due_at,
    case s.kind
      when 'leave_submitted' then jsonb_build_object(
        'title', 'ระบบใบลา',
        'body', 'มีรายการรออนุมัติใหม่ 1 รายการ',
        'route', 'approvals',
        'tag', 'leave-submitted',
        'kind', s.kind,
        'count', (select count(*)::int from public.leave_requests lr
                  where lr.approver_id = r.id and lr.status = 'pending'))
      when 'leave_decided' then jsonb_build_object(
        'title', 'ระบบใบลา',
        'body', 'มีการอัปเดตใบลาของคุณ',
        'route', 'leave',
        'tag', 'leave-decided',
        'kind', s.kind)
      else jsonb_build_object(
        'title', 'ระบบใบลา',
        'body', 'มีการอัปเดตใบลาของคุณ',
        'route', 'leave',
        'tag', 'leave-backdated',
        'kind', s.kind)
    end as payload
  from slots s
  left join lateral (
    select * from rcpt x
    where x.role = s.role and x.n = ((s.k - 1) % x.cnt) + 1
  ) r on true
),
ins as (
  insert into public.notification_queue
    (id, employee_id, leave_request_id, kind, payload, status, attempts, next_attempt_at, created_at)
  select p.id, p.employee_id, null, p.kind, p.payload, 'pending', 0, p.due_at, p.due_at
  from plan p, cfg
  where cfg.do_insert and p.employee_id is not null
  on conflict (id) do nothing
  returning id
)
select
  p.slot,
  p.kind,
  p.employee_code,
  p.full_name,
  p.devices as devices_that_will_buzz,
  p.payload->>'route' as opens,
  p.payload->>'count' as badge_count,
  p.payload->>'body' as body,
  case
    when p.employee_id is null then 'SKIPPED: no eligible test account'
    when not cfg.do_insert then 'preview only'
    when i.id is not null then 'queued'
    else 'already exists'
  end as result
from plan p
cross join cfg
left join ins i on i.id = p.id
order by p.slot;

-- Queries 2 and 3 are commented out so that Run on the whole file only does QUERY 1.
-- Uncomment one, select just it, and run.

-- ===== QUERY 2: watch progress (pending -> sending -> sent) =====
-- The worker sends at most 2 rows per cron run, so 8 rows take about 4 minutes.
-- select id, kind, status, attempts, last_error, sent_at
-- from public.notification_queue
-- where id::text like 'd0d0d0d0-0000-4000-8000-%'
-- order by id;

-- ===== QUERY 3: cleanup of leftover test rows (any status) =====
-- Matches only the 8 fixed ids above with no linked leave request.
-- delete from public.notification_queue
-- where id::text like 'd0d0d0d0-0000-4000-8000-%'
--   and leave_request_id is null
-- returning id, employee_id, kind, status, attempts;
