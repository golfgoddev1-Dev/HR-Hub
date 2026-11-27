# HR Hub — Technical Debt Audit

Date: 2026-11-27 · Branch `release` @ `68ecf2d` · Read-only audit (no code, migration or deploy changes).

Stack verified: Vue 3 + Vite 8 + Vuetify 4 SPA on Cloudflare Pages; `functions/api/[[path]].js` proxies `/api/*` to a Hono Worker (`worker/`) over a service binding; Worker talks to Supabase REST/Storage with the service-role key only (no Supabase client in the browser).

Method: narrow `graphify query` per area (graph built at `6842bc0c`, 6 commits stale; queries for auth/v-html were off-target), then every finding verified in source/SQL. Test suites run: root vitest 98 files / 1120 tests pass; worker `node --test` 872 pass.

## Verified issues (most important first)

| ID | Area | File:line | Issue | Evidence | Impact | Sev | Effort | Fix |
|----|------|-----------|-------|----------|--------|-----|--------|-----|
| TD-01 ✅ fixed 2026-11-27 | Data integrity / privacy | `worker/src/leave-retention.js:67-68`, `worker/src/maintenance/cleanup.js:386` | Retention never deletes medical-certificate files written by the app | Upload stores the bare path `leave/<emp>/<code>/<file>` (`leave-attachment.js` `attachmentPath`, `routes/leave.js:651-666`). `certificateStoragePath()` only accepts values starting with `leave-certificates/` or a storage URL, so it returns `null`. `runCertificateCleanup` then puts the row in `withoutPath` and only clears the DB column; `purgeOldLeaveData` excludes it from `withPath` and deletes the leave row. | Medical files (sensitive health data) stay in the bucket forever, now unreferenced and unfindable; retention policy silently not applied. HR preview `certificateFiles` reports 0. | H | S | Accept bare `leave/...` paths in `certificateStoragePath` (use `isCertificatePath`), add a test with the real upload path, then run a one-off orphan sweep of the bucket. |
| TD-02 ✅ fixed 2026-11-27 | Test gap | `tests/leave-retention.test.js:74-125` | Retention tests never use the path format the upload writes | All cases use `leave-certificates/...` or URLs; `'a/b.png'`-style bare paths are asserted to return `null` | Let TD-01 ship with green tests | H | S | Add a round-trip test: `attachmentPath()` output → `certificateStoragePath()` must be non-null. |
| TD-03 | Cloudflare Free | `worker/src/index.js:68`, `worker/src/maintenance/cleanup.js:18-19,82-110`, `worker/src/leave-retention.js:178` | Daily maintenance has no subrequest budget | One cron invocation runs certificate cleanup (1 update per row, up to 50) in parallel with 5 purges, each up to `5000/200 = 25` select+delete pairs. Free plan caps 50 subrequests/invocation; `push/queue.js:37` budgets for it, cleanup does not. | On any backlog (first run, audit-log growth) later fetches throw and are caught/logged per table; jobs silently stop part-way. Risk unverified (not measured). | M | M | Give the cron a shared subrequest budget (as `push/queue.js`), batch the per-row clears into one `id=in.(...)` update. |
| TD-04 | Security / audit | `worker/src/routes/hr-employees.js:905-942`, `worker/sql/baseline/0002_tables.sql:273` | National ID reveal log records the viewer and day count, not whose ID was revealed | RPC called with `p_viewer`, `p_day` only; `national_id_view_log` has no subject column | Cannot answer "who looked at employee X's national ID" (PDPA access audit) | M | S | Add an `audit_logs` row (actor, entity_id = employee) per reveal, or a subject column. |
| TD-05 | Security | `worker/src/require-role.js:16-28` | Forced PIN change fails open | `mustChangePinFor` returns `false` on any DB error (documented choice) | During a DB hiccup an HR-issued one-time PIN session gets full access | L | S | Fail closed for this check (return 503), or accept and document as a risk decision. |
| TD-06 | Performance / Free plan | `worker/src/session.js:120-160`, `require-role.js:16`, `routes/leave.js:280-293` | ~8 Supabase round-trips before any route logic | Per request: session select, employees `*`, 3 admin-table checks, touch update, `leave_requests` pending query (employee role only, used just to build `redirectTo`), `must_change_pin` select, then route guard re-reads employee | Latency on every API call; eats into the 50-subrequest cap | M | M | Return `redirectTo` only from `/api/auth/me`; read `must_change_pin` and role tables in one view/RPC; narrow `columns: "*"`. |
| TD-07 | Security (defence in depth) | `worker/src/pin-rules.js` `pinHash`, `worker/src/pin-verify.js` | PIN hash is a single fast HMAC-SHA256 over a 6-digit PIN | `hmacSha256Hex(pepper, "employeeId:pin")` | If DB **and** `PIN_PEPPER` leak, every PIN is recoverable instantly (1M space). Online guessing is well limited (5 tries / 15 min + IP limiter, fails closed). | L | M | Document as accepted risk (CPU limit blocks a slow KDF on Free); keep pepper rotation procedure. |
| TD-08 | Maintainability | `worker/src/routes/*.js` | Request helpers copy-pasted across route files | `readStrictJson` ×13, `isJsonContentType` ×13, `UUID_PATTERN` ×13, `ensureOk` ×13, `isPlainObject` ×17, `logError` ×21 | Validation fixes must be applied 13 times; copies can drift (body-size limit lives in each copy) | M | M | Move to one `worker/src/http.js` and import. |
| TD-09 | Maintainability | `worker/src/routes/leave.js` (1570 lines), `routes/leave-hr.js` (1562), `src/pages/ControllerDashboardPage.vue` (2294), `src/pages/LoginPage.vue` (1774), `src/pages/HrLeaveRequestsPage.vue` (1758) | Oversized files | `wc -l` | Hard review, merge conflicts | L | L | Split by sub-route / extract components when next touched. |
| TD-10 | Dead code | `worker/src/pin.js:17` | `pinHmacHex` / `hmacHexMatches` unused by app code | Only `worker/tests/hmac.test.js` imports it; its hash format (no employee id) differs from the real `pinHash` | Misleading: tests cover a hash nobody uses | L | S | Delete `pin.js` and its test (real hash is tested via `pin-rules`). |
| TD-11 | Dependencies | `package.json:26` | `@fullcalendar/list` unused | No import in `src/` | Install weight only | L | S | Remove. |
| TD-12 | Dependencies | `package.json:28,30,33` | Script/dev-only packages listed as runtime `dependencies` | `@supabase/supabase-js`, `dotenv` used only in `scripts/`; `concurrently` only in the `dev` script | Not bundled (tree-shaken), but blurs what ships | L | S | Move to `devDependencies`. |

