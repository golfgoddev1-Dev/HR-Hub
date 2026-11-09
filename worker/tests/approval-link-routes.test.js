// Public approval-by-email routes. The database is a fake fetch: nothing leaves
// the process, and no relay or push service is called (the relay is simply
// unconfigured here, which the queue treats as a permanent config failure).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { hashApprovalToken } from "../src/approval-token.js";

const BASE_ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  APP_PUBLIC_URL: "https://hr.example.test",
};

const REQUESTER_ID = "11111111-1111-4111-8111-111111111111";
const APPROVER_ID = "22222222-2222-4222-8222-222222222222";
const HR_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const TYPE_ID = "55555555-5555-4555-8555-555555555555";
const DEPT_ID = "66666666-6666-4666-8666-666666666666";

const HR_TOKEN = "h".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const RAW_TOKEN = "T".repeat(43);
const OTHER_TOKEN = "U".repeat(43);

const APPROVER_EMAIL = "approver@example.test";
const REQUESTER_EMAIL = "requester@example.test";
const EMPLOYEE_NAME = "สมชาย ใจดี";
const REASON_TEXT = "ไปธุระที่ต่างจังหวัด";
const CERTIFICATE_PATH = "private/2026/certificate.pdf";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function makeLimiter({ success = true } = {}) {
  const calls = [];
  return {
    calls,
    idFromName(name) {
      return name;
    },
    get(id) {
      return {
        async fetch() {
          calls.push(id);
          return jsonResponse({ success });
        },
      };
    },
  };
}

function createEnv({ ipSuccess = true, tokenSuccess = true } = {}) {
  return {
    ...BASE_ENV,
    RL_SUBMIT_IP: makeLimiter({ success: ipSuccess }),
    RL_SUBMIT_TOKEN: makeLimiter({ success: tokenSuccess }),
  };
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict"].includes(key)) continue;

    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("gt.")) {
      if (!(String(row[key] ?? "") > value.slice(3))) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",");
      if (!list.includes(String(row[key] ?? ""))) return false;
      continue;
    }
  }
  return true;
}

function selectColumns(row, select) {
  if (!select || select === "*") return row;
  const keys = select.split(",").map((value) => value.trim()).filter(Boolean);
  const picked = {};
  for (const key of keys) picked[key] = row[key];
  return picked;
}

async function session(token, employeeId, role) {
  const now = new Date();
  return {
    id: `session-${role}`,
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };
}

async function buildState({ requestStatus = "pending", grants = true } = {}) {
  const now = new Date();

  return {
    auth_sessions: [
      await session(HR_TOKEN, HR_ID, "hr"),
      await session(EMPLOYEE_TOKEN, REQUESTER_ID, "employee"),
    ],
    employees: [
      {
        id: APPROVER_ID,
        employee_code: "EMP-002",
        name_prefix: "นาย",
        full_name: "ผู้อนุมัติ ทดสอบ",
        email: APPROVER_EMAIL,
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: REQUESTER_ID,
        employee_code: "EMP-001",
        name_prefix: "นาย",
        full_name: EMPLOYEE_NAME,
        email: REQUESTER_EMAIL,
        department_id: DEPT_ID,
        is_active: true,
      },
      {
        id: HR_ID,
        employee_code: "HR-001",
        name_prefix: "นาง",
        full_name: "เจ้าหน้าที่ HR",
        email: "hr@example.test",
        department_id: DEPT_ID,
        is_active: true,
      },
    ],
    employee_credentials: [],
    hr_admins: [{ employee_id: HR_ID }],
    meeting_admins: [],
    system_admins: [],
    employee_approvers: grants
      ? [
          {
            id: "ea-1",
            employee_id: REQUESTER_ID,
            approver_id: APPROVER_ID,
            priority: 1,
            is_active: true,
          },
        ]
      : [],
    department_approvers: [],
    leave_requests: [
      {
        id: REQUEST_ID,
        request_code: "LV-20261109-001",
        employee_id: REQUESTER_ID,
        approver_id: APPROVER_ID,
        leave_type_id: TYPE_ID,
        other_type_detail: null,
        start_date: "2026-11-10",
        end_date: "2026-11-11",
        days: 2,
        return_date: "2026-11-12",
        return_time: "08:00",
        status: requestStatus,
        ot_option: "ไม่ OT",
        shift_option_code: "DAY_FULL",
        shift_end_override: null,
        reason: REASON_TEXT,
        has_medical_certificate: true,
        medical_certificate_url: CERTIFICATE_PATH,
        decision_note: null,
        decided_at: null,
        created_at: "2026-11-09T02:00:00.000Z",
      },
    ],
    leave_types: [{ id: TYPE_ID, name: "ลากิจ", is_active: true }],
    departments: [{ id: DEPT_ID, name: "ฝ่ายบุคคล" }],
    approval_tokens: [
      {
        id: "token-1",
        leave_request_id: REQUEST_ID,
        approver_employee_id: APPROVER_ID,
        token_hash: await hashApprovalToken(RAW_TOKEN),
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
        used_at: null,
        invalidated_at: null,
        created_by: null,
      },
    ],
    audit_logs: [],
    notification_queue: [],
  };
}

