import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";

// Fake project values. Not real credentials, tokens or employee data.
const EMPLOYEE_ID = "123e4567-e89b-42d3-a456-426614174000";
const EMPLOYEE_ID_2 = "223e4567-e89b-42d3-a456-426614174000";
const CONTROLLER_COOKIE_TOKEN = "controller-session-cookie-token";
const COOKIE = `hr_session=${CONTROLLER_COOKIE_TOKEN}`;
const SUP_TYPE_ID = "type-sup";
const MONTHLY_TYPE_ID = "type-monthly";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const NOW_MS = Date.parse("2026-01-05T03:00:00.000Z"); // Monday 10:00 in Bangkok
const NOW_ISO = "2026-01-05T03:00:00.000Z";

const SAVE_ERROR = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const TYPE_ERROR = "ประเภทการประชุมไม่ถูกต้อง";
const EMPLOYEE_ERROR = "ไม่พบพนักงานที่ใช้งานอยู่";
const ROSTER_ERROR = "ไม่พบรายชื่อนี้";
const INVALID_BODY = "ข้อมูลไม่ถูกต้อง";
const UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";

const SESSION_ID = "session-1";

let controllerHashPromise = null;
function controllerHash() {
  if (controllerHashPromise === null) {
    controllerHashPromise = sha256Hex(CONTROLLER_COOKIE_TOKEN);
  }
  return controllerHashPromise;
}

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
  return { calls, restore() { globalThis.fetch = original; } };
}

/** eq / gte / is.null filter check against a fake row. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "onConflict") {
      continue;
    }
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
  }
  return true;
}

function sessionRow(login_role) {
  return {
    id: SESSION_ID,
    employee_id: EMPLOYEE_ID,
    login_role,
    last_active_at: NOW_ISO,
    expires_at: "2026-01-05T15:00:00.000Z",
    revoked_at: null,
  };
}

/**
 * The search or= filter, parsed loosely from the RAW query string (reading
 * searchParams.get("or") would decode once more and break on bare %). Pull
 * both ilike patterns, decode them, drop the outer percent pairs and treat the
 * rest as a substring match. Good enough to drive the route logic without
 * re-implementing PostgREST.
 */
function orFilterMatches(rawUrl, row) {
  const search = new URL(rawUrl).search;
  const or = search.split("&").find((part) => part.startsWith("or=")) ?? "";
  if (!or) return true;
  const patterns = [...or.matchAll(/ilike\.([^,)]+)/g)].map((m) =>
    decodeURIComponent(m[1]).replace(/^%|%$/g, "").replace(/\\([\\%_])/g, "$1")
  );
  const haystacks = [row.full_name ?? "", row.employee_code ?? ""];
  return patterns.every((pattern) =>
    haystacks.some((value) => value.toLowerCase().includes(pattern.toLowerCase()))
  );
}

