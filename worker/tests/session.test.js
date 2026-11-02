import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createDb } from "../src/db.js";
import {
  allowedLoginTypesFor,
  createSession,
  landingPathFor,
  readSession,
} from "../src/session.js";
import { requireRole } from "../src/require-role.js";

// Fake project values. Not real credentials.
const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};
const BASE = "https://fake-project.supabase.co/rest/v1";

const TOKEN = "test-session-token";
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const EMPLOYEE_ID = "emp-1";
const SESSION_ID = "session-1";

// Frozen clock so the PostgREST query strings are exact.
const NOW_MS = Date.parse("2026-01-01T09:00:00.000Z");
const NOW_ISO = "2026-01-01T09:00:00.000Z";
const NOW_ENC = encodeURIComponent(NOW_ISO);

function freeze(t) {
  t.mock.timers.enable({ apis: ["Date"], now: NOW_MS });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function sessionRow(overrides = {}) {
  return {
    id: SESSION_ID,
    employee_id: EMPLOYEE_ID,
    login_role: "employee",
    last_active_at: NOW_ISO,
    expires_at: "2026-01-01T21:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

/** Fake backend for a full employee session read. */
function sessionFlowHandler({ loginRole = "employee", employee = { id: EMPLOYEE_ID, is_active: true }, pending = null, admins = {} } = {}) {
  return ({ url, init }) => {
    if ((init.method ?? "GET") === "PATCH") return emptyResponse();
    const table = tableOf(url);
    if (table === "auth_sessions") return jsonResponse([sessionRow({ login_role: loginRole })]);
    if (table === "employees") return jsonResponse([employee]);
    if (table === "leave_requests") return jsonResponse(pending ? [{ id: "leave-1" }] : []);
    if (table === "hr_admins" || table === "meeting_admins" || table === "system_admins") {
      return jsonResponse(admins[table] ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    return jsonResponse([]);
  };
}

// --- readSession: each step ------------------------------------------------

test("readSession: no token returns { ok: false } without a request", async (t) => {
  const fake = installFetch(() => jsonResponse([]));
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, ""), { ok: false });
  assert.deepEqual(await readSession(ENV, null), { ok: false });
  assert.equal(fake.calls.length, 0);
});

test("readSession: unknown token returns { ok: false }", async (t) => {
  freeze(t);
  const fake = installFetch(() => jsonResponse([]));
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), { ok: false });
  assert.equal(fake.calls.length, 1);
  assert.equal(
    fake.calls[0].url,
    `${BASE}/auth_sessions?select=*&token_hash=eq.${TOKEN_HASH}&revoked_at=is.null&expires_at=gt.${NOW_ENC}&limit=1`
  );
  assert.equal(fake.calls[0].init.method, "GET");
  // single uses limit=1, never the vnd.pgrst.object Accept header.
  assert.equal(fake.calls[0].init.headers.Accept, undefined);
});

test("readSession: idle session is revoked and rejected", async (t) => {
  freeze(t);
  const fake = installFetch(({ init }) =>
    (init.method ?? "GET") === "GET"
      ? jsonResponse([sessionRow({ last_active_at: "2026-01-01T08:44:59.000Z" })])
      : emptyResponse()
  );
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), { ok: false });
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].init.method, "PATCH");
  assert.equal(
    fake.calls[1].url,
    `${BASE}/auth_sessions?id=eq.${SESSION_ID}&revoked_at=is.null`
  );
  assert.deepEqual(JSON.parse(fake.calls[1].init.body), { revoked_at: NOW_ISO });
});

test("readSession: inactive employee is revoked and rejected", async (t) => {
  freeze(t);
  const fake = installFetch(({ url, init }) => {
    if ((init.method ?? "GET") === "PATCH") return emptyResponse();
    const table = tableOf(url);
    if (table === "auth_sessions") return jsonResponse([sessionRow()]);
    if (table === "employees") return jsonResponse([{ id: EMPLOYEE_ID, is_active: false }]);
    return jsonResponse([]);
  });
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), { ok: false });
  assert.equal(fake.calls.length, 3);
  assert.equal(
    fake.calls[1].url,
    `${BASE}/employees?select=*&id=eq.${EMPLOYEE_ID}&limit=1`
  );
  assert.equal(fake.calls[2].init.method, "PATCH");
  assert.deepEqual(JSON.parse(fake.calls[2].init.body), { revoked_at: NOW_ISO });
});

