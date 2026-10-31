# PIN reset code flow (read-only investigation)

Scope: `worker/` and `server/` (plus `scripts/` and `src/` where the flow enters or leaves them),
excluding `node_modules`, `dist`, `.wrangler`. No secrets, codes, or credential values are
reproduced here; only file names, line numbers and behaviour.

Searched terms: `pin_reset_codes`, `reset code`, `resetCode`, `RESET_CODES_TABLE`,
`issue:reset-code`, `set-pin`, `pin_reset_code_issued`.

## Match table

| File | Lines | Role |
| --- | --- | --- |
| `scripts/issue-reset-code.js` | 50–58 | **create (step 1)** — invalidates existing unused codes for the employee (`used_at = now`) |
| `scripts/issue-reset-code.js` | 60–68 | **create (step 2)** — generates the 8-digit code and inserts the row with `code_hash`, `created_by`, `expires_at` (+60 min), `attempts = 0` |
| `scripts/issue-reset-code.js` | 80–86 | create (side effect) — audit row `pin_reset_code_issued` |
| `scripts/issue-reset-code.js` | 88–97 | delivery — prints the code to the operator's terminal only |
| `server/routes/auth.js` | 77–88 | **verify (select)** — newest unused, unexpired, `attempts < 5` row for the employee |
| `server/routes/auth.js` | 93–96 | **verify (hash compare)** — HMAC of `${employee_id}:${code}` vs `code_hash` |
| `server/routes/auth.js` | 97–107 | verify (failed attempt) — increments `attempts`, sets `used_at` at 5 |
| `server/routes/auth.js` | 122–126 | **consume** — sets `used_at = now` |
| `worker/src/routes/auth.js` | 32 | constant `RESET_CODES_TABLE = "pin_reset_codes"` |
| `worker/src/routes/auth.js` | 38 | constant `RESET_CODE_MAX_ATTEMPTS = 5` |
| `worker/src/routes/auth.js` | 330–341 | **verify (select)** — same filters, ordered `created_at desc`, single row |
| `worker/src/routes/auth.js` | 348–350 | **verify (hash compare)** — same HMAC formula, timing-safe compare |
| `worker/src/routes/auth.js` | 351–358 | verify (failed attempt) — increments `attempts`, sets `used_at` at 5 |
| `worker/src/routes/auth.js` | 382–383 | **consume** — sets `used_at = now` |
| `worker/tests/auth-routes.test.js` | 143, 188–193, 676–803 | tests: fixture returns `resetCodes`, assertions that `set-pin` reads/patches `pin_reset_codes` |
| `worker/scripts/local-auth-e2e.mjs` | 111–118, 234, 336, 343 | local e2e helper shells out to `npm run issue:reset-code`, then reads `attempts` only |
| `package.json` | 17 | script alias `issue:reset-code` → `node scripts/issue-reset-code.js` |
| `src/pages/SetPinPage.vue` | 103, 144, 156, 233 | UI text only (how the staff member is told to obtain the code) |

No insert into `pin_reset_codes` exists anywhere under `worker/src` or `server/` (verified by
grep for `insert` on that table: zero matches outside the script).

## a. Which system creates a reset code row?

Neither HTTP API creates one. The only writer is the offline Node script
`scripts/issue-reset-code.js`, invoked as:

```
npm run issue:reset-code -- <employee_code>
```

(alias in `package.json:17`). It runs with the Express stack's config and Supabase client
(`server/config.js`, `server/crypto.js`, `server/supabase.js`) and loads `.env.local`
(`scripts/issue-reset-code.js:22`). It:

1. looks up the employee by `employee_code` and requires `is_active === true`,
2. looks up `ADM001` as the creator (`created_by`/audit actor) and fails if absent,
3. marks the employee's existing unused codes as used,
4. inserts one row with `code_hash = HMAC-SHA256(PIN_RESET_SECRET, "<employee_id>:<code>")`,
   `expires_at = created_at + 60 minutes`, `attempts = 0`, `used_at = null`,
5. writes an `audit_logs` row with action `pin_reset_code_issued`.

There is no route, no admin endpoint, and no UI button that creates a code (`server/routes/auth.js`
exposes only `/me`, `/set-pin`, `/login`, `/logout`; the Worker exposes only `/login`, `/me`,
`/logout`, `/set-pin`).

## b. How does the staff member receive the code?

Out of band, from HR. The script's only output channel is the operator's terminal: it prints the
code once with the expiry time and the line (quoted exactly, no values):

> `รหัสนี้แสดงครั้งเดียว กรุณาส่งให้พนักงานด้วยช่องทางที่ปลอดภัย`

No email, SMS, or in-app delivery exists. The staff-facing UI only tells them to get the code
from HR — `src/pages/SetPinPage.vue`:

