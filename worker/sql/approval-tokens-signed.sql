-- Approval links v2: HMAC-signed token, single-use by nonce.
-- Run once in the Supabase SQL editor before deploying the Worker.
-- The link token is never stored: nonce_hash is the SHA-256 hex of its nonce.
-- Links issued before this migration (token_hash only) stop working; HR can
-- resend them.

alter table public.approval_tokens
  add column if not exists nonce_hash text;

-- New rows no longer write token_hash.
alter table public.approval_tokens
  alter column token_hash drop not null;

-- The atomic consume (UPDATE ... WHERE nonce_hash = ? AND used_at IS NULL)
-- hits this index, and uniqueness stops a nonce from being issued twice.
create unique index if not exists approval_tokens_nonce_hash_key
  on public.approval_tokens (nonce_hash);