function installFetch(state) {
  const calls = [];
  const original = globalThis.fetch;
  let sequence = 0;

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;
    const prefer = String(init.headers?.Prefer ?? "");
    calls.push({ url, method, table, params: Object.fromEntries(params.entries()) });

    if (method === "GET") {
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      return jsonResponse(rows);
    }

    if (method === "PATCH") {
      const patch = typeof init.body === "string" ? JSON.parse(init.body) : {};
      const rows = (state[table] ?? []).filter((row) => matches(row, params));
      for (const row of rows) Object.assign(row, patch);
      if (!prefer.includes("return=representation")) return emptyResponse(204);
      return jsonResponse(rows.map((row) => selectColumns(row, params.get("select"))));
    }

    if (method === "POST") {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
      const rows = Array.isArray(body) ? body : [body];
      const inserted = [];

      for (const row of rows) {
        sequence += 1;
        const saved = { id: row.id ?? `${table}-${sequence}`, ...row };
        state[table] = state[table] ?? [];
        state[table].push(saved);
        inserted.push(saved);
      }

      if (!prefer.includes("return=representation")) return emptyResponse(201);
      return jsonResponse(Array.isArray(body) ? inserted : inserted[0]);
    }

    return emptyResponse(204);
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function setup(t, options = {}) {
  const state = await buildState(options);
  const fake = installFetch(state);
  t.after(() => fake.restore());
  const env = createEnv(options.envOptions ?? {});
  return { state, fake, env };
}

function call(env, path, { token = null, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Cookie = `hr_session=${token}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return app.request(`https://fake.local${path}`, init, env);
}

function decide(env, body, token = RAW_TOKEN) {
  return call(env, `/api/approve-link/${token}/decision`, { method: "POST", body });
}

function assertPrivateHeaders(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
}

function writes(calls) {
  return calls.filter((entry) => entry.method !== "GET");
}

// --- GET -------------------------------------------------------------------

test("GET with a valid link returns the detail fields and writes nothing", async (t) => {
  const { state, fake, env } = await setup(t);

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assertPrivateHeaders(response);
  assert.equal(body.ok, true);

  assert.equal(body.request.employeeName, `นาย ${EMPLOYEE_NAME}`);
  assert.equal(body.request.employeeCode, "EMP-001");
  assert.equal(body.request.departmentName, "ฝ่ายบุคคล");
  assert.equal(body.request.leaveTypeName, "ลากิจ");
  assert.equal(body.request.otherTypeDetail, null);
  assert.equal(body.request.startDate, "2026-11-10");
  assert.equal(body.request.endDate, "2026-11-11");
  assert.equal(body.request.days, 2);
  assert.equal(body.request.returnDate, "2026-11-12");
  assert.equal(body.request.returnTime, "08:00");
  assert.equal(body.request.shiftCode, "DAY_FULL");
  assert.equal(body.request.otOption, "ไม่ OT");
  assert.equal(body.request.reason, REASON_TEXT);
  assert.equal(body.request.hasMedicalCertificate, true);
  assert.equal(body.request.expiresAt, state.approval_tokens[0].expires_at);

  const text = JSON.stringify(body);
  for (const forbidden of [APPROVER_EMAIL, REQUESTER_EMAIL, CERTIFICATE_PATH, RAW_TOKEN]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }

  // The page is public and read-only: no session read, no write at all.
  assert.equal(fake.calls.some((entry) => entry.table === "auth_sessions"), false);
  assert.deepEqual(writes(fake.calls), []);
  assert.deepEqual(env.RL_SUBMIT_IP.calls, ["approve-link|unknown"]);
});

test("an expired link answers expired and changes nothing", async (t) => {
  const { state, fake, env } = await setup(t);
  state.approval_tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  const body = await response.json();

  assert.equal(response.status, 410);
  assertPrivateHeaders(response);
  assert.deepEqual(body, { ok: false, code: "link_unusable", category: "expired" });
  assert.deepEqual(writes(fake.calls), []);
  assert.equal(state.leave_requests[0].status, "pending");
});

test("a used link answers used and changes nothing", async (t) => {
  const { state, fake, env } = await setup(t);
  state.approval_tokens[0].used_at = new Date().toISOString();

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "link_unusable",
    category: "used",
  });
  assert.deepEqual(writes(fake.calls), []);
});

