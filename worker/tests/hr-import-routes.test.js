import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { hmacSha256Hex, sha256Hex } from "../src/crypto.js";

const TOKEN = "t".repeat(43);
const EMPLOYEE_TOKEN = "e".repeat(43);
const HR_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const EXISTING_ID = "33333333-3333-4333-8333-333333333333";

const PEPPER = "fake-national-pepper";
const ENC_KEY = "fake-encryption-key";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  NATIONAL_ID_PEPPER: PEPPER,
  NATIONAL_ID_ENC_KEY: ENC_KEY,
};

const HEADERS = [
  "รหัสพนักงาน",
  "คำนำหน้าชื่อ",
  "ชื่อ",
  "สกุล",
  "แผนก",
  "เลขที่บัตรประชาชน",
];

function withCheckDigit(first12) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (13 - index);
  }
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const ID_MATCH = withCheckDigit("110170020011"); // stored for ABC-00220
const ID_OTHER = withCheckDigit("110170020012"); // different person
const ID_NEW = withCheckDigit("110170020013");
const ID_NEW_2 = withCheckDigit("110170020014");

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
  return {
    idFromName(key) {
      return `id:${key}`;
    },
    get() {
      return {
        async fetch() {
          return Response.json({ success });
        },
      };
    },
  };
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "on_conflict"].includes(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value
        .slice(4, -1)
        .split(",")
        .map((item) => decodeURIComponent(item));
      if (!list.includes(String(row[key]))) return false;
      continue;
    }
    if (value.startsWith("gt.")) {
      if (!(String(row[key]) > value.slice(3))) return false;
      continue;
    }
  }
  return true;
}

function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, method: init.method ?? "GET" };
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

async function createFake(options = {}) {
  const storedHash = await hmacSha256Hex(PEPPER, ID_MATCH);
  const now = new Date();
  const state = {
    session: {
      id: "session-1",
      token_hash: await sha256Hex(TOKEN),
      employee_id: HR_ID,
      login_role: "hr",
      revoked_at: null,
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    },
    employeeSession: {
      id: "session-2",
      token_hash: await sha256Hex(EMPLOYEE_TOKEN),
      employee_id: EMPLOYEE_ID,
      login_role: "employee",
      revoked_at: null,
      last_active_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    },
    employees: [
      { id: HR_ID, employee_code: "HR001", full_name: "เจ้าหน้าที่ ทดสอบ", is_active: true },
      { id: EMPLOYEE_ID, employee_code: "EMP-99999", full_name: "พนักงาน ทดสอบ", is_active: true },
      {
        id: EXISTING_ID,
        employee_code: "ABC-00220",
        full_name: "นาย สมชาย เดิม",
        name_prefix: "นาย",
        department_id: "dept-1",
        is_active: true,
      },
    ],
    credentials: [
      { employee_id: EXISTING_ID, national_id_hash: storedHash, national_id_enc: "v1.legacy" },
    ],
    prefixes: [{ name: "นาย" }, { name: "นาง" }, { name: "นางสาว" }],
    departments: [
      { id: "dept-1", name: "ฝ่ายบุคคล" },
      { id: "dept-2", name: "ฝ่ายขาย" },
    ],
    audits: [],
    writes: [],
    rpcCalls: [],
    nextId: 1,
    failRpc: options.failRpc === true,
  };

  const allSessions = () => [state.session, state.employeeSession];

  const fake = installFetch(({ url, init, method }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;

    if (parsed.pathname.startsWith("/rest/v1/rpc/")) {
      const name = parsed.pathname.split("/").pop();
      const body = init.body ? JSON.parse(init.body) : {};
      state.rpcCalls.push({ name, body });
      if (state.failRpc) return jsonResponse({ code: "XX000" }, 500);
      return jsonResponse(1);
    }

    const table = parsed.pathname.split("/").pop();
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET") {
      if (table === "auth_sessions") return jsonResponse(allSessions().filter((row) => matches(params, row)));
      if (table === "employees") return jsonResponse(state.employees.filter((row) => matches(params, row)));
      if (table === "employee_credentials") {
        return jsonResponse(state.credentials.filter((row) => matches(params, row)));
      }
      if (table === "name_prefixes") return jsonResponse(state.prefixes);
      if (table === "departments") return jsonResponse(state.departments);
      if (table === "hr_admins") {
        return jsonResponse([{ employee_id: HR_ID }].filter((row) => matches(params, row)));
      }
      if (table === "audit_logs") return jsonResponse([]);
      return jsonResponse([]);
    }

    if (method === "PATCH") {
      if (table === "auth_sessions") return emptyResponse(204);
      return emptyResponse(204);
    }

    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body ?? {}];

      if (table === "employees") {
        state.writes.push({ table, rows, method });
        const out = rows.map((row) => {
          const existing = state.employees.find((item) => item.employee_code === row.employee_code);
          if (existing) {
            Object.assign(existing, row);
            return { id: existing.id, employee_code: existing.employee_code };
          }
          const created = { id: `emp-new-${state.nextId}`, is_active: true, ...row };
          state.nextId += 1;
          state.employees.push(created);
          return { id: created.id, employee_code: created.employee_code };
        });
        return jsonResponse(out, 201);
      }

      if (table === "employee_credentials") {
        state.writes.push({ table, rows, method });
        for (const row of rows) {
          const existing = state.credentials.find((item) => item.employee_id === row.employee_id);
          if (existing) Object.assign(existing, row);
          else state.credentials.push({ ...row });
        }
        return emptyResponse(204);
      }

      if (table === "audit_logs") {
        state.audits.push(rows[0]);
        state.writes.push({ table, rows, method });
        return emptyResponse(201);
      }

      return emptyResponse(201);
    }

    return emptyResponse(204);
  });

  fake.state = state;
  return fake;
}