## Fix log

- 2026-11-27 TD-01/TD-02: `certificateStoragePath` (`worker/src/leave-retention.js`) now accepts the bare upload path when `isCertificatePath` passes. Tests added: `tests/leave-retention.test.js` (`attachmentPath` → `certificateStoragePath` round trip, `..` refused) and `worker/tests/leave-data-cleanup.test.js` (purge sends a Storage DELETE with the stored path). Both fail on the old code. Still open: a one-off sweep of orphan objects already left in the `leave-certificates` bucket (needs live access; not done).

## Checked and found sound (no issue)

- Every Worker route handler calls a server-side guard (`requireRole` / `requireHrAdmin` / per-file `guard`); public routes are only `/api/auth/*`, `/api/register/*`, `/api/approve-link/*` (signed, single-use, nonce-hashed, rate-limited).
- IDOR: leave detail uses `canViewLeaveRequest`; approve/reject checks `approver_id === caller`; employee certificate download is owner-only + sick-leave only; HR certificate access requires live `hr_admins` membership and writes an audit row.
- Upload: type allowlist + magic-byte check, 10 MB cap, served `inline` with `nosniff`.
- National ID: HMAC lookup hash + AES-GCM encrypted copy; full value only via HR-only, rate-limited reveal (see TD-04).
- RLS: `worker/sql/rls-hardening.sql` enables RLS on every `public` table and revokes anon/authenticated grants; browser never talks to Supabase.
- No `v-html` / `innerHTML` in `src/`. Session cookie `HttpOnly; SameSite=Strict; Secure`. Cross-origin write Origin check in `app.js`.
- xlsx import: zip-bomb limits before inflate (`import/xlsx.js:20-24`).
- Routes are lazy-loaded (`src/router.js`). Listener/timer scan found no leaks (calendar per-event listeners die with their DOM nodes).

## Unverified suspicions

- Backup tables with names/attendance (`backup_meeting_*_20261102`, `employees_fullname_backup_20261111`) may still exist in the live DB (`rls-hardening.sql` step 3 says "drop when no longer needed"). Not checked against production.
- Worker CPU time (Free 10 ms) for: 10 MB certificate multipart parse, xlsx unzip of 1 MB upload, AES/HMAC per row in employee lists, Web Push ECDH/AES per message. Not measured; logic is I/O-bound in most paths.
- Orphan objects from TD-01 likely already exist in the `leave-certificates` bucket if either retention job has ever run with rows due.
- Inline PDF served from the app origin: relies on the browser PDF viewer sandbox.

## Areas not checked

- Frontend reactivity misuse (only listeners/timers and lazy-loading were scanned).
- `mail-relay/`, `worker/src/email/*`, `worker/src/push/*` internals, `auto-absent.js`, backfill import logic in depth.
- `npm outdated` / `npm audit` (no registry query run); xlsx pinned to SheetJS CDN tarball 0.20.3 not compared to latest.
- Live Supabase state (policies, grants, buckets, storage settings), Cloudflare dashboard settings, secrets.
- `.env*` and `worker/.dev.vars` were not opened, by instruction.