test("readSession: role that is no longer allowed is revoked and rejected", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler({ loginRole: "hr" }));
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), { ok: false });
  assert.equal(fake.calls.length, 6);
  assert.equal(
    fake.calls[2].url,
    `${BASE}/hr_admins?select=employee_id&employee_id=eq.${EMPLOYEE_ID}&limit=1`
  );
  assert.equal(
    fake.calls[3].url,
    `${BASE}/meeting_admins?select=employee_id&employee_id=eq.${EMPLOYEE_ID}&limit=1`
  );
  assert.equal(
    fake.calls[4].url,
    `${BASE}/system_admins?select=employee_id&employee_id=eq.${EMPLOYEE_ID}&limit=1`
  );
  assert.equal(fake.calls[5].init.method, "PATCH");
  assert.deepEqual(JSON.parse(fake.calls[5].init.body), { revoked_at: NOW_ISO });
});

test("readSession: success touches last_active_at", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler({ loginRole: "hr", admins: { hr_admins: true } }));
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), {
    ok: true,
    employeeId: EMPLOYEE_ID,
    role: "hr",
    redirectTo: "/hr/employees/import",
  });
  assert.equal(fake.calls.length, 4);
  assert.equal(fake.calls[3].init.method, "PATCH");
  assert.equal(
    fake.calls[3].url,
    `${BASE}/auth_sessions?id=eq.${SESSION_ID}&revoked_at=is.null`
  );
  assert.deepEqual(JSON.parse(fake.calls[3].init.body), { last_active_at: NOW_ISO });
});

test("readSession: employee with a pending leave is routed to approvals", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler({ pending: { id: "leave-1" } }));
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), {
    ok: true,
    employeeId: EMPLOYEE_ID,
    role: "employee",
    redirectTo: "/pending?to=%2Fleave%2Fapprovals",
  });
  assert.equal(fake.calls.length, 7);
  assert.equal(
    fake.calls[6].url,
    `${BASE}/leave_requests?select=id&approver_id=eq.${EMPLOYEE_ID}&status=eq.pending&limit=1`
  );
});

test("readSession: employee without pending leave is routed to /leave", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler());
  t.after(() => fake.restore());

  const result = await readSession(ENV, TOKEN);
  assert.equal(result.ok, true);
  assert.equal(result.redirectTo, "/pending?to=%2Fleave");
});

test("readSession: thrown errors are swallowed into { ok: false }", async (t) => {
  freeze(t);
  const fake = installFetch(() => {
    throw new Error("network unavailable");
  });
  t.after(() => fake.restore());

  assert.deepEqual(await readSession(ENV, TOKEN), { ok: false });
});

// --- allowed login types ---------------------------------------------------

test("allowedLoginTypesFor: hr_admins wins over meeting_admins", async (t) => {
  const fake = installFetch(({ url }) =>
    tableOf(url) === "hr_admins"
      ? jsonResponse([{ employee_id: EMPLOYEE_ID }])
      : jsonResponse([{ employee_id: EMPLOYEE_ID }])
  );
  t.after(() => fake.restore());

  assert.deepEqual(await allowedLoginTypesFor(ENV, EMPLOYEE_ID), ["hr"]);
  assert.equal(fake.calls.length, 1);
});

test("allowedLoginTypesFor: maps each table and falls back to employee", async (t) => {
  const cases = [
    ["hr_admins", "hr"],
    ["meeting_admins", "meeting_controller"],
    ["system_admins", "system_admin"],
  ];

  for (const [adminTable, expected] of cases) {
    const fake = installFetch(({ url }) =>
      jsonResponse(tableOf(url) === adminTable ? [{ employee_id: EMPLOYEE_ID }] : [])
    );
    try {
      assert.deepEqual(await allowedLoginTypesFor(ENV, EMPLOYEE_ID), [expected]);
    } finally {
      fake.restore();
    }
  }

  const fake = installFetch(() => jsonResponse([]));
  try {
    assert.deepEqual(await allowedLoginTypesFor(ENV, EMPLOYEE_ID), ["employee"]);
  } finally {
    fake.restore();
  }
});

// --- landing paths ---------------------------------------------------------

