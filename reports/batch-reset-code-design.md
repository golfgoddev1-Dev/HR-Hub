# Batch reset-code issuance — design options

Status: design only. No script, route, or schema change is implemented in this phase.
Covers how HR would issue PIN reset codes for more than one employee at a time.
All options are free: they use the owner's machine and the existing Cloudflare Workers
free plan, so the cost rule is satisfied without adding a service.

Reference for the current flow: `reports/reset-code-flow.md`.

## a. Current behaviour

`scripts/issue-reset-code.js` handles exactly one employee per run, invoked as
`npm run issue:reset-code -- <employee_code>` (alias in `package.json`).

- `main()` (line 9) takes `process.argv[2]` as the employee code and prints usage when it
  is missing (line 12).
- Loads `.env.local` (line 19) and builds a Supabase client with `getSupabase()` (line 21).
- Looks up the employee by `employee_code` and requires `is_active === true`
  (lines 22–37).
- Looks up `ADM001` as the creator and aborts when it is absent (lines 39–49).
- **Voids the employee's existing unused codes** by setting `used_at` on every row with
  `employee_id` matching and `used_at is null` (lines 51–57).
- Generates one 8-digit code and inserts a single `pin_reset_codes` row with the HMAC of
  `<employee_id>:<code>`, `expires_at` at +60 minutes, `attempts = 0` (lines 59–75).
- Inserts the `audit_logs` row with action `pin_reset_code_issued`, actor `ADM001`
  (lines 77–86).
- Prints the code once to the terminal with its expiry (lines 88–97). Nothing is written
  to disk.

There is no route in either stack that creates a reset code, so this script is the only
issuance path today.

## b. Constraints

1. **Runs on the owner's machine.** It imports `server/config.js`, `server/crypto.js` and
   `server/supabase.js`, and reads `.env.local`. It is not deployable to the Worker as-is
   (it is a Node script using `dotenv`, `node:crypto`, and the Express config layer).
2. **Needs Supabase service credentials.** `getSupabase()` uses the service role key, so
   the machine that runs it holds full database access. That machine must be trusted and
   the `.env.local` must stay out of the repository.
3. **Needs the same `PIN_RESET_SECRET` as the Worker.** The Worker verifies codes with its
   own secret; a different value makes every issued code fail (and burn an attempt per
   try). This is a hard coupling, unchanged by batching.
4. **Codes must not land in logs or files other people can open.** The code is a
   credential: whoever reads it can set that employee's PIN. Terminal scrollback, CI logs,
   shared drives, chat, and screenshots are all exposure. Any file output has to be treated
   as a secret with a deletion step.
5. **One active code per employee.** The voiding step means a second issuance for the same
   employee silently kills the first code.
6. **The issuer identity is hardcoded.** `ADM001` is the audit actor for every run; the
   script cannot record who actually ran it.
7. **Codes expire in 60 minutes**, and the batch has to be distributed within that window
   or re-issued.

## c. Option 1 — loop over a list of employee codes, one run per employee

Operator supplies N employee codes and runs the existing script N times (manually, or with
a shell loop such as `for c in ...; do npm run issue:reset-code -- "$c"; done`), reading
each code off the terminal and sending it to that employee.

**Pros**

- Zero code change and zero new attack surface; the reviewed behaviour (voiding, 60-minute
  expiry, audit row, one-time display) stays exactly as it is.
- No file ever contains codes, so the "plain-text secret file" risk does not exist.
- A failure for one employee (inactive, missing, DB error) is isolated; the remaining runs
  still proceed.
- Easy to reason about during cutover, when nothing else should be changing.

**Cons**

- Manual and slow; codes are copied by hand, which invites transcription errors.
- Terminal scrollback accumulates every code from the batch in one window — a single
  screenshot or shared screen exposes all of them.
- No batch-level record: the operator has to track who was issued and who was not.
- Easy to run the same employee twice by accident, which voids the first code (see g).
- Distribution is entirely manual, so the 60-minute window is tight for a large batch.

## d. Option 2 — one run with a list file, one session, optional encrypted export

A new script reads a list of employee codes (one per line) and issues codes for all of them
in one run, either printing them together at the end of the session or writing them to an
encrypted file (for example `age`/`gpg` with a key the operator holds), which is decrypted
only when handing codes out and deleted immediately afterwards.

**Pros**

- One command per batch; the operator can see the whole result, including which employees
  failed (inactive, missing, database error), before distributing anything.
- An encrypted export is the only variant that survives the 60-minute window comfortably:
  the operator can decrypt per employee while distributing.
- A single summary line (counts only, never codes) can be logged safely for the record.
- Still no new route and no change to the Worker; the Worker keeps verifying the same rows.

**Cons**

- Needs new code, which is exactly what this phase is not implementing; it must be
  reviewed and tested like any credential-issuing tool.
