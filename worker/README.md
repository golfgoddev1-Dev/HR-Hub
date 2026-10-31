# HR Workers spike (inside my-vue-app)

Throwaway feasibility spike for running the HR Hub PIN check on Cloudflare Workers. It is isolated
in `worker/` with its own `package.json`, dependencies and lockfile; the app's root files are not
touched. Plain JavaScript, Hono, Web Crypto only. **Nothing has been deployed.**

- Worker name: `hr-workers-spike`
- Entry: `src/index.js` · cron `*/10 * * * *` → `scheduled()` logs the time only (no DB write)
- `compatibility_date = "2026-09-01"`, no `nodejs_compat`

## Endpoints

| Route | Success response |
| --- | --- |
| `POST /test/pin` body `{ "pin": "1234" }` | `{ "match": true }` · `{ "match": false }` (400 if `pin` is missing / not a string) |
| `GET /test/db` | `{ "ok": true, "rows": 1 }` |
| `GET /test/bench` | `{ "runs": 200, "averageMs": 0.02 }` |

If any required variable is missing or still `REPLACE_ME`, a route answers
`503 { "error": "not_configured" }` and makes **no** outbound request. Neither the pepper nor the
hash is ever returned or logged.

## Steps for the owner

1. **Fill `.dev.vars`** in this folder (`worker/.dev.vars`) with local values:
   - `PIN_PEPPER` – the pepper used to hash PINs
   - `PIN_TEST_HASH` – HMAC-SHA256 hex of one **test** PIN, keyed with that pepper
   - `SUPABASE_URL` – project URL, no trailing slash
   - `SUPABASE_SERVICE_ROLE_KEY` – service role key

   `.dev.vars` is git-ignored; never commit it. To compute `PIN_TEST_HASH` without writing the
   pepper anywhere, from a shell where `PIN_PEPPER` is already exported:
   ```bash
   node -e "const{createHmac}=require('node:crypto');console.log(createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$PIN_PEPPER" "1234"
   ```
   Use a throwaway test PIN, never a real employee PIN.

2. **Run `npm install`, then `npm run dev`** from this folder (`wrangler dev` on localhost).

3. **Test the three endpoints locally**, e.g.:
   ```bash
   curl -X POST http://127.0.0.1:8787/test/pin -H "content-type: application/json" -d '{"pin":"1234"}'
   curl http://127.0.0.1:8787/test/db
   curl http://127.0.0.1:8787/test/bench
   ```
   Expect `{"match":true}`, `{"ok":true,"rows":1}` and `{"runs":200,"averageMs":...}`.

4. **Set the four secrets in the Cloudflare dashboard**: Workers & Pages → `hr-workers-spike` →
   Settings → Variables and Secrets → add `PIN_PEPPER`, `PIN_TEST_HASH`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` as **Secret**. These are what the deployed Worker uses; `.dev.vars`
   only affects local `npm run dev`.

5. **Run `npx wrangler login`** on your own machine (this spike never logged in).

6. **Run `npx wrangler deploy`** from this folder. The cron trigger is created as part of the deploy.

7. **Call `GET /test/bench`** on the deployed URL:
   `curl https://hr-workers-spike.<your-subdomain>.workers.dev/test/bench`

8. **Read the CPU time for that request in the Workers logs**: dashboard → Workers & Pages →
   `hr-workers-spike` → Logs (or the request in Metrics) → the `GET /test/bench` entry → CPU time.
   `averageMs` is only the in-process HMAC cost; CPU time per request is the real limit and decides
   whether 200 verifications per request is affordable.

9. **Delete the Worker after testing.** `GET /test/db` is public once deployed: anyone who learns
   the URL can hit it and the Worker will query `employees` with the service role key. Delete it in
   the dashboard (Workers & Pages → `hr-workers-spike` → Settings → Delete) as soon as the numbers
   are recorded. Deleting the local `worker/` folder afterwards is safe.

## Local checks

```bash
npm run typecheck   # node --check on each source file
npm test            # node --test (HMAC helper)
```

Results are recorded in `reports/spike.txt`.

## Notes

- `/test/db` issues exactly one `GET /rest/v1/employees?select=id&limit=1` with `apikey` and
  `Authorization: Bearer <key>`. There is no insert, update or delete anywhere in this spike.
- Upstream failures return `{ "ok": false, "status": <code> }` or `{ "ok": false, "error": "request_failed" }`;
  the Supabase body is never echoed back.
- `worker/` is self-contained: the root `package.json`, lockfile, `.gitignore`, app `src/`, `server/`,
  `vite.config`, `vercel.json` and `DEPLOY.md` are unchanged.
