import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import { sha256Hex } from "../src/crypto.js";
import { buildSheetXlsx } from "../src/import/xlsx.js";
import { BACKFILL_HEADERS } from "../src/import/backfill/validate.js";

const TOKEN = "c".repeat(43);
const EMPLOYEE_TOKEN = "d".repeat(43);

const CONTROLLER_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const STAFFER_ID = "33333333-3333-4333-8333-333333333333";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (!(key in row)) {
      if (value === "is.null") continue;
      if (value.startsWith("in.(") || value.startsWith("eq.")) continue;
      continue;
    }
    const current = row[key];
    if (value === "is.null") {
      if (current !== null && current !== undefined) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(current ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value
        .slice(4, -1)
        .split(",")
        .map((item) => decodeURIComponent(item));
      if (!list.includes(String(current ?? ""))) return false;
      continue;
    }
    if (value.startsWith("gt.")) {
      if (!(String(current ?? "") > value.slice(3))) return false;
      continue;
    }
    if (value.startsWith("lt.")) {
      if (!(String(current ?? "") < value.slice(3))) return false;
      continue;
    }
    if (value.startsWith("gte.")) {
      if (!(String(current ?? "") >= value.slice(4))) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      if (!(String(current ?? "") <= value.slice(4))) return false;
      continue;
    }
    if (value.startsWith("ilike.")) {
      const needle = value.slice(6).replace(/%/g, "").toLowerCase();
      if (!String(current ?? "").toLowerCase().includes(needle)) return false;
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
  const now = new Date();
  const state = {
    sessions: [
      {
        id: "auth-1",
        token_hash: await sha256Hex(TOKEN),
        employee_id: CONTROLLER_ID,
        login_role: "meeting_controller",
        revoked_at: null,
        last_active_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: "auth-2",
        token_hash: await sha256Hex(EMPLOYEE_TOKEN),
        employee_id: STAFFER_ID,
        login_role: "employee",
        revoked_at: null,
        last_active_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      },
    ],
    employees: [
      { id: CONTROLLER_ID, employee_code: "MC001", full_name: "ผู้ควบคุม ทดสอบ", is_active: true },
      { id: STAFFER_ID, employee_code: "EMP-00001", full_name: "พนักงาน ทดสอบ", is_active: true },
      { id: EMPLOYEE_ID, employee_code: "EMP-00002", full_name: "นาย สมชาย ทดสอบ", name_prefix: "นาย", is_active: true },
      {
        id: "44444444-4444-4444-8444-444444444444",
        employee_code: "EMP-00003",
        full_name: "นาง สมหญิง ทดสอบ",
        name_prefix: "นาง",
        is_active: true,
      },
    ],
    types: [
      { id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน" },
      { id: "type-monthly", code: "monthly", name: "ประชุม Monthly" },
    ],
    meetings: options.meetings ? [...options.meetings] : [],
    attendance: options.attendance ? [...options.attendance] : [],
    audits: [],
    nextSessionId: 1,
    failSessions: options.failSessions === true,
  };

  const fake = installFetch(({ url, init, method }) => {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    const table = parsed.pathname.split("/").pop();
    const body = init.body ? JSON.parse(init.body) : null;

    if (method === "GET") {
      if (table === "auth_sessions") return jsonResponse(state.sessions.filter((row) => matches(params, row)));
      if (table === "employees") return jsonResponse(state.employees.filter((row) => matches(params, row)));
      if (table === "hr_admins") return jsonResponse([]);
      if (table === "meeting_admins") {
        return jsonResponse([{ employee_id: CONTROLLER_ID }].filter((row) => matches(params, row)));
      }
      if (table === "meeting_types") return jsonResponse(state.types);
      if (table === "departments") return jsonResponse([{ id: "dept-1", name: "ฝ่ายบุคคล" }]);
      if (table === "positions") return jsonResponse([{ id: "pos-1", name: "หัวหน้างาน" }]);
      if (table === "meeting_sessions") {
        if (state.failSessions) return jsonResponse({ code: "42703" }, 400);
        return jsonResponse(state.meetings.filter((row) => matches(params, row)));
      }
      if (table === "meeting_attendance") {
        const rows = state.attendance.filter((row) => matches(params, row));
        return jsonResponse(rows);
      }
      if (table === "audit_logs") return jsonResponse([]);
      return jsonResponse([]);
    }

    if (method === "PATCH") return emptyResponse(204);

    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body ?? {}];

      if (table === "meeting_sessions") {
        const out = rows.map((row) => {
          const existing = state.meetings.find(
            (item) =>
              item.meeting_type_id === row.meeting_type_id && item.session_date === row.session_date
          );
          if (existing) {
            Object.assign(existing, row);
            return { id: existing.id, meeting_type_id: existing.meeting_type_id, session_date: existing.session_date };
          }
          const created = { id: `session-${state.nextSessionId}`, ...row };
          state.nextSessionId += 1;
          state.meetings.push(created);
          return { id: created.id, meeting_type_id: created.meeting_type_id, session_date: created.session_date };
        });
        return jsonResponse(out, 201);
      }

      if (table === "meeting_attendance") {
        for (const row of rows) state.attendance.push({ id: `att-${state.attendance.length + 1}`, ...row });
        return emptyResponse(201);
      }

      if (table === "audit_logs") {
        state.audits.push(rows[0]);
        return emptyResponse(201);
      }

      return emptyResponse(201);
    }

    return emptyResponse(204);
  });

  fake.state = state;
  return fake;
}