/**
 * Fake backend covering the controller session flow and the roster tables.
 * state.fail makes every non-auth call throw (database unavailable).
 */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [
      { id: SUP_TYPE_ID, code: "sup", name: "ประชุมหัวหน้างาน" },
      { id: MONTHLY_TYPE_ID, code: "monthly", name: "ประชุมประจำเดือน" },
    ],
    roster: options.roster ?? [],
    employees: options.employees ?? [],
    fail: options.fail ?? false,
    sessionRole: options.sessionRole ?? "meeting_controller",
    rosterPatches: [],
    rosterUpserts: [],
    auditLogs: [],
  };

  const fake = installFetch(async ({ url, init }) => {
    const parsed = new URL(url);
    const table = tableOf(url);
    const method = init.method ?? "GET";
    const params = parsed.searchParams;

    // --- controller session flow ---
    if (table === "auth_sessions" && method === "GET") {
      const hash = await controllerHash();
      if (params.get("token_hash") === `eq.${hash}`) {
        return jsonResponse([sessionRow(state.sessionRole)]);
      }
      return jsonResponse([]);
    }
    if (table === "auth_sessions" && method === "PATCH") return emptyResponse();
    if (table === "employees") {
      const id = params.get("id");
      const select = params.get("select") ?? "";
      // The session flow reads the controller employee with columns=*. The add
      // route reads a target employee with id,is_active.
      if (select === "*" && (id === null || id === `eq.${EMPLOYEE_ID}`)) {
        return jsonResponse([{ id: EMPLOYEE_ID, is_active: true }]);
      }
      if (id && id.startsWith("eq.")) {
        return jsonResponse(state.employees.filter((r) => matches(params, r)));
      }
    }
    if (table === "hr_admins" || table === "meeting_admins" || table === "system_admins") {
      const isAdminTable =
        (state.sessionRole === "hr" && table === "hr_admins") ||
        (state.sessionRole === "meeting_controller" && table === "meeting_admins");
      return jsonResponse(isAdminTable ? [{ employee_id: EMPLOYEE_ID }] : []);
    }
    if (table === "leave_requests") return jsonResponse([]);

    // --- roster tables ---
    if (state.fail) throw new Error("database unavailable");

    if (table === "meeting_types" && method === "GET") {
      return jsonResponse(state.types.filter((r) => matches(params, r)));
    }
    if (table === "meeting_roster") {
      if (method === "GET") {
        const rows = state.roster.filter((r) => matches(params, r));
        const limitParam = Number(params.get("limit"));
        return jsonResponse(Number.isFinite(limitParam) && params.get("limit") !== null ? rows.slice(0, limitParam) : rows);
      }
      if (method === "POST") {
        const body = JSON.parse(init.body ?? "{}");
        state.rosterUpserts.push({ url, init, body });
        // Upsert returns the representation; one row per request.
        const row = {
          id: state.roster.length + 1,
          ...body,
        };
        return jsonResponse([row], 200);
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body ?? "{}");
        const patched = [];
        state.roster = state.roster.map((row) => {
          if (!matches(params, row)) return row;
          const next = { ...row, ...body };
          patched.push({ meeting_type_id: row.meeting_type_id });
          return next;
        });
        state.rosterPatches.push({ url, init, body, patchedRows: patched.length });
        if (init.headers?.Prefer?.includes("return=representation")) {
          return jsonResponse(patched, 200);
        }
        return emptyResponse();
      }
    }
    if (table === "employees") {
      const rows = state.employees
        .filter((r) => matches(params, r))
        .filter((r) => orFilterMatches(url, r));
      const limitParam = Number(params.get("limit"));
      return jsonResponse(Number.isFinite(limitParam) && params.get("limit") !== null ? rows.slice(0, limitParam) : rows);
    }
    if (table === "audit_logs" && method === "POST") {
      state.auditLogs.push(JSON.parse(init.body ?? "{}"));
      return emptyResponse(201);
    }

    return jsonResponse([]);
  });

  fake.state = state;
  return fake;
}

function envFor(overrides = {}) {
  return { ...ENV, ...overrides };
}

function get(url, cookie = COOKIE) {
  return app.request(url, cookie ? { headers: { Cookie: cookie } } : {}, envFor());
}

function post(path, body, cookie = COOKIE) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    },
    envFor()
  );
}

function rosterRow(overrides = {}) {
  return {
    meeting_type_id: SUP_TYPE_ID,
    employee_id: EMPLOYEE_ID,
    is_active: true,
    employees: {
      employee_code: "B1024",
      full_name: "สมชาย ใจดี",
      departments: { name: "ฝ่ายบุคคล" },
      positions: { name: "เจ้าหน้าที่" },
    },
    ...overrides,
  };
}

function employeeRow(overrides = {}) {
  return {
    id: EMPLOYEE_ID_2,
    employee_code: "B1025",
    full_name: "ขจร เดือนดี",
    is_active: true,
    departments: { name: "ฝ่ายขาย" },
    positions: { name: "ผู้จัดการ" },
    ...overrides,
  };
}