function csv(rows) {
  return [HEADERS.join(","), ...rows].join("\n");
}

async function postFile(path, { content, fileName, choices, cookie = `hr_session=${TOKEN}` }) {
  const form = new FormData();
  form.append("file", new File([new TextEncoder().encode(content)], fileName, { type: "text/csv" }));
  if (choices !== undefined) form.append("choices", JSON.stringify(choices));

  const headers = {};
  if (cookie) headers.Cookie = cookie;
  const response = await request(`https://fake.local${path}`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

function makeEnv(overrides = {}) {
  return {
    ...ENV,
    RL_CONTEXT_IP: makeLimiter(),
    RL_SUBMIT_IP: makeLimiter(),
    RL_SUBMIT_TOKEN: makeLimiter(),
    ...overrides,
  };
}

/** Calls the Hono app with the test bindings attached. */
const appRequest = (input, init, env) => app.request(input, init, env);
function request(input, init = {}, env = makeEnv()) {
  return appRequest(input, init, env);
}

test("every import route requires an HR session", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const anonymous = await request("https://fake.local/api/hr/employees/import/template");
  assert.equal(anonymous.status, 401);

  const asEmployee = await request("https://fake.local/api/hr/employees/import/template", {
    headers: { Cookie: `hr_session=${EMPLOYEE_TOKEN}` },
  });
  assert.equal(asEmployee.status, 403);

  const preview = await postFile("/api/hr/employees/import/preview", {
    content: csv([`ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_MATCH}`]),
    fileName: "employees.csv",
    cookie: "",
  });
  assert.equal(preview.status, 401);

  const confirm = await postFile("/api/hr/employees/import/confirm", {
    content: csv([`ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_MATCH}`]),
    fileName: "employees.csv",
    cookie: `hr_session=${EMPLOYEE_TOKEN}`,
  });
  assert.equal(confirm.status, 403);
});

test("template download is an xlsx attachment", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const response = await request("https://fake.local/api/hr/employees/import/template", {
    headers: { Cookie: `hr_session=${TOKEN}` },
    env: makeEnv(),
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Content-Type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.match(response.headers.get("Content-Disposition") ?? "", /employees-import-template\.xlsx/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test("preview reports counts, choices and skips without exposing an ID", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const content = csv([
    `ABC-00220,นาย,สมชาย,ใหม่,ฝ่ายขาย,${ID_MATCH}`, // update (same ID)
    `ABC-00221,นาย,สมชาย,อื่น,ฝ่ายขาย,${ID_OTHER}`, // new code
    `ABC-00222,นางสาว,สมหญิง,ใหม่,ฝ่ายบุคคล,${ID_NEW}`, // new code
    `abc-1,นาย,ผิด,รูปแบบ,ฝ่ายบุคคล,${ID_NEW}`, // bad code
    `ABC-00223,นาย,ก,ข,ฝ่ายบัญชี,${ID_NEW}`, // unknown department
    `ABC-00224,นาย,ก,ข,ฝ่ายบุคคล,${ID_OTHER.slice(0, 12)}`, // 12 digits
    `ABC-00225,นาง สาว,ก,ข,ฝ่ายบุคคล,${ID_NEW_2}`, // prefix adjusted
    `ABC-00226,นาย,=cmd,ข,ฝ่ายบุคคล,${ID_NEW}`, // formula
    `ABC-00227,นาย,ซ้ำ,ไฟล์,ฝ่ายบุคคล,${ID_NEW}`, // duplicate pair
    `ABC-00227,นาย,ซ้ำ,ไฟล์,ฝ่ายบุคคล,${ID_NEW_2}`,
    ``,
  ]);

  const { status, json, text } = await postFile("/api/hr/employees/import/preview", {
    content,
    fileName: "employees.csv",
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.summary.added, 3);
  assert.equal(json.summary.updated, 1);
  assert.equal(json.summary.skipped, 6);
  assert.equal(json.summary.needsChoice, 0);
  assert.equal(json.adjustments.length, 1);
  assert.deepEqual(json.adjustments[0], {
    row: 8,
    employeeCode: "ABC-00225",
    field: "prefix",
    from: "นาง สาว",
    to: "นางสาว",
  });
  assert.equal(json.settings.maxRows, 500);
  assert.equal(json.settings.maxLengths.firstName, 60);

  const reasons = json.skipped.map((item) => item.reason);
  assert.ok(reasons.some((reason) => reason.includes("รหัสพนักงานไม่ถูกต้อง")));
  assert.ok(reasons.some((reason) => reason.includes("ไม่พบแผนกในรายการ")));
  assert.ok(reasons.some((reason) => reason === "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก"));
  assert.ok(reasons.some((reason) => reason.includes("ขึ้นต้นด้วยอักขระ")));
  assert.equal(reasons.filter((reason) => reason === "รหัสพนักงานซ้ำในไฟล์").length, 2);

  assert.equal(/\d{13}/.test(text), false);
  assert.equal(text.includes(ID_MATCH), false);
  assert.equal(text.includes(ID_NEW), false);
});

test("a mismatched ID becomes a per-row choice that defaults to keep", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const content = csv([`ABC-00220,นาย,สมชาย,ใหม่,ฝ่ายขาย,${ID_OTHER}`]);
  const { status, json, text } = await postFile("/api/hr/employees/import/preview", {
    content,
    fileName: "employees.csv",
  });

  assert.equal(status, 200);
  assert.equal(json.summary.needsChoice, 1);
  assert.equal(json.summary.updated, 0);
  assert.equal(json.choices.length, 1);
  assert.equal(json.choices[0].decision, "keep");
  assert.equal(json.choices[0].row, 2);
  assert.equal(json.choices[0].employeeCode, "ABC-00220");
  assert.match(json.choices[0].fileIdMasked, /^•{9}\d{4}$/);
  assert.equal(json.choices[0].storedIdMasked, null); // legacy value cannot be decrypted
  assert.equal(text.includes(ID_OTHER), false);
  assert.equal(text.includes(ID_MATCH), false);
});

test("confirm writes one batch, never a PIN, and one audit row", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const content = csv([
    `ABC-00220,นาย,สมชาย,ใหม่,ฝ่ายขาย,${ID_MATCH}`,
    `ABC-00230,นาง,สมหญิง,ใหม่,ฝ่ายบุคคล,${ID_NEW}`,
    `ABC-00231,นาย,ทดสอบ,ใหม่,ฝ่ายขาย,${ID_NEW_2}`,
  ]);

  const { status, json } = await postFile("/api/hr/employees/import/confirm", {
    content,
    fileName: "employees.csv",
    choices: [],
  });

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.summary.added, 2);
  assert.equal(json.summary.updated, 1);

  assert.equal(fake.state.audits.length, 1);
  const audit = fake.state.audits[0];
  assert.equal(audit.action, "employees_imported");
  assert.equal(audit.entity, "employee_import");
  assert.equal(audit.actor_id, HR_ID);
  assert.deepEqual(audit.detail, {
    file: "employees.csv",
    added: 2,
    updated: 1,
    keptExisting: 0,
    skipped: 0,
    rejected: 0,
    usedFileValue: 0,
    adjusted: 0,
  });
  assert.equal(JSON.stringify(audit).includes(ID_NEW), false);

  const employeeWrites = fake.state.writes.filter((write) => write.table === "employees");
  assert.ok(employeeWrites.length >= 2);
  const addedRows = employeeWrites.flatMap((write) => write.rows).filter((row) => row.is_active === true);
  assert.equal(addedRows.length, 2);

  const credentialWrites = fake.state.writes.filter((write) => write.table === "employee_credentials");
  const newCredentialRows = credentialWrites[0].rows;
  assert.equal(newCredentialRows.length, 2);
  for (const credential of newCredentialRows) {
    assert.equal(credential.pin_hash, null);
    assert.match(credential.national_id_hash, /^[0-9a-f]{64}$/);
    assert.match(credential.national_id_enc, /^v1\./);
    assert.equal("locked_until" in credential, false);
    assert.equal("failed_attempts" in credential, false);
  }

  // The update path must not send pin_hash or any login column at all.
  for (const write of credentialWrites.slice(1)) {
    for (const row of write.rows) {
      assert.equal("pin_hash" in row, false);
    }
  }

  assert.equal(fake.calls.some((call) => call.method === "DELETE"), false);
  assert.equal(fake.state.employees.some((row) => row.employee_code === "ABC-00230"), true);
});

test("confirm keeps the stored values when HR leaves the default choice", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const before = fake.state.employees.find((row) => row.id === EXISTING_ID).full_name;
  const content = csv([`ABC-00220,นาย,สมชาย,เปลี่ยนชื่อ,ฝ่ายขาย,${ID_OTHER}`]);

  const { status, json } = await postFile("/api/hr/employees/import/confirm", {
    content,
    fileName: "employees.csv",
    choices: [{ row: 2, decision: "keep" }],
  });

  assert.equal(status, 200);
  assert.equal(json.summary.keptExisting, 1);
  assert.equal(json.summary.updated, 0);
  assert.equal(
    fake.state.employees.find((row) => row.id === EXISTING_ID).full_name,
    before
  );
  assert.equal(fake.state.credentials.length, 1);
});

test("confirm applies file values when HR chooses them per row", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const content = csv([`ABC-00220,นาย,สมชาย,เปลี่ยนชื่อ,ฝ่ายขาย,${ID_OTHER}`]);

  const { status, json } = await postFile("/api/hr/employees/import/confirm", {
    content,
    fileName: "employees.csv",
    choices: [{ row: 2, decision: "file" }],
  });

  assert.equal(status, 200);
  assert.equal(json.summary.updated, 1);

  const updated = fake.state.employees.find((row) => row.id === EXISTING_ID);
  assert.equal(updated.full_name, "นาย สมชาย เปลี่ยนชื่อ");
  assert.equal(updated.department_id, "dept-2");
  assert.equal(updated.is_active, true);

  const credential = fake.state.credentials.find((row) => row.employee_id === EXISTING_ID);
  assert.match(credential.national_id_enc, /^v1\./);
  assert.notEqual(credential.national_id_hash, "deadbeef");
  assert.equal(fake.state.audits[0].detail.usedFileValue, 1);
});