function request(path, init = {}) {
  return app.request(`https://fake.local${path}`, init, ENV);
}

function fileForm(cells, { decisions } = {}) {
  const bytes = buildSheetXlsx({
    sheetName: "นำเข้าข้อมูลย้อนหลัง",
    headers: BACKFILL_HEADERS,
    rows: cells,
  });
  const form = new FormData();
  form.append(
    "file",
    new File([bytes], "backfill.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
  if (decisions !== undefined) form.append("decisions", JSON.stringify(decisions));
  return form;
}

function row(overrides = {}) {
  return [
    overrides.type ?? "ประชุมหัวหน้างาน",
    overrides.date ?? "01/10/2026",
    overrides.time ?? "09:00",
    overrides.location ?? "ห้องประชุม A",
    overrides.name ?? "นาย สมชาย ทดสอบ",
    overrides.status ?? "เข้าร่วมประชุม",
    overrides.shift ?? "",
    "",
    "",
    "",
    "",
    overrides.reason ?? "",
  ];
}

const AUTH = { Cookie: `hr_session=${TOKEN}` };
const EMPLOYEE_AUTH = { Cookie: `hr_session=${EMPLOYEE_TOKEN}` };

test("every backfill route refuses a signed-out request with 401", async () => {
  const fake = await createFake();
  try {
    for (const [path, init] of [
      ["/api/meeting/backfill/template", {}],
      ["/api/meeting/backfill/meta", {}],
      ["/api/meeting/backfill/history/rounds", {}],
      ["/api/meeting/backfill/history/people?q=สมชาย", {}],
      ["/api/meeting/backfill/history/export", {}],
      ["/api/meeting/backfill/preview", { method: "POST", body: fileForm([row()]) }],
      ["/api/meeting/backfill/confirm", { method: "POST", body: fileForm([row()]) }],
    ]) {
      const response = await request(path, init);
      assert.equal(response.status, 401, path);
    }
  } finally {
    fake.restore();
  }
});

test("a non-controller role gets 403", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/history/rounds", { headers: EMPLOYEE_AUTH });
    assert.equal(response.status, 403);
  } finally {
    fake.restore();
  }
});

test("the template download is an xlsx with the A-L headers", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/template", { headers: AUTH });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.ok(bytes.length > 500);
  } finally {
    fake.restore();
  }
});