// --- GET /api/meeting/roster --------------------------------------------------

test("roster GET: returns active sup members sorted by Thai name with a count", async (t) => {
  freeze(t);
  const fake = createBackend({
    roster: [
      rosterRow(),
      rosterRow({
        employee_id: EMPLOYEE_ID_2,
        employees: {
          employee_code: "B0999",
          full_name: "ขจร เดือนดี",
          departments: { name: "ฝ่ายขาย" },
          positions: { name: "ผู้จัดการ" },
        },
      }),
    ],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/roster");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(body.members, [
    {
      employeeId: EMPLOYEE_ID_2,
      employeeCode: "B0999",
      fullName: "ขจร เดือนดี",
      departmentName: "ฝ่ายขาย",
      positionName: "ผู้จัดการ",
    },
    {
      employeeId: EMPLOYEE_ID,
      employeeCode: "B1024",
      fullName: "สมชาย ใจดี",
      departmentName: "ฝ่ายบุคคล",
      positionName: "เจ้าหน้าที่",
    },
  ]);

  const call = fake.calls.find((c) => tableOf(c.url) === "meeting_roster");
  const params = new URL(call.url).searchParams;
  assert.equal(params.get("meeting_type_id"), `eq.${SUP_TYPE_ID}`);
  assert.equal(params.get("is_active"), "eq.true");
});

test("roster GET: monthly rows are not included in the sup roster", async (t) => {
  freeze(t);
  const fake = createBackend({
    roster: [
      rosterRow(),
      rosterRow({ meeting_type_id: MONTHLY_TYPE_ID, employee_id: EMPLOYEE_ID_2 }),
    ],
  });
  t.after(() => fake.restore());

  const body = await (await get("/api/meeting/roster")).json();
  assert.equal(body.count, 1);
  assert.equal(body.members[0].employeeId, EMPLOYEE_ID);
});

test("roster GET: a missing sup type is 400 and a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});

  const missing = createBackend({ types: [{ id: MONTHLY_TYPE_ID, code: "monthly" }] });
  t.after(() => missing.restore());
  const res400 = await get("/api/meeting/roster");
  assert.equal(res400.status, 400);
  assert.deepEqual(await res400.json(), { ok: false, message: TYPE_ERROR });

  const fail = createBackend({ fail: true });
  t.after(() => fail.restore());
  const res500 = await get("/api/meeting/roster");
  assert.equal(res500.status, 500);
  assert.deepEqual(await res500.json(), { ok: false, message: SAVE_ERROR });
});

// --- GET /api/meeting/roster/search -------------------------------------------

