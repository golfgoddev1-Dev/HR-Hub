-- Defence in depth for notification_queue.next_attempt_at.
--
-- The Worker always sends next_attempt_at on insert (src/push/queue.js), so this
-- is not required for the current code. It keeps an older deployed build, or a
-- manual insert, from failing the NOT NULL constraint with 23502.
--
-- NOT RUN as part of the fix. Apply deliberately in the Supabase SQL editor.

alter table public.notification_queue
  alter column next_attempt_at set default now();