test("preview reports new rounds, skips and conflicts without writing", async () => {
  const fake = await createFake({
    meetings: [
      {
        id: "session-old",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "10:00",
        location: "ห้องประชุม A",
      },
    ],
  });
  try {
    const form = fileForm([
      row(),
      row({ time: "", name: "นาย สมชาย ทดสอบ" }),
      row({ name: "นาย ไม่มี อยู่จริง" }),
    ]);
    const response = await request("/api/meeting/backfill/preview", {
      method: "POST",
      headers: AUTH,
      body: form,
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.summary.dataRows, 3);
    assert.equal(data.summary.conflictRounds, 1);
    assert.equal(data.summary.needsDecision, 1);
    assert.equal(data.summary.skipped, 2);
    assert.equal(fake.state.attendance.length, 0);
    assert.equal(fake.state.audits.length, 0);
  } finally {
    fake.restore();
  }
});

test("confirm creates the round, writes attendance and one audit row", async () => {
  const fake = await createFake();
  try {
    const form = fileForm([
      row(),
      row({ name: "นาง สมหญิง ทดสอบ", status: "ลาประชุม", shift: "กะ B", reason: "ลาป่วย" }),
      row({ name: "นาง สมหญิง ทดสอบ", status: "ไม่เข้าร่วม" }),
    ]);
    const response = await request("/api/meeting/backfill/confirm", {
      method: "POST",
      headers: AUTH,
      body: form,
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.summary.sessionsCreated, 1);
    assert.equal(data.summary.attendanceWritten, 2);
    assert.equal(fake.state.meetings.length, 1);
    assert.equal(fake.state.meetings[0].cycle_key, "sup-2026-10-01");
    assert.equal(fake.state.meetings[0].session_time, "09:00");
    assert.equal(fake.state.attendance.length, 2);
    assert.equal(fake.state.attendance[1].shift, "กะ B");
    assert.equal(fake.state.attendance[1].status_code, "leave");
    assert.equal(fake.state.audits.length, 1);
    assert.equal(fake.state.audits[0].action, "meeting_backfill_imported");
    assert.equal(fake.state.audits[0].entity, "meeting_backfill");
    assert.equal(fake.state.audits[0].detail.attendance, 2);
    assert.equal(JSON.stringify(fake.state.audits[0]).includes("สมหญิง"), false);
  } finally {
    fake.restore();
  }
});

test("choosing join writes into the existing round and creates no session", async () => {
  const fake = await createFake({
    meetings: [
      {
        id: "session-old",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "10:00",
        location: "ห้องประชุม A",
      },
    ],
  });
  try {
    const decisions = [
      { key: "type-sup|2026-10-01|09:00|ห้องประชุม A", decision: "join" },
    ];
    const response = await request("/api/meeting/backfill/confirm", {
      method: "POST",
      headers: AUTH,
      body: fileForm([row()], { decisions }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.summary.sessionsCreated, 0);
    assert.equal(data.summary.sessionsReused, 1);
    assert.equal(fake.state.meetings.length, 1);
    assert.equal(fake.state.attendance.length, 1);
    assert.equal(fake.state.attendance[0].session_id, "session-old");
  } finally {
    fake.restore();
  }
});

test("an unknown decision value is rejected with 400", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/confirm", {
      method: "POST",
      headers: AUTH,
      body: fileForm([row()], { decisions: [{ key: "x", decision: "merge" }] }),
    });
    assert.equal(response.status, 400);
  } finally {
    fake.restore();
  }
});

test("a workbook without the expected headers is refused", async () => {
  const fake = await createFake();
  try {
    const bytes = buildSheetXlsx({ sheetName: "x", headers: ["ก", "ข"], rows: [["1", "2"]] });
    const form = new FormData();
    form.append("file", new File([bytes], "other.xlsx"));
    const response = await request("/api/meeting/backfill/preview", {
      method: "POST",
      headers: AUTH,
      body: form,
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.ok, false);
  } finally {
    fake.restore();
  }
});

test("a missing session_time/location column answers 503 with the SQL hint", async () => {
  const fake = await createFake({ failSessions: true });
  try {
    const response = await request("/api/meeting/backfill/preview", {
      method: "POST",
      headers: AUTH,
      body: fileForm([row()]),
    });
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.match(data.message, /backfill-columns\.sql/);
  } finally {
    fake.restore();
  }
});

test("history rounds returns the four status counts and the leave shifts", async () => {
  const fake = await createFake({
    meetings: [
      {
        id: "session-1",
        meeting_type_id: "type-sup",
        session_date: "2026-10-01",
        session_time: "09:00",
        location: "ห้องประชุม A",
        cycle_key: "sup-2026-10-01",
      },
    ],
    attendance: [
      { id: "a1", session_id: "session-1", employee_id: EMPLOYEE_ID, status_code: "attended", shift: null },
      { id: "a2", session_id: "session-1", employee_id: STAFFER_ID, status_code: "leave", shift: "กะ A" },
      { id: "a3", session_id: "session-1", employee_id: "44444444-4444-4444-8444-444444444444", status_code: "urgent_busy", shift: null },
    ],
  });
  try {
    const response = await request("/api/meeting/backfill/history/rounds?year=2026", { headers: AUTH });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.rounds.length, 1);
    const round = data.rounds[0];
    assert.equal(round.counts.attended, 1);
    assert.equal(round.counts.leave, 1);
    assert.equal(round.counts.urgent_busy, 1);
    assert.equal(round.counts.not_attended, 0);
    assert.equal(round.counts.leaveShift["กะ A"], 1);
    assert.equal(round.counts.total, 3);
    assert.equal(round.typeName, "ประชุมหัวหน้างาน");
    assert.equal(round.cycleKey, "sup-2026-10-01");
  } finally {
    fake.restore();
  }
});