test("search: a query shorter than two characters returns empty results without table calls", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  for (const q of ["", " ", "a", "ส"]) {
    const res = await get(`/api/meeting/roster/search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, JSON.stringify(q));
    assert.deepEqual(await res.json(), { ok: true, results: [] });
  }

  // A literal q=%20 URL decodes to a single space: still a short query.
  const resSpace = await get("/api/meeting/roster/search?q=%20");
  assert.equal(resSpace.status, 200);
  assert.deepEqual(await resSpace.json(), { ok: true, results: [] });

  // Search-related calls only: the session flow's employee read (select=*) is
  // not a search call.
  const searchCalls = fake.calls.filter((call) => {
    const table = tableOf(call.url);
    const params = new URL(call.url).searchParams;
    if (table === "meeting_roster") return true;
    return table === "employees" && params.get("select") !== "*";
  });
  assert.equal(searchCalls.length, 0);
});

test("search: the or filter is URL-encoded so commas and parentheses survive", async (t) => {
  freeze(t);
  const fake = createBackend({ employees: [] });
  t.after(() => fake.restore());

  const q = "สมชาย,(ก)_50%";
  await get(`/api/meeting/roster/search?q=${encodeURIComponent(q)}`);

  const call = fake.calls.find(
    (c) => tableOf(c.url) === "employees" && new URL(c.url).searchParams.has("or")
  );
  assert.ok(call, "no employees call with an or filter");
  // The raw query string is what PostgREST receives; searchParams.get decodes
  // once and would undo the leaf encoding, so assert on the raw search.
  const raw = new URL(call.url).search;
  const or = raw.split("&").find((part) => part.startsWith("or=")) ?? "";
  assert.ok(or.startsWith("or=(full_name.ilike.%25"), `unexpected or filter: ${raw}`);
  assert.match(or, /employee_code\.ilike\.%25/);
  // The search specials are encoded: everyone of these must appear encoded, once.
  assert.match(or, /%28/); // (
  assert.match(or, /%29/); // )
  assert.match(or, /%2C/); // ,
  assert.match(or, /%25/); // % -> %25
  assert.match(or, /%5C/); // backslash escape from escapeIlike
  // The structural separator between the two ilike clauses stays a raw comma,
  // and the pattern itself never leaks a raw comma or brace.
  assert.equal(or.split(",").length, 2, `unexpected or filter: ${raw}`);
  const params = new URL(call.url).searchParams;
  assert.equal(params.get("limit"), "10");
  assert.equal(params.get("is_active"), "eq.true");
});

test("search: merges, dedupes, drops roster members, sorts Thai and caps at 10", async (t) => {
  freeze(t);
  // Like PostgREST, the fake applies limit=10 server-side: the first scenario
  // has enough candidates for the cap; the roster member sits outside that
  // window and must never appear.
  const employees = [];
  for (let i = 0; i < 12; i += 1) {
    employees.push(employeeRow({ id: `emp-${i}`, full_name: `พนักงาน ${i}`, employee_code: `B200${i}` }));
  }
  employees.push(
    employeeRow({ id: "emp-roster", full_name: "พนักงาน โรสเตอร์", employee_code: "B2100" }),
    employeeRow({ id: "emp-inactive", full_name: "พนักงาน ยกเลิก", is_active: false })
  );

  const fake = createBackend({
    employees,
    roster: [rosterRow({ employee_id: "emp-roster" })],
  });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/roster/search?q=พนักงาน");
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  // 12 active candidates -> the SQL limit caps the window; the route caps at 10.
  assert.equal(body.results.length, 10);
  assert.equal(body.results.some((row) => row.employeeId === "emp-roster"), false);
  assert.equal(body.results.some((row) => row.employeeId === "emp-inactive"), false);
  assert.deepEqual(
    body.results.map((row) => row.fullName),
    [...body.results.map((row) => row.fullName)].sort((a, b) => a.localeCompare(b, "th"))
  );

  // A roster member inside the limit window is dropped from the results.
  const fakeWindow = createBackend({
    employees: [
      employeeRow({ id: "emp-0", full_name: "พนักงาน ศูนย์", employee_code: "B2000" }),
      employeeRow({ id: "emp-w", full_name: "พนักงาน โรสเตอร์", employee_code: "B2100" }),
    ],
    roster: [rosterRow({ employee_id: "emp-w" })],
  });
  t.after(() => fakeWindow.restore());

  const resWindow = await get("/api/meeting/roster/search?q=พนักงาน");
  assert.equal(resWindow.status, 200);
  const bodyWindow = await resWindow.json();
  assert.deepEqual(
    bodyWindow.results.map((row) => row.employeeId),
    ["emp-0"]
  );
});

test("search: a missing sup type is 400", async (t) => {
  freeze(t);
  const fake = createBackend({ types: [{ id: MONTHLY_TYPE_ID, code: "monthly" }] });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/roster/search?q=สมชาย");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
});

test("search: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await get("/api/meeting/roster/search?q=สมชาย");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- POST /api/meeting/roster/add ----------------------------------------------

test("add: the body is strict and validates the UUID", async (t) => {
  freeze(t);
  const cases = [
    {},
    { extra: "x", employeeId: EMPLOYEE_ID_2 },
    { employeeId: "not-a-uuid" },
    { employeeId: "123e4567-e89b-02d3-a456-426614174000" },
    { employeeId: 1 },
  ];

  for (const body of cases) {
    const fake = createBackend();
    try {
      const res = await post("/api/meeting/roster/add", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
      assert.equal(fake.state.rosterUpserts.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("add: accepts the nil and max UUIDs like Express", async (t) => {
  freeze(t);
  for (const employeeId of [
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    EMPLOYEE_ID_2.toUpperCase(),
  ]) {
    const fake = createBackend({ employees: [] });
    try {
      const res = await post("/api/meeting/roster/add", { employeeId });
      assert.equal(res.status, 400, employeeId);
      assert.deepEqual(await res.json(), { ok: false, message: EMPLOYEE_ERROR });
    } finally {
      fake.restore();
    }
  }
});

test("add: a missing or inactive employee is 400", async (t) => {
  freeze(t);
  const missing = createBackend({ employees: [] });
  t.after(() => missing.restore());
  const resMissing = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(resMissing.status, 400);
  assert.deepEqual(await resMissing.json(), { ok: false, message: EMPLOYEE_ERROR });

  const inactive = createBackend({
    employees: [employeeRow({ is_active: false })],
  });
  t.after(() => inactive.restore());
  const resInactive = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(resInactive.status, 400);
  assert.deepEqual(await resInactive.json(), { ok: false, message: EMPLOYEE_ERROR });
});

test("add: a missing sup or monthly type is 400", async (t) => {
  freeze(t);
  const cases = [
    { types: [{ id: SUP_TYPE_ID, code: "sup" }] },
    { types: [{ id: MONTHLY_TYPE_ID, code: "monthly" }] },
    { types: [] },
  ];

  for (const item of cases) {
    const fake = createBackend(item);
    try {
      const res = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { ok: false, message: TYPE_ERROR });
      assert.equal(fake.state.rosterUpserts.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("add: upserts both type rows with the controller as creator and writes no audit", async (t) => {
  freeze(t);
  const fake = createBackend({ employees: [employeeRow()] });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");

  assert.equal(fake.state.rosterUpserts.length, 2);
  const typeIds = fake.state.rosterUpserts.map((call) => call.body.meeting_type_id);
  assert.deepEqual(typeIds.sort(), [MONTHLY_TYPE_ID, SUP_TYPE_ID]);

  for (const call of fake.state.rosterUpserts) {
    assert.equal(new URL(call.url).searchParams.get("onConflict"), "meeting_type_id,employee_id");
    assert.deepEqual(call.body, {
      meeting_type_id: call.body.meeting_type_id,
      employee_id: EMPLOYEE_ID_2,
      is_active: true,
      created_by: EMPLOYEE_ID,
      created_at: NOW_ISO,
    });
  }

  assert.equal(fake.state.auditLogs.length, 0);
});

test("add: a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { ok: false, message: SAVE_ERROR });
});

// --- POST /api/meeting/roster/remove -------------------------------------------

test("remove: the body is strict like add", async (t) => {
  freeze(t);
  for (const body of [{}, { employeeId: "not-a-uuid" }, { employeeId: EMPLOYEE_ID_2, extra: 1 }]) {
    const fake = createBackend();
    try {
      const res = await post("/api/meeting/roster/remove", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { ok: false, message: INVALID_BODY });
      assert.equal(fake.state.rosterPatches.length, 0);
    } finally {
      fake.restore();
    }
  }
});

test("remove: patches both types and answers ok when rows were updated", async (t) => {
  freeze(t);
  const fake = createBackend({
    roster: [rosterRow(), rosterRow({ meeting_type_id: MONTHLY_TYPE_ID })],
  });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  assert.equal(fake.state.rosterPatches.length, 2);
  const patchedTypes = fake.state.rosterPatches
    .map((call) => new URL(call.url).searchParams.get("meeting_type_id"))
    .sort();
  assert.deepEqual(patchedTypes, [`eq.${MONTHLY_TYPE_ID}`, `eq.${SUP_TYPE_ID}`]);
  for (const call of fake.state.rosterPatches) {
    assert.deepEqual(call.body, { is_active: false });
    assert.match(call.url, /employee_id=eq\.123e4567-e89b-42d3-a456-426614174000/);
  }
  assert.equal(fake.state.auditLogs.length, 0);
});

test("remove: zero updated rows is 404 with the not-found message", async (t) => {
  freeze(t);
  const fake = createBackend({ roster: [] });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, message: ROSTER_ERROR });
});

test("remove: success when only one of the two types has a row", async (t) => {
  freeze(t);
  const fake = createBackend({
    roster: [rosterRow({ meeting_type_id: MONTHLY_TYPE_ID })],
  });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("remove: a missing type is 400 and a database failure is 500", async (t) => {
  freeze(t);
  t.mock.method(console, "error", () => {});

  const missing = createBackend({ types: [{ id: SUP_TYPE_ID, code: "sup" }] });
  t.after(() => missing.restore());
  const res400 = await post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID });
  assert.equal(res400.status, 400);
  assert.deepEqual(await res400.json(), { ok: false, message: TYPE_ERROR });

  const fail = createBackend({ fail: true });
  t.after(() => fail.restore());
  const res500 = await post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID });
  assert.equal(res500.status, 500);
  assert.deepEqual(await res500.json(), { ok: false, message: SAVE_ERROR });
});

// --- auth on every route -------------------------------------------------------

test("every roster route answers 401 without a cookie", async (t) => {
  freeze(t);
  const fake = createBackend();
  t.after(() => fake.restore());

  const requests = [
    get("/api/meeting/roster", null),
    get("/api/meeting/roster/search?q=สมชาย", null),
    post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 }, null),
    post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID_2 }, null),
  ];
  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { ok: false, message: UNAUTHENTICATED });
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(fake.calls.length, 0);
});

test("every roster route answers 403 for a non-controller session", async (t) => {
  freeze(t);
  const fake = createBackend({ sessionRole: "hr" });
  t.after(() => fake.restore());

  const requests = [
    get("/api/meeting/roster"),
    get("/api/meeting/roster/search?q=สมชาย"),
    post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 }),
    post("/api/meeting/roster/remove", { employeeId: EMPLOYEE_ID_2 }),
  ];
  for (const res of await Promise.all(requests)) {
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, message: FORBIDDEN });
  }
  assert.equal(fake.state.auditLogs.length, 0);
  assert.equal(fake.state.rosterUpserts.length, 0);
  assert.equal(fake.state.rosterPatches.length, 0);
});

// --- leakage -------------------------------------------------------------------

test("responses and logs never contain the session cookie token or an employee national ID", async (t) => {
  freeze(t);
  const logs = [];
  const original = console.error;
  console.error = (...args) => {
    logs.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  t.after(() => {
    console.error = original;
  });

  // The fake backend knows nothing about national IDs at all: the roster
  // endpoints only ever request the columns above.
  const fake = createBackend({ fail: true });
  t.after(() => fake.restore());

  const res = await post("/api/meeting/roster/add", { employeeId: EMPLOYEE_ID_2 });
  assert.equal(res.status, 500);

  const text = await res.text();
  const logged = logs.join("\n");
  assert.equal(text.includes(CONTROLLER_COOKIE_TOKEN), false);
  assert.equal(logged.includes(CONTROLLER_COOKIE_TOKEN), false);
  assert.equal(logged.includes("fake-service-role-key"), false);
  assert.equal(/national_id|NationalID/i.test(text), false);
  assert.equal(/national_id|NationalID/i.test(logged), false);
});