test("upload rate limit answers 429 and stops before any database read", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());
  // Hono reads bindings from the third argument of request(); env overrides are
  // applied there, so this test calls the app directly.
  const form = new FormData();
  form.append("file", new File([new TextEncoder().encode(csv([`ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_MATCH}`]))], "employees.csv"));

  const response = await request(
    "https://fake.local/api/hr/employees/import/preview",
    { method: "POST", headers: { Cookie: `hr_session=${TOKEN}` }, body: form },
    makeEnv({ RL_CONTEXT_IP: makeLimiter({ success: false }) })
  );
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /บ่อยเกินไป/);
  assert.equal(
    fake.calls.filter((call) => call.url.includes("name_prefixes")).length,
    0
  );
});

test("a rejected file answers 400 with a reason and no national ID", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const { status, json, text } = await postFile("/api/hr/employees/import/preview", {
    content: [HEADERS.join(","), `ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_MATCH},extra`].join("\n"),
    fileName: "employees.csv",
  });

  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.message, /คอลัมน์เกิน/);
  assert.equal(/\d{13}/.test(text), false);
});

test("xlsm uploads are refused before parsing", async (t) => {
  const fake = await createFake();
  t.after(() => fake.restore());

  const { status, json } = await postFile("/api/hr/employees/import/preview", {
    content: csv([`ABC-00220,นาย,ก,ข,ฝ่ายบุคคล,${ID_MATCH}`]),
    fileName: "employees.xlsm",
  });
  assert.equal(status, 400);
  assert.match(json.message, /xlsm/);
});