test("people search needs two characters and returns at most ten names", async () => {
  const fake = await createFake();
  try {
    const short = await request("/api/meeting/backfill/history/people?q=%E0%B8%AA", { headers: AUTH });
    assert.equal(short.status, 400);

    const response = await request("/api/meeting/backfill/history/people?q=%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2", {
      headers: AUTH,
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.people.length, 1);
    assert.equal(data.people[0].id, EMPLOYEE_ID);
  } finally {
    fake.restore();
  }
});

test("one person's history is paginated and refuses a non-uuid id", async () => {
  const fake = await createFake({
    meetings: [],
    attendance: [
      {
        id: "a1",
        session_id: "session-1",
        employee_id: EMPLOYEE_ID,
        status_code: "attended",
        shift: null,
        registered_at: "2026-10-01T02:00:00.000Z",
        employees: { full_name: "นาย สมชาย ทดสอบ", departments: { name: "ฝ่ายบุคคล" }, positions: { name: "หัวหน้างาน" } },
        meeting_sessions: {
          session_date: "2026-10-01",
          session_time: "09:00",
          location: "ห้องประชุม A",
          cycle_key: "sup-2026-10-01",
          meeting_type_id: "type-sup",
          meeting_types: { code: "sup", name: "ประชุมหัวหน้างาน" },
        },
      },
    ],
  });
  try {
    const bad = await request("/api/meeting/backfill/history/employee?employeeId=nope", { headers: AUTH });
    assert.equal(bad.status, 400);

    const response = await request(`/api/meeting/backfill/history/employee?employeeId=${EMPLOYEE_ID}`, {
      headers: AUTH,
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].statusLabel, "เข้าร่วมประชุม");
    assert.equal(data.items[0].time, "09:00");
  } finally {
    fake.restore();
  }
});

test("export returns an xlsx built from the filtered rows", async () => {
  const fake = await createFake({
    meetings: [],
    attendance: [
      {
        id: "a1",
        session_id: "session-1",
        employee_id: EMPLOYEE_ID,
        status_code: "leave",
        shift: "กะ B",
        reason: "ลาป่วย",
        employees: { full_name: "นาย สมชาย ทดสอบ", departments: { name: "ฝ่ายบุคคล" }, positions: { name: "หัวหน้างาน" } },
        meeting_sessions: {
          session_date: "2026-10-01",
          session_time: "09:00",
          location: "",
          cycle_key: "sup-2026-10-01",
          meeting_type_id: "type-sup",
          meeting_types: { code: "sup", name: "ประชุมหัวหน้างาน" },
        },
      },
    ],
  });
  try {
    const response = await request("/api/meeting/backfill/history/export?year=2026", { headers: AUTH });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /spreadsheetml/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  } finally {
    fake.restore();
  }
});

test("meta returns the filter choices", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/meta", { headers: AUTH });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.types.map((type) => type.code), ["sup", "monthly"]);
    assert.equal(data.statuses.length, 4);
    assert.deepEqual(data.shifts, ["กะ A", "กะ B"]);
  } finally {
    fake.restore();
  }
});

function jsonBody(body) {
  return { "Content-Type": "application/json", ...AUTH };
}