test("landingPathFor handles every role and its aliases", () => {
  assert.equal(landingPathFor("employee", true), "/leave/approvals");
  assert.equal(landingPathFor("employee", false), "/leave");
  assert.equal(landingPathFor("hr", false), "/hr/employees/import");
  assert.equal(landingPathFor("meeting_controller", false), "/meeting/controller");
  assert.equal(landingPathFor("controller", false), "/meeting/controller");
  assert.equal(landingPathFor("system_admin", false), "/admin");
  assert.equal(landingPathFor("system", false), "/admin");
  assert.equal(landingPathFor("unknown", false), "/login");
});
test("landingPathFor: hr lands on the employee import page, other roles unchanged", () => {
  assert.equal(landingPathFor("hr", false), "/hr/employees/import");
  assert.equal(landingPathFor("hr", true), "/hr/employees/import");
  assert.equal(landingPathFor("employee", false), "/leave");
  assert.equal(landingPathFor("employee", true), "/leave/approvals");
  assert.equal(landingPathFor("meeting_controller", false), "/meeting/controller");
  assert.equal(landingPathFor("system_admin", false), "/admin");
});

// --- createSession ---------------------------------------------------------

test("createSession stores the SHA-256 of the token, never the token", async (t) => {
  freeze(t);
  const fake = installFetch(() => jsonResponse([], 201));
  t.after(() => fake.restore());

  const token = await createSession(ENV, EMPLOYEE_ID, "employee");
  assert.equal(fake.calls.length, 1);

  const [call] = fake.calls;
  assert.equal(call.url, `${BASE}/auth_sessions`);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, {
    apikey: "fake-service-role-key",
    Authorization: "Bearer fake-service-role-key",
    "Content-Type": "application/json",
  });

  const body = JSON.parse(call.init.body);
  assert.equal(body.token_hash, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.equal(body.employee_id, EMPLOYEE_ID);
  assert.equal(body.login_role, "employee");
  assert.equal(body.created_at, NOW_ISO);
  assert.equal(body.last_active_at, NOW_ISO);
  assert.equal(body.expires_at, "2026-01-01T21:00:00.000Z");
  assert.equal("token" in body, false);
  assert.equal(call.init.body.includes(token), false);
});

test("createSession returns a 43-character base64url token", async (t) => {
  freeze(t);
  const fake = installFetch(() => jsonResponse([], 201));
  t.after(() => fake.restore());

  const token = await createSession(ENV, EMPLOYEE_ID, "employee");
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!token.includes("+"));
  assert.ok(!token.includes("/"));
  assert.ok(!token.includes("="));
});

// --- db error handling -----------------------------------------------------

test("db insert reports only the error code, not the response body", async (t) => {
  const fake = installFetch(() => jsonResponse({ code: "23505", detail: "upstream detail" }, 409));
  t.after(() => fake.restore());

  const result = await createDb(ENV).insert("auth_sessions", { token_hash: "fake" });
  assert.deepEqual(result, { error: { code: "23505" } });
  assert.equal(JSON.stringify(result).includes("upstream detail"), false);
});

// --- requireRole -----------------------------------------------------------

test("requireRole returns 401 without a valid session", async (t) => {
  const fake = installFetch(() => jsonResponse([]));
  t.after(() => fake.restore());

  const request = new Request("https://app.test/leave");
  assert.deepEqual(await requireRole(ENV, request, ["hr"]), {
    status: 401,
    message: "ไม่ได้เข้าสู่ระบบ",
  });
  assert.equal(fake.calls.length, 0);
});

test("requireRole returns 403 when the role is not allowed", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler());
  t.after(() => fake.restore());

  const request = new Request("https://app.test/leave", {
    headers: { Cookie: `hr_session=${TOKEN}` },
  });
  assert.deepEqual(await requireRole(ENV, request, ["hr"]), {
    status: 403,
    message: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  });
});

test("requireRole returns the session when the role is allowed", async (t) => {
  freeze(t);
  const fake = installFetch(sessionFlowHandler());
  t.after(() => fake.restore());

  const request = new Request("https://app.test/leave", {
    headers: { Cookie: `theme=dark; hr_session=${TOKEN}` },
  });
  const result = await requireRole(ENV, request, ["employee"]);

  assert.equal(result.ok, true);
  assert.equal(result.session.employeeId, EMPLOYEE_ID);
  assert.equal(result.session.role, "employee");
});
