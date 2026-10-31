// Local-only end-to-end harness for the Phase 1 auth API.
// It refuses to run unless reports/test-accounts.txt lists exactly EM001.
// EM001's test national ID comes from the owner-supplied .test-account.env;
// it is never decrypted, printed, or logged. Secrets stay in memory only.
// Run from worker/ with the local Worker listening on 127.0.0.1:8787.

import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const BASE = "http://127.0.0.1:8787";
const EMPLOYEE_CODE = "EM001";
const results = [];
let failure = false;

function expect(label, condition, detail) {
  results.push({ label: label + (condition ? " [PASS]" : " [FAIL]"), ...detail });
  if (!condition) failure = true;
}

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const local = loadEnv(".dev.vars");
const { validatePin } = await import(pathToFileURL(resolve("src/pin-rules.js")).href);

const allowedAccounts = fs
  .readFileSync("reports/test-accounts.txt", "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
if (allowedAccounts.length !== 1 || allowedAccounts[0] !== EMPLOYEE_CODE) {
  throw new Error("test-account guard refused the run");
}

const dbHeaders = {
  apikey: local.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: "Bearer " + local.SUPABASE_SERVICE_ROLE_KEY,
};
const restBase = local.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";

async function rest(path, init = {}) {
  const res = await fetch(restBase + path, {
    ...init,
    headers: { ...dbHeaders, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error("db request failed status=" + res.status);
  return text ? JSON.parse(text) : null;
}

const employees = await rest(
  "/employees?select=id,employee_code,is_active&employee_code=eq." + EMPLOYEE_CODE + "&limit=1"
);
const employee = employees[0];
if (!employee || employee.employee_code !== EMPLOYEE_CODE) throw new Error("test employee missing");
if (employee.is_active !== true) throw new Error("test employee inactive");
const employeeId = employee.id;

const allowedRoles = [];
for (const [table, role] of [
  ["hr_admins", "hr"],
  ["meeting_admins", "controller"],
  ["system_admins", "system"],
]) {
  const rows = await rest(
    "/" + table + "?select=employee_id&employee_id=eq." + encodeURIComponent(employeeId) + "&limit=1"
  );
  if (rows.length) allowedRoles.push(role);
}
const roleList = allowedRoles.length ? allowedRoles : ["employee"];
if (roleList.length !== 1 || roleList[0] !== "employee") {
  results.push({ label: "precondition: EM001 must be a plain employee [FAIL]", roles: roleList });
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
}

const credentials = await rest(
  "/employee_credentials?select=national_id_hash&employee_id=eq." +
    encodeURIComponent(employeeId) +
    "&limit=1"
);
if (!credentials.length) throw new Error("test credentials missing");

// Owner-supplied test ID. It is read into memory only and never printed.
const TEST_ACCOUNT_FILE = ".test-account.env";
if (!fs.existsSync(TEST_ACCOUNT_FILE)) {
  throw new Error("missing .test-account.env");
}
const testAccountEnv = loadEnv(TEST_ACCOUNT_FILE);
const nationalId = testAccountEnv.TEST_EM001_NATIONAL_ID;
if (typeof nationalId !== "string" || !/^\d{13}$/.test(nationalId)) {
  throw new Error("invalid TEST_EM001_NATIONAL_ID");
}
const nationalIdHash = crypto
  .createHmac("sha256", local.NATIONAL_ID_PEPPER)
  .update(nationalId, "utf8")
  .digest("hex");
if (nationalIdHash !== String(credentials[0].national_id_hash).toLowerCase()) {
  throw new Error("test national ID does not match stored hash");
}

function issueResetCode() {
  const run = spawnSync("npm", ["run", "issue:reset-code", "--", EMPLOYEE_CODE], {
    cwd: "..",
    encoding: "utf8",
    shell: true,
    timeout: 90000,
  });
  if (run.status !== 0) throw new Error("issue:reset-code failed status=" + String(run.status));
  const match = /รหัส:\s*(\d{8})/.exec(run.stdout || "");
  if (!match) throw new Error("issued reset code missing from script output");
  return match[1];
}

function randomPin() {
  for (let i = 0; i < 200; i += 1) {
    const pin = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    if (validatePin(pin).ok) return pin;
  }
  throw new Error("could not generate a valid test PIN");
}

const pin = randomPin();
const wrongPin = (() => {
  for (;;) {
    const candidate = randomPin();
    if (candidate !== pin) return candidate;
  }
})();

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie")]
        : [];
  return {
    status: res.status,
    json,
    setCookies,
    cacheControl: res.headers.get("cache-control"),
  };
}

function cookieFrom(setCookies) {
  for (const value of setCookies) {
    const match = /hr_session=([^;]*)/.exec(value);
    if (match && match[1]) return "hr_session=" + match[1];
  }
  return null;
}

function cookieAttrs(setCookies) {
  const value = setCookies.find((s) => /^hr_session=/.test(s)) || "";
  return {
    httpOnly: /HttpOnly/i.test(value),
    sameSiteStrict: /SameSite=Strict/i.test(value),
    pathRoot: /Path=\//.test(value),
    maxAge: (/(?:^|;\s*)Max-Age=(\d+)/i.exec(value) || [])[1] ?? null,
    secure: /;\s*Secure(?:;|$)/i.test(value),
  };
}

function record(label, res, extra = {}) {
  const body = res.json || {};
  results.push({
    label,
    status: res.status,
    ok: body.ok,
    message: body.message ?? null,
    ...extra,
  });
}

async function credentialState() {
  const rows = await rest(
    "/employee_credentials?select=failed_attempts,locked_until&employee_id=eq." +
      encodeURIComponent(employeeId) +
      "&limit=1"
  );
  return rows[0];
}

async function guardedClear(label) {
  const check = await rest(
    "/employees?select=id&employee_code=eq." + EMPLOYEE_CODE + "&limit=1"
  );
  if (!check.length || check[0].id !== employeeId) throw new Error("write guard refused");
  const patched = await rest(
    "/employee_credentials?employee_id=eq." + encodeURIComponent(employeeId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      }),
    }
  );
  const row = Array.isArray(patched) ? patched[0] : patched;
  results.push({
    label,
    dbWrite: true,
    attempts: row ? row.failed_attempts : null,
    lockCleared: row ? row.locked_until === null : false,
  });
  if (!row || row.failed_attempts !== 0 || row.locked_until !== null) failure = true;
}

// 1. Issue a code and set the PIN.
const code1 = issueResetCode();
let res = await call("POST", "/api/auth/set-pin", {
  body: { nationalId, code: code1, pin, pinConfirm: pin },
});
record("set-pin with issued code", res);
expect("set-pin expected 200", res.status === 200, { status: res.status });

// 2. Correct login.
res = await call("POST", "/api/auth/login", {
  body: { loginType: "employee", nationalId, pin },
});
record("login employee correct PIN", res, {
  redirectToPresent: typeof (res.json || {}).redirectTo === "string",
  cookie: cookieAttrs(res.setCookies),
});
expect("login expected 200", res.status === 200, { status: res.status });

// 3. Five wrong PINs.
const wrongStatuses = [];
for (let attempt = 1; attempt <= 5; attempt += 1) {
  res = await call("POST", "/api/auth/login", {
    body: { loginType: "employee", nationalId, pin: wrongPin },
  });
  wrongStatuses.push(res.status);
  if (attempt === 5) {
    record("login fifth wrong PIN", res, {
      lockedUntilPresent: typeof (res.json || {}).lockedUntil === "string",
    });
  }
}
results.push({ label: "login wrong PIN statuses", statuses: wrongStatuses });
expect(
  "wrong PINs expected 401,401,401,401,423",
  JSON.stringify(wrongStatuses) === JSON.stringify([401, 401, 401, 401, 423]),
  { statuses: wrongStatuses }
);

// 4. Correct PIN while locked.
res = await call("POST", "/api/auth/login", {
  body: { loginType: "employee", nationalId, pin },
});
record("login correct PIN while locked", res, {
  lockedUntilPresent: typeof (res.json || {}).lockedUntil === "string",
});
expect("locked login expected 423", res.status === 423, { status: res.status });

// 5. Clear the lock through the guarded write.
await guardedClear("guarded clear: lock after five failures");

// 6. Correct PIN with a disallowed role.
const wrongRole = ["hr", "controller", "system"].find((r) => !roleList.includes(r));
res = await call("POST", "/api/auth/login", {
  body: { loginType: wrongRole, nationalId, pin },
});
const afterWrongRole = await credentialState();
record("login correct PIN with disallowed role", res, {
  loginType: wrongRole,
  attempts: afterWrongRole.failed_attempts,
});
expect("wrong role expected 401", res.status === 401, { status: res.status });
expect("wrong role counted as one failure", afterWrongRole.failed_attempts === 1, {
  attempts: afterWrongRole.failed_attempts,
});

// 7. Clear counters, then log in for real.
await guardedClear("guarded clear: counters before employee login");
res = await call("POST", "/api/auth/login", {
  body: { loginType: "employee", nationalId, pin },
});
record("login employee after clear", res, {
  redirectToPresent: typeof (res.json || {}).redirectTo === "string",
});
expect("login after clear expected 200", res.status === 200, { status: res.status });
const cookie2 = cookieFrom(res.setCookies);

// 8. /me.
res = await call("GET", "/api/auth/me", { cookie: cookie2 });
record("me with session cookie", res, {
  role: (res.json || {}).role,
  redirectToPresent: typeof (res.json || {}).redirectTo === "string",
  exposesEmployeeId: Object.prototype.hasOwnProperty.call(res.json || {}, "employeeId"),
});
expect("me expected 200", res.status === 200, { status: res.status });

// 9. Logout, then /me again.
res = await call("POST", "/api/auth/logout", { cookie: cookie2 });
record("logout", res, {
  cookie: cookieAttrs(res.setCookies),
  noStore: /no-store/i.test(res.cacheControl || ""),
});
expect("logout expected 200", res.status === 200, { status: res.status });
expect(
  "logout clears cookie with Max-Age=0",
  cookieAttrs(res.setCookies).maxAge === "0",
  { cookie: cookieAttrs(res.setCookies) }
);

res = await call("GET", "/api/auth/me", { cookie: cookie2 });
record("me after logout", res);
expect("me after logout expected 401", res.status === 401, { status: res.status });

// 10. Fresh code, then a wrong code: 401 and one more attempt.
const code2 = issueResetCode();
let wrongCode = String(crypto.randomInt(0, 100000000)).padStart(8, "0");
while (wrongCode === code2) {
  wrongCode = String(crypto.randomInt(0, 100000000)).padStart(8, "0");
}
const pin2 = randomPin();
const codeRowPath =
  "/pin_reset_codes?select=attempts&employee_id=eq." +
  encodeURIComponent(employeeId) +
  "&used_at=is.null&order=created_at.desc&limit=1";
const beforeRows = await rest(codeRowPath);
res = await call("POST", "/api/auth/set-pin", {
  body: { nationalId, code: wrongCode, pin: pin2, pinConfirm: pin2 },
});
const afterRows = await rest(codeRowPath);
record("set-pin with wrong reset code", res, {
  attemptsBefore: beforeRows[0] ? beforeRows[0].attempts : null,
});
expect("wrong code expected 401", res.status === 401, { status: res.status });
const beforeAttempts = beforeRows[0] ? beforeRows[0].attempts : null;
const afterAttempts = afterRows[0] ? afterRows[0].attempts : null;
expect(
  "wrong code increments attempts by one",
  beforeAttempts !== null && afterAttempts === beforeAttempts + 1,
  { attemptsBefore: beforeAttempts, attemptsAfter: afterAttempts }
);

console.log(JSON.stringify(results, null, 2));
console.log("E2E_RESULT=" + (failure ? "FAIL" : "PASS"));
process.exitCode = failure ? 1 : 0;
