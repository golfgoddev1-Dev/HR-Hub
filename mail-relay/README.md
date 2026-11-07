# HR Hub mail relay (Google Apps Script)

The HR Hub Worker sends mail through a small Google Apps Script web app owned by
the company Google Workspace account. Mail leaves from that account via `MailApp`,
so there is **no DNS change** and no third-party mail provider.

```
hr-hub-api (Cloudflare Worker) --HTTPS POST JSON--> Apps Script web app --MailApp--> recipient
```

This folder is **not** a Cloudflare Worker. It holds two plain files that the
owner pastes into a new Apps Script project, plus Node tests for the pure logic.

| File | Purpose |
|---|---|
| `Code.gs` | `doPost(e)`: kill switch, body checks, payload checks, token, allowlist, caps, `MailApp.sendEmail` |
| `relay-core.js` | Pure logic (no Apps Script services); used by `Code.gs` and by the tests |
| `tests/relay-core.test.js` | `node:test` tests for the pure logic |

## Request the Worker sends

```
POST <APPS_SCRIPT_URL>?token=<RELAY_TOKEN>
Content-Type: application/json
X-Relay-Token: <RELAY_TOKEN>

{ "to": "<one address>", "subject": "<text>", "text": "<plain text>" }
```

Answers are JSON only: `{ "ok": true }` or `{ "ok": false, "code": "<code>" }`
where the code is one of `bad_request`, `unauthorized`, `disabled`, `config`,
`recipient_not_allowed`, `rate_limited`, `quota`, `send_failed`. No answer echoes
the recipient, subject, body or token.

**Why the token is in the URL as well as the header:** Google's web-app event
object exposes `queryString`, `parameter` and `postData`, but **not** inbound
request headers ([Apps Script web apps](https://developers.google.com/apps-script/guides/web),
and Google issue 67764685 asking for headers). The Worker still sends
`X-Relay-Token` as designed, and also puts the token in the query string, because
that is the only channel `doPost` can read. Treat the deployment URL as sensitive
for exactly that reason.

## Owner setup

1. Sign in to the **company Workspace account**, open
   [script.google.com](https://script.google.com), and create a new project.
2. Create two files in the project — `Code.gs` and `relay-core.js` — and paste
   the contents of the files from this folder. Keep the names as they are.
3. **Project Settings → Script Properties → Add script property.** All values
   are generated or decided by you; none belongs in a file or a chat message.

   | Property | Value |
   |---|---|
   | `RELAY_TOKEN` | a long random string, **at least 32 characters** |
   | `RELAY_ENABLED` | exactly `true` (any other value stops the relay) |
   | `ALLOWED_RECIPIENT_DOMAINS` | comma-separated lowercase domains, for example `company.co.th,gmail.com` |
   | `RELAY_MAX_PER_MINUTE` | optional; defaults to 30 when unset |
   | `RELAY_MAX_PER_DAY` | optional; defaults to 300 when unset |

   The allowlist fails closed: if it is missing or empty, **every** request is
   refused with `config`. Never list a domain you do not intend to receive mail.
4. **Deploy → New deployment → Web app**, with:
   - **Execute as:** Me
   - **Who has access:** Anyone

   "Anyone" is required because the Worker calls the URL without a Google
   sign-in; a restricted deployment would answer with a Google login page
   instead of JSON. The token, the recipient allowlist and the kill switch are
   what protect the endpoint, not Google's access setting. Copy the URL that
   ends in `/exec` and treat it as sensitive.
5. On the Worker side, set two secrets (values never go in `wrangler.toml` or any
   other file):

   ```
   cd worker
   npx wrangler secret put APPS_SCRIPT_URL
   npx wrangler secret put MAIL_RELAY_SECRET
   ```

   `APPS_SCRIPT_URL` is the `/exec` URL from step 4. `MAIL_RELAY_SECRET` is the
   **same value** as `RELAY_TOKEN` from step 3.
6. Test from your own machine, sending to an address you control on an allowed
   domain (replace every `<...>` placeholder):

   ```bash
   curl -sS -X POST "<APPS_SCRIPT_URL>?token=<RELAY_TOKEN>" \
     -H "Content-Type: application/json" \
     -H "X-Relay-Token: <RELAY_TOKEN>" \
     --data '{"to":"<your-own-address>","subject":"HR Hub test","text":"test message"}'
   ```

   Expected answer: `{"ok":true}`. `{"ok":false,"code":"unauthorized"}` means the
   two token values differ or the token is shorter than 32 characters;
   `{"ok":false,"code":"config"}` means the allowlist is missing;
   `{"ok":false,"code":"disabled"}` means `RELAY_ENABLED` is not `true`.

## Turning the relay off

Set `RELAY_ENABLED` to `false` (or change it to anything other than `true`).
This takes effect immediately — no redeploy and no new URL. Every request then
answers `{"ok":false,"code":"disabled"}`.

## Rotating the token

1. Generate a new random value of at least 32 characters.
2. Update `RELAY_TOKEN` in Script Properties.
3. In the **same minute**, update the Worker secret: `npx wrangler secret put MAIL_RELAY_SECRET`.

The old token stops working immediately after step 2, so a short gap of
`unauthorized` answers between the two steps is expected — never leave it for
later.

## Old deployments

Every **new** Web app deployment creates a **new URL**, and older deployments
keep answering on their old URLs. If you ever redeploy, open
**Deploy → Manage deployments** and archive (or delete) the old versions so a
previous URL cannot be used. Changing `Code.gs` needs
**Manage deployments → Edit → New version**, which keeps the same `/exec` URL and
therefore the same Worker secret.

## Reviewing what happened

- **Executions** (left sidebar) lists recent runs with start time, duration and
  status. Failed runs show the error type; the script itself never logs a
  recipient, subject, body, token or URL, so execution logs contain no message
  content and no codes beyond what the response already returned.
- A spike of `unauthorized`, `recipient_not_allowed` or `rate_limited` answers
  in the Worker's own logs means someone is using the URL without the token, is
  trying a foreign recipient, or is sending too fast — treat that as a signal to
  rotate the token and check the allowlist.
- Google's **Executions** view is the place to confirm the relay is actually
  being called; the Worker's response code is the place to see why a call failed.

## Safety notes

- **Never** paste the `/exec` URL together with a token into chat, a ticket, a
  document, a screenshot or a commit. In this repository, use placeholders only.
- Keep `RELAY_TOKEN` out of source control: set it in Script Properties only.
- The Workspace daily sending quota is enforced by Google; check the current
  figure in Google's own documentation ("Workspace sending limits") — it differs
  by account type and changes over time. The script keeps a 100-message safety
  margin below the reported allowance and refuses with `quota` rather than
  failing mid-send.

## Tests

```
cd mail-relay && npm test
```

The tests import `relay-core.js` directly and never call Apps Script: no email is
sent and no Google account is needed.
