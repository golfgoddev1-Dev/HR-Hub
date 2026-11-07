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
| `Code.gs` | `doPost(e)`: parse, validate, token, quota, `MailApp.sendEmail` |
| `relay-core.js` | Pure logic (no Apps Script services); used by `Code.gs` and by the tests |
| `tests/relay-core.test.js` | `node:test` tests for the pure logic |

## Request the Worker sends

```
POST <APPS_SCRIPT_URL>?token=<RELAY_TOKEN>
Content-Type: application/json
X-Relay-Token: <RELAY_TOKEN>

{ "to": "<one address>", "subject": "<text>", "text": "<plain text>" }
```

Answers are JSON only: `{ "ok": true }` or `{ "ok": false, "code": "bad_request" | "unauthorized" | "quota" | "send_failed" }`.
Nothing in an answer echoes the recipient, subject, body or token.

**Why the token is in the URL as well as the header:** Google's web-app event
object exposes `queryString`, `parameter` and `postData`, but **not** inbound
request headers ([Apps Script web apps](https://developers.google.com/apps-script/guides/web),
and Google issue 67764685 asking for headers). The Worker still sends
`X-Relay-Token` as designed, and also appends the token as a query parameter,
because that is the only channel `doPost` can actually read. Treat the deployment
URL as sensitive for that reason.

## Owner setup

1. Sign in to the **company Workspace account**, open
   [script.google.com](https://script.google.com), and create a new project.
2. Create two files in the project — `Code.gs` and `relay-core.js` — and paste
   the contents of the files from this folder. Keep the names as they are.
3. **Project Settings → Script Properties → Add script property**: name
   `RELAY_TOKEN`, value a long random string you generate yourself. Never commit
   it, never paste it into chat, and do not reuse a password.
4. **Deploy → New deployment → Web app**, with:
   - **Execute as:** Me
   - **Who has access:** Anyone
   Then copy the URL that ends in `/exec`. Treat that URL as sensitive.

   Deploying with "Anyone" is what allows the Worker to call it without a Google
   sign-in; the token is what actually protects it.
5. On the Worker side, set two secrets (values are never written to
   `wrangler.toml` or to any file):

   ```
   cd worker
   npx wrangler secret put APPS_SCRIPT_URL
   npx wrangler secret put MAIL_RELAY_SECRET
   ```

   `APPS_SCRIPT_URL` is the `/exec` URL from step 4. `MAIL_RELAY_SECRET` is the
   **same value** as `RELAY_TOKEN` in step 3.
6. Test from your own machine, sending to an address you control (replace every
   `<...>` placeholder):

   ```bash
   curl -sS -X POST "<APPS_SCRIPT_URL>?token=<RELAY_TOKEN>" \
     -H "Content-Type: application/json" \
     -H "X-Relay-Token: <RELAY_TOKEN>" \
     --data '{"to":"<your-own-address>","subject":"HR Hub test","text":"test message"}'
   ```

   Expected answer: `{"ok":true}`. `{"ok":false,"code":"unauthorized"}` means the
   two token values differ.

## Rotation and maintenance

- **Rotate the token:** change `RELAY_TOKEN` in Script Properties, then set
  `MAIL_RELAY_SECRET` on the Worker to the same new value. Both together; a
  single-sided change refuses every send with `unauthorized`.
- **Daily sending quota:** Google limits how much mail a Workspace account can
  send per day. Check the current figure in Google's own documentation
  ("Workspace sending limits") before relying on a number — the limit differs by
  account type and changes over time. The script refuses with `quota` instead of
  failing when the remaining allowance is at or below the built-in safety margin.
- **After editing `Code.gs`:** an existing deployment keeps running the old
  version. Use **Deploy → Manage deployments → Edit → New version**, and keep the
  same `/exec` URL so the Worker secret does not have to change.

## Tests

```
cd mail-relay && npm test
```

The tests import `relay-core.js` directly and never call Apps Script: no email is
sent and no Google account is needed.