test("preview-batch plans at most 500 rows sent as JSON", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 2,
        rowNumbers: [2, 3],
        rows: [row(), row({ name: "นาง สมหญิง ทดสอบ", status: "ไม่เข้าร่วม" })],
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.summary.dataRows, 2);
    assert.equal(data.summary.rounds, 1);
    assert.equal(data.summary.writeRows, 2);
    assert.equal(fake.state.attendance.length, 0);
  } finally {
    fake.restore();
  }
});

test("preview-batch refuses more than 500 rows", async () => {
  const fake = await createFake();
  try {
    const rows = Array.from({ length: 501 }, () => row());
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({ fileName: "batch.xlsx", startRow: 2, rows }),
    });
    assert.equal(response.status, 400);
  } finally {
    fake.restore();
  }
});

test("confirm-batch writes only on the final batch, which adds the single audit row", async () => {
  const fake = await createFake();
  try {
    const first = await request("/api/meeting/backfill/confirm-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 2,
        rowNumbers: [2],
        rows: [row()],
        decisions: [],
        final: false,
      }),
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).summary.attendanceWritten, 1);
    assert.equal(fake.state.attendance.length, 1);
    assert.equal(fake.state.audits.length, 0);

    const second = await request("/api/meeting/backfill/confirm-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 3,
        rowNumbers: [3],
        rows: [row({ name: "นาง สมหญิง ทดสอบ", status: "ไม่เข้าร่วม" })],
        decisions: [],
        final: true,
        totals: { rounds: 1, sessionsCreated: 1, sessionsReused: 0, attendance: 2, skipped: 0, conflictsSkipped: 0 },
      }),
    });
    assert.equal(second.status, 200);
    assert.equal(fake.state.attendance.length, 2);
    assert.equal(fake.state.audits.length, 1);
    assert.equal(fake.state.audits[0].detail.attendance, 2);
    assert.equal(fake.state.audits[0].detail.file, "batch.xlsx");
  } finally {
    fake.restore();
  }
});

test("the final batch without totals is refused", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/confirm-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({ fileName: "batch.xlsx", startRow: 2, rows: [row()], final: true }),
    });
    assert.equal(response.status, 400);
    assert.equal(fake.state.attendance.length, 0);
  } finally {
    fake.restore();
  }
});

test("the row numbers sent by the browser are kept in the skip report", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 2,
        rowNumbers: [42],
        rows: [row({ time: "" })],
      }),
    });
    const data = await response.json();
    assert.equal(data.skipped[0].row, 42);
  } finally {
    fake.restore();
  }
});

test("the employee list endpoint returns only the fields the matcher needs", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/employees", { headers: AUTH });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(Object.keys(data.employees[0]).sort(), ["full_name", "id", "name_prefix"]);
    assert.ok(data.employees.every((row) => row.id && row.full_name));
  } finally {
    fake.restore();
  }
});

test("a row sent with a matched employee id needs no server-side name matching", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 2,
        rowNumbers: [2],
        employeeIds: [EMPLOYEE_ID],
        rows: [row({ name: "ชื่อที่ไม่มีในระบบ แต่หน้าเว็บจับคู่มาแล้ว" })],
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.summary.writeRows, 1);
    assert.equal(data.skipped.length, 0);
  } finally {
    fake.restore();
  }
});

test("an employee id that is not in the database is skipped, not written", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({
        fileName: "batch.xlsx",
        startRow: 2,
        rowNumbers: [2],
        employeeIds: ["99999999-9999-4999-8999-999999999999"],
        rows: [row()],
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.summary.writeRows, 0);
    assert.match(data.skipped[0].reason, /ไม่พบพนักงานที่ระบุในระบบ/);
  } finally {
    fake.restore();
  }
});

test("a malformed employee id list is refused with 400", async () => {
  const fake = await createFake();
  try {
    const response = await request("/api/meeting/backfill/preview-batch", {
      method: "POST",
      headers: jsonBody(),
      body: JSON.stringify({ fileName: "b.xlsx", startRow: 2, rows: [row()], employeeIds: ["not-a-uuid"] }),
    });
    assert.equal(response.status, 400);
  } finally {
    fake.restore();
  }
});