- A plain-text output file would be a credential dump: it must be encrypted, permissioned,
  deleted after distribution, and never committed, synced, or opened on a shared machine.
  That deletion step will eventually be forgotten by someone.
- Key management for the encrypted file (who holds the key, where the private key lives) is
  new operational overhead, and a lost key means re-issuing everything.
- The whole batch shares one expiry window; a slow distribution wastes codes and needs a
  second run, which voids the first for anyone not yet served.
- Partial failure semantics have to be designed: does the run stop, continue, or roll back?
  (Nothing is transactional across employees.)

## e. Option 3 — HR issues codes from a page on the Worker

An authenticated HR page calls a new Worker route that creates reset codes, showing each
code on screen (or returning it in the response).

**Why it is not recommended for this phase**

- It adds a route that **creates credentials** to the API — the single most sensitive
  write in the system — immediately before cutover, when the priority is to keep the
  surface small and the behaviour already reviewed.
- It needs its own authorization design: HR-admin session check (and which of
  `hr_admins` / `system_admins` may issue), `isSameOriginRequest` protection, rate
  limiting, and Turnstile or equivalent if exposed broadly. Each is a new failure mode.
- The code would transit the browser and the Pages proxy; response bodies and browser
  devtools then become an exposure path that does not exist when the code is printed on
  the owner's machine.
- The Worker cannot email or SMS, so delivery is still a human copying a code off a screen,
  with the same distribution problem and a shorter trust boundary.
- It changes the audit story mid-cutover: today `pin_reset_code_issued` comes only from the
  script; adding a second writer means two code paths to keep consistent.

**What it would need if the owner ever wants it:** an admin-only route with role check and
same-origin guard, rate limiting, an audit row recording the real actor, a UI restricted to
HR roles, tests for the 401/403 paths, and a decision on how the code is displayed and
expires without being cached.

## f. Audit trail per option

| Option | Rows written | Who the row names | Gap |
| --- | --- | --- | --- |
| 1 | One `pin_reset_code_issued` per employee | `ADM001` (hardcoded) | Does not record the human or the machine that ran it |
| 2 | Same rows, one per employee, plus an optional count-only summary line in the terminal | `ADM001` (hardcoded) | Same gap; file access is not audited at all |
| 3 | Same action, one per code, plus the route's own request log | The signed-in admin (`actor_id` from the session) | Best identity record, but only after implementation and review |

In every option `pin_set` is still written by the verifier when the employee actually uses
the code, so the pair (issued → set) can be reconstructed from `audit_logs`. None of the
options record *delivery* — there is no proof the employee received the code.

## g. The voiding rule

Every run first sets `used_at` on all of that employee's unused codes (script lines 51–57)
and only then inserts the new one. Consequences:

- The batch must run **once per employee**. Running it twice (or including the same code
  twice in a list) silently invalidates the code the employee was already given; the
  employee sees "invalid code" with no explanation and burns attempts.
- There is no idempotency key or confirmation prompt, so an accidental re-run is
  indistinguishable from an intentional re-issue.
- Mitigations to agree before any batch: a printed checklist of who was issued, a
  `--dry-run` or count-only preflight that lists employees who already have an active code
  (not implemented today), and never re-running a batch to "make sure" it worked.

## h. Recommendation and owner decisions

**Recommended: Option 1 for this phase.** It needs no code, adds no credential-creating
route, keeps every existing safeguard, and is the only option with no chance of leaving a
file full of live codes behind. For a staff list small enough to handle by hand, the speed
cost is small compared with the review and key-management work that Options 2 and 3
introduce at cutover. Revisit Option 2 only if the batch routinely exceeds roughly a few
dozen employees, and then only with encryption plus a named person responsible for
deleting the file.

Decisions the owner must make before any implementation:

1. **Who runs it, and on which machine** — it must be a trusted machine holding
   `.env.local` with the service role key and the same `PIN_RESET_SECRET` as the Worker.
2. **How codes reach staff** — a channel that is one-to-one (not a group chat), since the
   code plus the national ID is enough to set a PIN.
3. **Whether `ADM001` stays the audit actor** or the tooling should record the real
   operator (which Option 3 would do properly).
4. **Batch scope** — everyone, or only employees who have never set a PIN / whose codes
   expired.
5. **Whether any file output is allowed at all.** If yes: encryption method, who holds the
   key, and the deletion rule.
6. **Whether to add a `--dry-run`/count-only mode** before real batch use, so the voiding
   rule in (g) is harder to trip.

## Not confirmed (from code)

- The size of the staff list and whether a batch is even needed at cutover — not derivable
  from the repository.
- Whether the owner's machine currently has a valid `.env.local` for the issuing script —
  environment files were not read.
- Whether the 60-minute expiry is acceptable for distribution; it is set only in the script
  (line 64) and both verifiers rely on `expires_at`, so it can be changed, but no decision
  has been recorded.
- Whether any HR-facing admin UI is planned elsewhere; nothing in the repository provides
  one.