test("a replaced link answers invalid and changes nothing", async (t) => {
  const { state, fake, env } = await setup(t);
  state.approval_tokens[0].invalidated_at = new Date().toISOString();

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "link_unusable",
    category: "invalid",
  });
  assert.deepEqual(writes(fake.calls), []);
});

test("an unknown token answers invalid without a database write", async (t) => {
  const { fake, env } = await setup(t);

  const response = await call(env, `/api/approve-link/${OTHER_TOKEN}`);
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.deepEqual(body, { ok: false, code: "link_unusable", category: "invalid" });
  assert.deepEqual(writes(fake.calls), []);
});

test("a request already decided in the app answers invalid", async (t) => {
  const { fake, env } = await setup(t, { requestStatus: "approved" });

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "link_unusable",
    category: "invalid",
  });
  assert.deepEqual(writes(fake.calls), []);
});

test("an approver who is no longer responsible answers invalid", async (t) => {
  const { fake, env } = await setup(t, { grants: false });

  const response = await call(env, `/api/approve-link/${RAW_TOKEN}`);
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "link_unusable",
    category: "invalid",
  });
  assert.deepEqual(writes(fake.calls), []);
});

// --- decisions -------------------------------------------------------------

test("approve marks the token used, approves the request and audits channel email", async (t) => {
  const { state, fake, env } = await setup(t);

  const response = await decide(env, { decision: "approve" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assertPrivateHeaders(response);
  assert.deepEqual(body, { ok: true, status: "approved" });

  const token = state.approval_tokens[0];
  assert.equal(typeof token.used_at, "string");
  assert.equal(token.invalidated_at, null);

  const request = state.leave_requests[0];
  assert.equal(request.status, "approved");
  assert.equal(typeof request.decided_at, "string");
  assert.equal(request.decision_note, null);

  const audit = state.audit_logs.find((row) => row.action === "leave_approved");
  assert.ok(audit);
  assert.equal(audit.entity, "leave_request");
  assert.equal(audit.entity_id, REQUEST_ID);
  assert.equal(audit.actor_id, APPROVER_ID);
  assert.deepEqual(JSON.parse(audit.detail), {
    requestCode: "LV-20261109-001",
    channel: "email",
  });

  const queued = state.notification_queue.find((row) => row.kind === "leave_decided");
  assert.ok(queued);
  assert.equal(queued.employee_id, REQUESTER_ID);

  // No session is read on the public decision path either.
  assert.equal(fake.calls.some((entry) => entry.table === "auth_sessions"), false);
  assert.deepEqual(env.RL_SUBMIT_TOKEN.calls.length, 1);
  assert.match(env.RL_SUBMIT_TOKEN.calls[0], /^submit\|[0-9a-f]{64}$/);
  assert.equal(env.RL_SUBMIT_TOKEN.calls[0].includes(RAW_TOKEN), false);
});

test("reject requires a reason and honours the shared 1 to 500 length rule", async (t) => {
  for (const reason of [undefined, "", "   \n ", "ก".repeat(501)]) {
    const { state, env } = await setup(t);
    const response = await decide(env, { decision: "reject", reason });
    const body = await response.json();

    assert.equal(response.status, 400, String(reason));
    assert.equal(
      body.code,
      reason === undefined || reason.trim().length === 0 ? "reason_required" : "reason_too_long"
    );
    assert.equal(state.approval_tokens[0].used_at, null);
    assert.equal(state.leave_requests[0].status, "pending");
    assert.equal(state.audit_logs.length, 0);
  }
});

test("reject with a valid reason is accepted and stores the collapsed note", async (t) => {
  const { state, env } = await setup(t);

  const response = await decide(env, {
    decision: "reject",
    reason: "  ไม่สะดวก   เนื่องจาก  ประชุม ",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, status: "rejected" });

  const request = state.leave_requests[0];
  assert.equal(request.status, "rejected");
  assert.equal(request.decision_note, "ไม่สะดวก เนื่องจาก ประชุม");
  assert.equal(typeof request.decided_at, "string");
  assert.equal(typeof state.approval_tokens[0].used_at, "string");
  assert.ok(state.audit_logs.some((row) => row.action === "leave_rejected"));
});

test("a 500-code-point reason is accepted", async (t) => {
  const { state, env } = await setup(t);
  const reason = "ก".repeat(500);

  const response = await decide(env, { decision: "reject", reason });
  assert.equal(response.status, 200);
  assert.equal(state.leave_requests[0].decision_note, reason);
});

test("the same token cannot decide twice", async (t) => {
  const { state, env } = await setup(t);

  const first = await decide(env, { decision: "approve" });
  assert.equal(first.status, 200);

  const second = await decide(env, { decision: "reject", reason: "เปลี่ยนใจ" });
  assert.equal(second.status, 410);
  assert.deepEqual(await second.json(), {
    ok: false,
    code: "link_unusable",
    category: "used",
  });

  assert.equal(state.leave_requests[0].status, "approved");
  assert.equal(state.audit_logs.length, 1);
  assert.equal(state.notification_queue.length, 1);
});

test("a race between two decisions leaves exactly one winner", async (t) => {
  const { state, env } = await setup(t);

  const [left, right] = await Promise.all([
    decide(env, { decision: "approve" }),
    decide(env, { decision: "approve" }),
  ]);

  assert.deepEqual([left.status, right.status].sort(), [200, 410]);
  assert.equal(state.leave_requests[0].status, "approved");
  assert.equal(state.audit_logs.filter((row) => row.action === "leave_approved").length, 1);
  assert.equal(state.notification_queue.length, 1);
  assert.equal(typeof state.approval_tokens[0].used_at, "string");
});

test("a malformed decision body is refused before anything changes", async (t) => {
  const { state, env } = await setup(t);

  for (const body of [{}, { decision: "maybe" }, { decision: "approve", extra: true }]) {
    const response = await decide(env, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, code: "invalid_request" });
  }

  assert.equal(state.approval_tokens[0].used_at, null);
  assert.equal(state.leave_requests[0].status, "pending");
});

// --- HR resend -------------------------------------------------------------

test("HR resend invalidates old links, issues a 72-hour link and audits the channel", async (t) => {
  const { state, fake, env } = await setup(t);
  state.approval_tokens.push({
    id: "token-2",
    leave_request_id: REQUEST_ID,
    approver_employee_id: APPROVER_ID,
    token_hash: await hashApprovalToken(OTHER_TOKEN),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    used_at: null,
    invalidated_at: null,
    created_by: null,
  });

  const response = await call(env, `/api/leave/hr/requests/${REQUEST_ID}/approval-link`, {
    token: HR_TOKEN,
    method: "POST",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.expiresAt, "string");

  // The response never carries a token or a link.
  const text = JSON.stringify(body);
  assert.equal(text.includes(RAW_TOKEN), false);
  assert.equal(text.includes(OTHER_TOKEN), false);
  assert.equal(text.includes("/approve/"), false);

  assert.equal(state.approval_tokens.length, 3);
  assert.notEqual(state.approval_tokens[0].invalidated_at, null);
  assert.notEqual(state.approval_tokens[1].invalidated_at, null);

  const fresh = state.approval_tokens[2];
  assert.equal(fresh.created_by, HR_ID);
  assert.equal(fresh.used_at, null);
  assert.equal(fresh.invalidated_at, null);
  assert.equal(
    Date.parse(fresh.expires_at) - Date.parse(fresh.created_at),
    72 * 60 * 60 * 1000
  );

  const audit = state.audit_logs.find((row) => row.action === "leave_approval_link_resent");
  assert.ok(audit);
  assert.equal(audit.actor_id, HR_ID);
  assert.deepEqual(JSON.parse(audit.detail), {
    channel: "email_resend",
    requestCode: "LV-20261109-001",
  });
  for (const forbidden of [
    RAW_TOKEN,
    OTHER_TOKEN,
    APPROVER_EMAIL,
    REQUESTER_EMAIL,
    EMPLOYEE_NAME,
    REASON_TEXT,
    fresh.token_hash,
  ]) {
    assert.equal(audit.detail.includes(forbidden), false, forbidden);
  }

  // Both old links are now unusable.
  for (const old of [RAW_TOKEN, OTHER_TOKEN]) {
    const page = await call(env, `/api/approve-link/${old}`);
    assert.equal(page.status, 410);
    assert.equal((await page.json()).category, "invalid");
  }

  assert.ok(fake.calls.some((entry) => entry.method === "POST" && entry.table === "audit_logs"));
});

test("HR resend is refused for a decided request, a missing email and a non-HR role", async (t) => {
  const decided = await setup(t, { requestStatus: "approved" });
  const decidedResponse = await call(
    decided.env,
    `/api/leave/hr/requests/${REQUEST_ID}/approval-link`,
    { token: HR_TOKEN, method: "POST" }
  );
  assert.equal(decidedResponse.status, 409);
  assert.equal(decided.state.approval_tokens.length, 1);

  const noEmail = await setup(t);
  noEmail.state.employees[0].email = null;
  const noEmailResponse = await call(
    noEmail.env,
    `/api/leave/hr/requests/${REQUEST_ID}/approval-link`,
    { token: HR_TOKEN, method: "POST" }
  );
  assert.equal(noEmailResponse.status, 409);
  assert.equal(noEmail.state.approval_tokens.length, 1);

  const plain = await setup(t);
  const plainResponse = await call(
    plain.env,
    `/api/leave/hr/requests/${REQUEST_ID}/approval-link`,
    { token: EMPLOYEE_TOKEN, method: "POST" }
  );
  assert.equal(plainResponse.status, 403);
  assert.equal(plain.state.approval_tokens.length, 1);
});

// --- headers, limits, logs -------------------------------------------------

test("both routes carry the three response headers on success and failure", async (t) => {
  const { env } = await setup(t);

  const responses = [
    await call(env, `/api/approve-link/${RAW_TOKEN}`),
    await call(env, `/api/approve-link/${OTHER_TOKEN}`),
    await decide(env, { decision: "approve" }),
    await decide(env, { decision: "reject", reason: "ไม่สะดวก" }),
  ];

  assert.deepEqual(responses.map((response) => response.status), [200, 410, 200, 410]);
  for (const response of responses) assertPrivateHeaders(response);
});

test("both routes use the existing limiters", async (t) => {
  const limitedIp = await setup(t, { envOptions: { ipSuccess: false } });
  const ipResponse = await call(limitedIp.env, `/api/approve-link/${RAW_TOKEN}`);
  assert.equal(ipResponse.status, 429);
  assert.deepEqual(await ipResponse.json(), { ok: false, code: "rate_limited" });
  assert.deepEqual(limitedIp.env.RL_SUBMIT_IP.calls, ["approve-link|unknown"]);
  assert.equal(limitedIp.state.leave_requests[0].status, "pending");

  const limitedToken = await setup(t, { envOptions: { tokenSuccess: false } });
  const tokenResponse = await decide(limitedToken.env, { decision: "approve" });
  assert.equal(tokenResponse.status, 429);
  assert.deepEqual(await tokenResponse.json(), { ok: false, code: "rate_limited" });
  assert.equal(limitedToken.state.leave_requests[0].status, "pending");
  assert.equal(limitedToken.env.RL_SUBMIT_TOKEN.calls.length, 1);
});

test("no log line carries a raw token, hash, address, reason or name", async (t) => {
  const captured = [];
  const originals = {};
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    originals[method] = console[method];
    console[method] = (...args) => captured.push(args);
  }
  t.after(() => {
    for (const [method, original] of Object.entries(originals)) console[method] = original;
  });

  const read = await setup(t);
  await call(read.env, `/api/approve-link/${RAW_TOKEN}`);
  await call(read.env, `/api/approve-link/${OTHER_TOKEN}`);
  await call(read.env, `/api/approve-link/not-a-token`);
  await decide(read.env, { decision: "approve" });
  await decide(read.env, { decision: "reject" });

  // A separate resend path, so the audit and dispatch also run.
  const resend = await setup(t);
  await call(resend.env, `/api/leave/hr/requests/${REQUEST_ID}/approval-link`, {
    token: HR_TOKEN,
    method: "POST",
  });

  const text = captured
    .map((args) =>
      args
        .map((value) => {
          try {
            return typeof value === "string" ? value : JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(" ")
    )
    .join("\n");

  const hash = await hashApprovalToken(RAW_TOKEN);
  assert.equal(resend.state.approval_tokens.length, 2);
  const newHash = resend.state.approval_tokens.at(-1).token_hash;

  for (const forbidden of [
    RAW_TOKEN,
    OTHER_TOKEN,
    hash,
    newHash,
    APPROVER_EMAIL,
    REQUESTER_EMAIL,
    EMPLOYEE_NAME,
    REASON_TEXT,
    "ไม่สะดวก",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("the public route module never builds a link from request headers", () => {
  const service = readFileSync(new URL("../src/approval-link.js", import.meta.url), "utf8");
  const routes = readFileSync(new URL("../src/routes/approve-link.js", import.meta.url), "utf8");

  assert.equal(/req\.header\([^)]*[Hh]ost/.test(service), false);
  assert.equal(/req\.header\([^)]*[Hh]ost/.test(routes), false);
  assert.equal(routes.includes("APP_PUBLIC_URL"), false);
  assert.equal(service.includes("publicUrl"), true);
});