- line 103: `กรอกเลขบัตร รหัส 8 หลักจาก HR และ PIN ใหม่ 6 หลัก`
- line 144 (label): `รหัสจาก HR 8 หลัก`
- line 156 (placeholder): `กรอกรหัส 8 หลัก`
- line 233: `หากไม่ได้รับรหัส 8 หลัก หรือรหัสหมดอายุ กรุณาติดต่อฝ่ายทรัพยากรบุคคลของหน่วยงานท่าน`

## c. Which system verifies and consumes the code?

Both, independently, on `POST /api/auth/set-pin`:

- **Express** — `server/routes/auth.js:40`, select 77–88, compare 93–96, failed attempt 97–107,
  consume 122–126.
- **Worker** — `worker/src/routes/auth.js:283`, select 330–341, compare 348–350, failed attempt
  351–358, consume 382–383.

Only the currently serving stack matters at runtime; each one verifies and consumes the same row
using the same rules (newest unused, unexpired, `attempts < 5`; 5 failures burn the code). After a
successful verify both stacks then write `employee_credentials.pin_hash`, reset the lock counters,
revoke `auth_sessions` for that employee, and insert an audit row with action `pin_set`.

## d. Does the Worker need `PIN_RESET_SECRET`?

**Verify only.** The Worker (a) reads the row, (b) computes
`HMAC-SHA256(PIN_RESET_SECRET, "<employee_id>:<code>")` and compares it to `code_hash`, and
(c) increments `attempts` / sets `used_at`. It never creates a row, so it never needs the secret
to mint a code.

The creation side needs the secret in the Express stack's environment, because the issuing script
imports `getRequiredEnv` and `hmacSha256Hex` from `server/` and reads `.env.local`.

**Must both share the same value? Yes.** The script writes `code_hash` with the secret from
`.env.local`; the Worker verifies with its own `PIN_RESET_SECRET` secret. Both use the identical
formula (`<employee_id>:<code>`, HMAC-SHA256, hex) so the rows are compatible — but only if the two
values are byte-identical. If they differ, every code issued by the script fails on the Worker
(and burns one of the 5 attempts each try), which looks exactly like "the code is wrong".

## e. Does the Worker have a route that creates codes?

No. The Worker has no create path for reset codes: no insert into `pin_reset_codes`, no admin
route, no UI. Issuing a code always requires the local Node script, its Supabase credentials, and
network access to Supabase — after cutover as well.

## f. Conflicts between the two systems

1. **No serverless issuance.** Reset codes can only be produced by a developer/operator machine
   running the script with `.env.local`. There is no Worker route and no admin UI, so a reset
   during cutover or later still depends on local tooling.
2. **The code is stack-neutral, the resulting PIN is not.** Express stores `pin_hash` as bcrypt;
   the Worker stores an HMAC over `${employee_id}:${pin}` with `PIN_PEPPER`. A code issued once can
   be consumed by either stack, but the PIN written afterwards only works on that stack. This is the
   same incompatibility already documented in `reports/rollback-plan.md`, and it is why imported
   data must carry Worker-computed hashes (see the Decisions section in `DEPLOY.md`).
3. **Failed-attempt update is not race-free in the Worker.** Express adds `.is('used_at', null)` to
   the attempt increment (`server/routes/auth.js:104`); the Worker patches by `id` only
   (`worker/src/routes/auth.js:356`), so two concurrent wrong guesses can both read `attempts = n`
   and write `n + 1`, losing one increment. Impact is limited (the code still expires and is still
   capped, just after possibly more than 5 tries).
4. **Issuance requires `ADM001`.** The script refuses to run if `ADM001` does not exist
   (`ไม่พบผู้สร้างรหัส (ADM001)`); neither verifier reads `created_by`, so this is an operational
   dependency, not a functional conflict.
5. **Single active code by design.** The script invalidates all unused codes for the employee before
   inserting, and both verifiers take only the newest row — consistent between stacks, but it means
   re-issuing silently kills the previous code.
6. **Audit coverage depends on the script.** `pin_reset_code_issued` is written only by the script;
   neither the Worker nor Express writes it, so code issuance stays outside the API's audit trail.

Consistent between the two: 8-digit numeric code, 5 attempt cap, `used_at` burn on success and on
the 5th failure, selection filters (`used_at is null`, `expires_at > now`, `attempts < 5`), and the
audit action `pin_set` on success.

## Not confirmed (from code)

- Whether the owner wants any additional issuance channel (email/SMS/admin UI). Nothing in the
  repository provides one.
- Whether the production `.env.local` value of `PIN_RESET_SECRET` already matches the Worker secret
  — env files are out of scope for this investigation and must not be read.
- The 60-minute expiry is set by the script only; both verifiers rely on `expires_at`, so there is
  no constant to keep in sync.
