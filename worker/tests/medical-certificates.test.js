// HR medical certificate access: the list carries codes and dates only, the
// stream is HR-only with the required headers, and every open writes at most one
// audit row per viewer, request and Bangkok day. Audit failures never block the
// view, and no log line carries a name, path, URL or file name.

import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";

const HR_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const REQ_SICK = "44444444-4444-4444-8444-444444444444";
const REQ_SICK_NO_FILE = "55555555-5555-4555-8555-555555555555";
const REQ_PERSONAL = "66666666-6666-4666-8666-666666666666";
const TYPE_SICK = "77777777-7777-4777-8777-777777777777";
const TYPE_PERSONAL = "88888888-8888-4888-8888-888888888888";
const TOKEN = "a".repeat(43);

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const PATH = `leave/${OWNER_ID}/LV-20261102-001/cert.pdf`;
const PERSONAL_PATH = `leave/${OWNER_ID}/LV-20261103-002/personal.pdf`;
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

const REQUESTS = [
  {
    id: REQ_SICK,
    request_code: "LV-20261102-001",
    employee_id: OWNER_ID,
    leave_type_id: TYPE_SICK,
    start_date: "2026-11-02",
    end_date: "2026-11-03",
    status: "approved",
    has_medical_certificate: true,
    medical_certificate_url: PATH,
  },
  {
    id: REQ_SICK_NO_FILE,
    request_code: "LV-20261104-001",
    employee_id: OWNER_ID,
    leave_type_id: TYPE_SICK,
    start_date: "2026-11-04",
    end_date: "2026-11-04",
    status: "pending",
    has_medical_certificate: true,
    medical_certificate_url: null,
  },
  {
    id: REQ_PERSONAL,
    request_code: "LV-20261105-001",
    employee_id: OWNER_ID,
    leave_type_id: TYPE_PERSONAL,
    start_date: "2026-11-05",
    end_date: "2026-11-05",
    status: "approved",
    has_medical_certificate: true,
    medical_certificate_url: PERSONAL_PATH,
  },
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function createFake({
  role = "hr",
  employeeId = HR_ID,
  failAudit = false,
  storageStatus = 200,
  day = "2026-11-09",
} = {}) {
  const original = globalThis.fetch;
  const now = new Date();
  const session = {
    id: "session-1",
    employee_id: employeeId,
    login_role: role,
    revoked_at: null,
    last_active_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };
  const state = { audits: [], auditKeys: new Set(), day, failAudit, storageStatus };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const params = new URL(url).searchParams;
    const table = tableOf(url);

    if (url.includes("/storage/v1/object/leave-certificates/")) {
      if (state.storageStatus !== 200) return new Response(null, { status: state.storageStatus });
      return new Response(PDF_BYTES, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }

    if (method === "GET") {
      if (table === "auth_sessions") return jsonResponse([session]);
      if (table === "hr_admins") {
        return jsonResponse(role === "hr" ? [{ employee_id: employeeId }] : []);
      }
      if (table === "meeting_admins" || table === "system_admins") return jsonResponse([]);
      if (table === "employees") {
        const wanted = params.get("id") ?? "";
        const id = wanted.startsWith("eq.") ? wanted.slice(3) : null;
        const known = [HR_ID, OWNER_ID, OTHER_ID];
        return jsonResponse(id && known.includes(id) ? [{ id, is_active: true }] : []);
      }
      if (table === "leave_types") {
        const wanted = params.get("id") ?? "";
        const id = wanted.startsWith("eq.") ? wanted.slice(3) : null;
        const all = [
          { id: TYPE_SICK, name: "ลาป่วย" },
          { id: TYPE_PERSONAL, name: "ลากิจ" },
        ];
        return jsonResponse(id ? all.filter((row) => row.id === id) : all);
      }
      if (table === "leave_requests") {
        const id = (params.get("id") ?? "").replace(/^eq\./, "");
        const owner = (params.get("employee_id") ?? "").replace(/^eq\./, "");
        let rows = REQUESTS;
        if (id) rows = rows.filter((row) => row.id === id);
        if (owner) rows = rows.filter((row) => row.employee_id === owner);
        return jsonResponse(rows);
      }
      return jsonResponse([]);
    }

    if (method === "POST") {
      if (table === "audit_logs") {
        if (state.failAudit) return jsonResponse({ code: "42501" }, 500);
        const row = JSON.parse(init.body);
        const key = `${row.actor_id}|${row.entity_id}|${row.action}|${state.day}`;
        if (!state.auditKeys.has(key)) {
          state.auditKeys.add(key);
          state.audits.push(row);
        }
        return jsonResponse([], 201);
      }
      return jsonResponse([], 201);
    }

    return new Response(null, { status: 204 });
  };

  return {
    state,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function call(path, role = "hr", employeeId = HR_ID) {
  const sessionRole = role;
  return app.request(
    `https://fake.local${path}`,
    { method: "GET", headers: { Cookie: `hr_session=${TOKEN}` } },
    { ...ENV, __ROLE: sessionRole, __EMPLOYEE: employeeId }
  );
}

function request(path) {
  return app.request(
    `https://fake.local${path}`,
    { method: "GET", headers: { Cookie: `hr_session=${TOKEN}` } },
    ENV
  );
}

test("the HR list returns only sick-leave certificates, without file data", async (t) => {
  const fake = createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/hr/employees/${OWNER_ID}/medical-certificates`);
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.count, 1);
  assert.deepEqual(Object.keys(data.results[0]).sort(), [
    "endDate",
    "id",
    "requestCode",
    "startDate",
    "status",
  ]);
  assert.equal(data.results[0].id, REQ_SICK);

  const text = JSON.stringify(data);
  assert.equal(text.includes(PATH), false);
  assert.equal(text.includes("cert.pdf"), false);
  assert.equal(text.includes("/storage/"), false);
  assert.equal(text.includes("ลาป่วย"), false);
});

test("the HR list and stream refuse a non-HR session", async (t) => {
  const fake = createFake({ role: "employee", employeeId: OWNER_ID });
  t.after(() => fake.restore());

  assert.equal(
    (await request(`/api/hr/employees/${OWNER_ID}/medical-certificates`)).status,
    403
  );
  assert.equal(
    (await request(`/api/hr/leave-requests/${REQ_SICK}/medical-certificate`)).status,
    403
  );
  assert.equal(fake.state.audits.length, 0);
});

test("the HR stream sends the file with the required headers", async (t) => {
  const fake = createFake();
  t.after(() => fake.restore());

  const response = await request(`/api/hr/leave-requests/${REQ_SICK}/medical-certificate`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Disposition"), "inline");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(await response.text(), "%PDF-1");
  assert.equal(fake.state.audits.length, 1);
});

test("a non-sick request or a missing file is refused", async (t) => {
  const fake = createFake();
  t.after(() => fake.restore());

  assert.equal(
    (await request(`/api/hr/leave-requests/${REQ_PERSONAL}/medical-certificate`)).status,
    403
  );
  assert.equal(
    (await request(`/api/hr/leave-requests/${REQ_SICK_NO_FILE}/medical-certificate`)).status,
    404
  );
  assert.equal(fake.state.audits.length, 0);
});

test("the audit row is written once per day and carries ids only", async (t) => {
  const fake = createFake();
  t.after(() => fake.restore());

  const url = `/api/hr/leave-requests/${REQ_SICK}/medical-certificate`;
  assert.equal((await request(url)).status, 200);
  assert.equal((await request(url)).status, 200);
  assert.equal(fake.state.audits.length, 1);

  // The next Bangkok day is a new row.
  fake.state.day = "2026-11-10";
  assert.equal((await request(url)).status, 200);
  assert.equal(fake.state.audits.length, 2);

  const [row] = fake.state.audits;
  assert.equal(row.actor_id, HR_ID);
  assert.equal(row.action, "view_medical_cert");
  assert.equal(row.entity, "leave_request");
  assert.equal(row.entity_id, REQ_SICK);
  assert.equal(row.detail, null);
  const text = JSON.stringify(fake.state.audits);
  for (const forbidden of [PATH, "cert.pdf", "/storage/", "ลาป่วย", "สมชาย"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("an audit failure is logged as a code and never blocks the view", async (t) => {
  const fake = createFake({ failAudit: true });
  t.after(() => fake.restore());

  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = original;
  });

  const response = await request(`/api/hr/leave-requests/${REQ_SICK}/medical-certificate`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "%PDF-1");
  assert.equal(fake.state.audits.length, 0);

  const text = JSON.stringify(logs);
  assert.equal(text.includes("42501"), true);
  assert.equal(text.includes(PATH), false);
  assert.equal(text.includes("cert.pdf"), false);
});

test("a storage failure logs a status only and returns a fixed message", async (t) => {
  const fake = createFake({ storageStatus: 500 });
  t.after(() => fake.restore());

  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args);
  t.after(() => {
    console.error = original;
  });

  const response = await request(`/api/hr/leave-requests/${REQ_SICK}/medical-certificate`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.ok, false);

  const text = JSON.stringify(logs);
  assert.equal(text.includes("500"), true);
  for (const forbidden of [PATH, "cert.pdf", "/storage/", "สมชาย", "ลาป่วย"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});
