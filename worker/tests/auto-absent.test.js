import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_ABSENT_CRON,
  BATCH_LIMIT,
  dayKeyBefore,
  isDueSession,
  isSkipDate,
  missingEmployees,
  runAutoAbsentOnce,
  shouldEnsureSupSession,
  subrequestBudget,
} from "../src/auto-absent.js";
import { createDb } from "../src/db.js";
import worker from "../src/index.js";

// Fake project values. Not real credentials or employee data.
const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

// Monday 5 January 2026, 12:30 in Bangkok.
const NOW = new Date("2026-01-05T05:30:00.000Z");
const NOW_ISO = NOW.toISOString();
const TODAY = "2026-01-05";

const SUP_TYPE = {
  id: "type-sup",
  code: "sup",
  weekday: 3, // Wednesday: no sup session is created on these Mondays.
  default_open_time: "09:00:00",
  default_cutoff_time: "12:00:00",
};

const MONDAY_SUP_TYPE = { ...SUP_TYPE, weekday: 1 };

const MONTHLY_TYPE = {
  id: "type-monthly",
  code: "monthly",
  weekday: null,
  default_open_time: "09:00:00",
  default_cutoff_time: "12:00:00",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function sessionRow(id, overrides = {}) {
  return {
    id,
    meeting_type_id: SUP_TYPE.id,
    session_date: TODAY,
    cutoff_time: "12:00:00",
    ...overrides,
  };
}

function rosterRow(employeeId, overrides = {}) {
  return {
    meeting_type_id: SUP_TYPE.id,
    employee_id: employeeId,
    is_active: true,
    employees: { department_id: "dept-1", position_id: "pos-1" },
    ...overrides,
  };
}

/** eq / gte / lte / is.null / in.(...) filter check against a fake row. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "on_conflict") continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    if (value.startsWith("gte.")) {
      if (String(row[key]) < value.slice(4)) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      if (String(row[key]) > value.slice(4)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((item) => decodeURIComponent(item));
      if (!list.includes(String(row[key]))) return false;
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
      continue;
    }
  }
  return true;
}

/**
 * Fake PostgREST backend for the auto-absent job. Records every call (so a test
 * can count subrequests) and every write, and honours resolution=ignore-duplicates.
 */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [SUP_TYPE, MONTHLY_TYPE],
    skipDates: options.skipDates ?? [],
    sessions: (options.sessions ?? []).map((row) => ({ ...row })),
    attendance: (options.attendance ?? []).map((row) => ({ ...row })),
    roster: options.roster ?? [],
    auditLogs: (options.auditLogs ?? []).map((row) => ({ ...row })),
    fail: new Set(options.fail ?? []),
    calls: [],
    writes: [],
  };

  function sourceRows(table) {
    if (table === "meeting_types") return state.types;
    if (table === "meeting_skip_dates") return state.skipDates.map((skipDate) => ({ skip_date: skipDate }));
    if (table === "meeting_sessions") return state.sessions;
    if (table === "meeting_attendance") return state.attendance;
    if (table === "meeting_roster") return state.roster;
    if (table === "audit_logs") return state.auditLogs;
    return [];
  }

  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    state.calls.push(call);

    const table = tableOf(call.url);
    const method = init.method ?? "GET";
    if (state.fail.has(table)) return jsonResponse({ code: "XX000" }, 500);

    if (method === "GET") {
      const params = new URL(call.url).searchParams;
      return jsonResponse(sourceRows(table).filter((row) => matches(params, row)));
    }

    const payload = JSON.parse(init.body ?? "[]");
    const rows = Array.isArray(payload) ? payload : [payload];
    const prefer = String(init.headers?.Prefer ?? "");
    const ignore = prefer.includes("resolution=ignore-duplicates");
    const params = new URL(call.url).searchParams;
    // Upserts must name the conflict target with PostgREST's on_conflict
    // parameter; the camelCase spelling used to be parsed as a filter.
    if (table !== "audit_logs" && params.get("on_conflict") === null) {
      throw new Error("upsert without on_conflict");
    }
    state.writes.push({
      table,
      rows,
      prefer,
      onConflict: params.get("on_conflict"),
      search: new URL(call.url).search,
      hasSelect: params.has("select"),
    });

    if (table === "meeting_sessions") {
      const inserted = [];
      for (const row of rows) {
        const existing = state.sessions.find(
          (item) =>
            item.meeting_type_id === row.meeting_type_id && item.session_date === row.session_date,
        );
        if (!existing) {
          const saved = { id: `created-${state.sessions.length + 1}`, ...row };
          state.sessions.push(saved);
          inserted.push(saved);
        } else if (!ignore) {
          Object.assign(existing, row);
        }
      }
      // return=representation answers with the inserted rows only; a row kept by
      // resolution=ignore-duplicates is not returned, as on PostgREST.
      return jsonResponse(params.has("select") ? inserted : rows, 201);
    }

    if (table === "meeting_attendance") {
      for (const row of rows) {
        const existing = state.attendance.find(
          (item) => item.session_id === row.session_id && item.employee_id === row.employee_id,
        );
        if (!existing) state.attendance.push({ ...row });
        else if (!ignore) Object.assign(existing, row);
      }
      return jsonResponse(rows, 201);
    }

    if (table === "audit_logs") {
      state.auditLogs.push(...rows);
      return jsonResponse(rows, 201);
    }

    return jsonResponse(rows, 201);
  };

  return {
    state,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers, ported from tests/auto-absent.test.js (Express)       */
/* ------------------------------------------------------------------ */

test("isDueSession follows the 48-hour window", () => {
  const base = { sessionDate: TODAY, todayKey: TODAY };
  assert.equal(
    isDueSession({ ...base, now: new Date("2026-01-05T03:00:00Z"), cutoffTime: "10:30" }),
    false, // before the cutoff
  );
  assert.equal(
    isDueSession({ ...base, now: new Date("2026-01-05T03:30:00Z"), cutoffTime: "10:30" }),
    true, // exactly at the cutoff
  );
  assert.equal(
    isDueSession({ ...base, now: new Date("2026-01-05T06:00:00Z"), cutoffTime: "10:30" }),
    true, // same day, after the cutoff
  );
  assert.equal(
    isDueSession({
      now: new Date("2026-01-05T03:30:00Z"),
      cutoffTime: "10:30",
      sessionDate: "2026-01-02",
      todayKey: TODAY,
    }),
    false, // more than 48 hours ago
  );
  assert.equal(isDueSession({ ...base, now: new Date("2026-01-05T06:00:00Z"), cutoffTime: "-" }), false);
  assert.equal(
    isDueSession({
      now: new Date("2026-01-05T06:00:00Z"),
      cutoffTime: "10:30",
      sessionDate: "2026-01-06",
      todayKey: TODAY,
    }),
    false, // future session
  );
});

test("missingEmployees keeps roster order and drops attended employees", () => {
  assert.deepEqual(missingEmployees(["a", "b", "c", "d"], ["c", "a"]), ["b", "d"]);
  assert.deepEqual(missingEmployees(["a"], ["a"]), []);
  assert.deepEqual(missingEmployees([], ["a"]), []);
  assert.deepEqual(missingEmployees(["a", "", null], []), ["a"]);
});

test("isSkipDate is true only for a listed date", () => {
  const skipDates = new Set([TODAY]);
  assert.equal(isSkipDate(TODAY, skipDates), true);
  assert.equal(isSkipDate("2026-01-01", skipDates), false);
  assert.equal(isSkipDate(TODAY, []), false);
  assert.equal(isSkipDate("", skipDates), false);
});

test("shouldEnsureSupSession needs the sup weekday, no skip date, and a passed cutoff", () => {
  const base = {
    weekday: 1,
    cutoffTime: "10:30",
    todayKey: TODAY,
    skipDateSet: new Set(),
  };
  assert.equal(shouldEnsureSupSession({ ...base, now: new Date("2026-01-05T03:30:00Z") }), true);
  assert.equal(shouldEnsureSupSession({ ...base, now: new Date("2026-01-05T03:00:00Z") }), false);
  assert.equal(
    shouldEnsureSupSession({ ...base, now: new Date("2026-01-05T03:30:00Z"), skipDateSet: new Set([TODAY]) }),
    false,
  );
  assert.equal(
    shouldEnsureSupSession({ ...base, now: new Date("2026-01-05T03:30:00Z"), weekday: 2 }),
    false,
  );
  assert.equal(
    shouldEnsureSupSession({ ...base, now: new Date("2026-01-05T03:30:00Z"), weekday: null }),
    false,
  );
});

test("dayKeyBefore shifts Bangkok day keys", () => {
  assert.equal(dayKeyBefore(TODAY, 2), "2026-01-03");
  assert.equal(dayKeyBefore("2026-03-01", 2), "2026-02-27");
  assert.equal(dayKeyBefore("junk", 2), "");
});

/* ------------------------------------------------------------------ */
/* Batched runAutoAbsentOnce                                           */
/* ------------------------------------------------------------------ */

test("a run with no due sessions writes nothing", async (t) => {
  const fake = createBackend({
    sessions: [sessionRow("s-future", { session_date: "2026-01-12" })],
    roster: [rosterRow("e1")],
  });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: 0 });
  assert.equal(fake.state.writes.length, 0);
  // The sup weekday is Wednesday and this is Monday, so the skip-date read is
  // gated off: types and sessions only.
  assert.equal(fake.state.calls.length, 2);
});

test("one due session: one batched attendance upsert and one marker insert", async (t) => {
  const fake = createBackend({
    sessions: [sessionRow("s1")],
    roster: [rosterRow("e1"), rosterRow("e2")],
  });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: 1 });
  assert.equal(fake.state.calls.length, subrequestBudget(1)); // 5 + 2 = 7

  const attendanceWrite = fake.state.writes.find((write) => write.table === "meeting_attendance");
  assert.equal(attendanceWrite.rows.length, 2);
  assert.equal(attendanceWrite.onConflict, "session_id,employee_id");
  assert.equal(attendanceWrite.search, "?on_conflict=session_id%2Cemployee_id");
  assert.equal(attendanceWrite.prefer.includes("resolution=ignore-duplicates"), true);
  assert.equal(attendanceWrite.prefer.includes("return=representation"), false);
  assert.equal(attendanceWrite.hasSelect, false);
  assert.deepEqual(attendanceWrite.rows[0], {
    session_id: "s1",
    employee_id: "e1",
    status_code: "not_attended",
    reason: null,
    shift: null,
    department_id: "dept-1",
    position_id: "pos-1",
    registered_at: attendanceWrite.rows[0].registered_at,
  });
  assert.match(attendanceWrite.rows[0].registered_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    attendanceWrite.rows[0].registered_at,
    attendanceWrite.rows[1].registered_at, // one stamp per run
  );

  const auditWrite = fake.state.writes.find((write) => write.table === "audit_logs");
  assert.equal(auditWrite.rows.length, 1);
  assert.deepEqual(auditWrite.rows[0], {
    actor_id: null,
    action: "auto_absent_done",
    entity: "meeting_session",
    entity_id: "s1",
    detail: JSON.stringify({ count: 2 }),
  });
  assert.equal(fake.state.auditLogs.length, 1);
});

test("ten due sessions share one attendance upsert and one marker insert", async (t) => {
  const sessions = [];
  for (let index = 1; index <= 10; index += 1) {
    sessions.push(sessionRow(`s${String(index).padStart(2, "0")}`));
  }
  const fake = createBackend({
    sessions,
    roster: [rosterRow("e1"), rosterRow("e2"), rosterRow("e3")],
  });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: 10 });
  assert.equal(fake.state.calls.length, subrequestBudget(10)); // 5 + 2 = 7
  assert.equal(fake.state.writes.length, 2); // one attendance upsert, one audit insert
  assert.equal(fake.state.attendance.length, 30);
  assert.equal(fake.state.writes.find((w) => w.table === "meeting_attendance").rows.length, 30);
  assert.equal(fake.state.writes.find((w) => w.table === "audit_logs").rows.length, 10);
  assert.equal(fake.state.auditLogs.length, 10);
  assert.equal(fake.state.auditLogs.every((row) => JSON.parse(row.detail).count === 3), true);
});

test("eleven due sessions: ten this run, the last one on the next run", async (t) => {
  const sessions = [];
  for (let index = 1; index <= 11; index += 1) {
    sessions.push(sessionRow(`s${String(index).padStart(2, "0")}`));
  }
  const fake = createBackend({ sessions, roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  const first = await runAutoAbsentOnce(ENV, NOW);
  assert.deepEqual(first, { processed: BATCH_LIMIT });
  assert.equal(fake.state.auditLogs.length, 10);
  assert.equal(fake.state.calls.length, subrequestBudget(10));

  const callsBefore = fake.state.calls.length;
  const second = await runAutoAbsentOnce(ENV, NOW);
  assert.deepEqual(second, { processed: 1 });
  assert.equal(fake.state.calls.length - callsBefore, subrequestBudget(1));
  assert.equal(fake.state.auditLogs.length, 11);
  assert.deepEqual(
    fake.state.auditLogs.map((row) => row.entity_id),
    sessions.map((session) => session.id),
  );
  assert.equal(fake.state.attendance.length, 11);
});

test("twenty-five due sessions drain across runs without loss or duplicates", async (t) => {
  const sessions = [];
  for (let index = 1; index <= 25; index += 1) {
    sessions.push(sessionRow(`s${String(index).padStart(2, "0")}`));
  }
  const fake = createBackend({ sessions, roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  const processedPerRun = [];
  for (let run = 0; run < 4; run += 1) {
    const callsBefore = fake.state.calls.length;
    const result = await runAutoAbsentOnce(ENV, NOW);
    processedPerRun.push(result.processed);
    const calls = fake.state.calls.length - callsBefore;
    assert.equal(calls <= 50, true); // free-plan subrequest ceiling
    assert.equal(calls <= subrequestBudget(BATCH_LIMIT), true);
  }

  assert.deepEqual(processedPerRun, [10, 10, 5, 0]);
  const markedIds = fake.state.auditLogs.map((row) => row.entity_id);
  assert.equal(markedIds.length, 25);
  assert.equal(new Set(markedIds).size, 25); // nothing written twice
  const attendanceKeys = fake.state.attendance.map((row) => `${row.session_id}:${row.employee_id}`);
  assert.equal(new Set(attendanceKeys).size, 25);
});

test("creating the sup session costs one extra subrequest", async (t) => {
  const fake = createBackend({
    types: [MONDAY_SUP_TYPE, MONTHLY_TYPE],
    sessions: [],
    roster: [rosterRow("e1")],
  });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: 1 });
  assert.equal(fake.state.calls.length, subrequestBudget(1, { createsSupSession: true })); // 9

  const createWrite = fake.state.writes.find((write) => write.table === "meeting_sessions");
  assert.equal(createWrite.onConflict, "meeting_type_id,session_date");
  assert.equal(
    createWrite.search,
    "?on_conflict=meeting_type_id%2Csession_date&select=id,%20meeting_type_id,%20session_date,%20cutoff_time"
  );
  assert.equal(createWrite.prefer.includes("resolution=ignore-duplicates"), true);
  // The created row is requested back so this same run can mark it.
  assert.equal(createWrite.prefer.includes("return=representation"), true);
  assert.equal(createWrite.hasSelect, true);
  assert.deepEqual(createWrite.rows, [
    {
      meeting_type_id: SUP_TYPE.id,
      session_date: TODAY,
      cycle_key: `sup-${TODAY}`,
      open_time: "09:00",
      cutoff_time: "12:00",
    },
  ]);
  assert.equal(fake.state.auditLogs.length, 1);
  assert.equal(fake.state.auditLogs[0].entity_id, "created-1");
});

test("a second run writes nothing new", async (t) => {
  const fake = createBackend({
    sessions: [sessionRow("s1")],
    roster: [rosterRow("e1")],
  });
  t.after(() => fake.restore());

  await runAutoAbsentOnce(ENV, NOW);
  const writesAfterFirst = fake.state.writes.length;
  const callsBefore = fake.state.calls.length;

  const second = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(second, { processed: 0 });
  assert.equal(fake.state.writes.length, writesAfterFirst);
  assert.equal(fake.state.calls.length - callsBefore, 3); // types, sessions, markers
  assert.equal(fake.state.auditLogs.length, 1);
  assert.equal(fake.state.attendance.length, 1);
});

test("a session with nobody missing still gets a marker and is not retried", async (t) => {
  const fake = createBackend({
    sessions: [sessionRow("s1")],
    roster: [rosterRow("e1")],
    attendance: [{ session_id: "s1", employee_id: "e1", status_code: "attended" }],
  });
  t.after(() => fake.restore());

  const first = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(first, { processed: 1 });
  assert.equal(fake.state.writes.filter((w) => w.table === "meeting_attendance").length, 0);
  assert.deepEqual(fake.state.auditLogs[0], {
    actor_id: null,
    action: "auto_absent_done",
    entity: "meeting_session",
    entity_id: "s1",
    detail: JSON.stringify({ count: 0 }),
  });

  const second = await runAutoAbsentOnce(ENV, NOW);
  assert.deepEqual(second, { processed: 0 });
  assert.equal(fake.state.auditLogs.length, 1);
});

test("an attendance row registered by an employee is never overwritten", async (t) => {
  const fake = createBackend({
    sessions: [sessionRow("s1")],
    roster: [rosterRow("e1"), rosterRow("e2")],
    attendance: [
      {
        session_id: "s1",
        employee_id: "e1",
        status_code: "attended",
        registered_at: "2026-01-05T04:00:00.000Z",
      },
    ],
  });
  t.after(() => fake.restore());

  await runAutoAbsentOnce(ENV, NOW);

  const rows = fake.state.writes.find((write) => write.table === "meeting_attendance").rows;
  assert.deepEqual(rows.map((row) => row.employee_id), ["e2"]);
  const attended = fake.state.attendance.find((row) => row.employee_id === "e1");
  assert.equal(attended.status_code, "attended");
  assert.equal(attended.registered_at, "2026-01-05T04:00:00.000Z");
});

test("a failed skip-date read is fail-closed and logs only the code", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = createBackend({
    types: [MONDAY_SUP_TYPE, MONTHLY_TYPE],
    sessions: [sessionRow("s1")],
    roster: [rosterRow("e1")],
    fail: ["meeting_skip_dates"],
  });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: 0 });
  assert.equal(fake.state.calls.length, 2); // types, skip dates
  assert.equal(fake.state.writes.length, 0); // no session, no attendance, no marker
  assert.equal(fake.state.auditLogs.length, 0);

  const logged = logs.join("\n");
  assert.equal(logged.includes("XX000"), true);
  assert.equal(logged.includes("fake-service-role-key"), false);
  assert.equal(logged.includes("fake-project.supabase.co"), false);
});

test("audit markers are read 100 ids per call and stay far below 50 subrequests", async (t) => {
  const sessions = [];
  for (let index = 1; index <= 150; index += 1) {
    sessions.push(sessionRow(`d${String(index).padStart(3, "0")}`));
  }
  const fake = createBackend({ sessions, roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  const result = await runAutoAbsentOnce(ENV, NOW);

  assert.deepEqual(result, { processed: BATCH_LIMIT });
  // 1 types + 1 sessions + 2 marker chunks + 1 roster + 1 attendance read
  // + 1 attendance upsert + 1 marker insert (skip dates gated off)
  assert.equal(fake.state.calls.length, 8);
  assert.equal(fake.state.calls.length <= 50, true);
  const markerCalls = fake.state.calls.filter(
    (call) => tableOf(call.url) === "audit_logs" && (call.init.method ?? "GET") === "GET",
  );
  assert.equal(markerCalls.length, 2);
});

test("an invalid now value does nothing", async (t) => {
  const fake = createBackend({ sessions: [sessionRow("s1")], roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  assert.deepEqual(await runAutoAbsentOnce(ENV, new Date(Number.NaN)), { processed: 0 });
  assert.equal(fake.state.calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* scheduled() dispatch                                               */
/* ------------------------------------------------------------------ */

function collector() {
  const pending = [];
  return { pending, ctx: { waitUntil(promise) { pending.push(promise); } } };
}

test("scheduled() runs auto-absent from event.scheduledTime", async (t) => {
  const fake = createBackend({ sessions: [sessionRow("s1")], roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: AUTO_ABSENT_CRON, scheduledTime: NOW_ISO }, ENV, ctx);
  assert.equal(pending.length, 1);
  await pending[0];

  // The real clock is years away from the fixture date, so a marker proves the
  // run used event.scheduledTime and not Date.now().
  assert.equal(fake.state.auditLogs.length, 1);
  assert.equal(fake.state.auditLogs[0].entity_id, "s1");
});

test("scheduled() ignores an unknown cron string", async (t) => {
  const fake = createBackend({ sessions: [sessionRow("s1")], roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: "5 5 * * *", scheduledTime: NOW_ISO }, ENV, ctx);
  assert.equal(pending.length, 0);
  assert.equal(fake.state.calls.length, 0);
});

test("scheduled() swallows a run error after logging its code", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = createBackend({ fail: ["meeting_types"] });
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: AUTO_ABSENT_CRON, scheduledTime: NOW_ISO }, ENV, ctx);
  await pending[0]; // a failed run must not reject waitUntil

  const logged = logs.join("\n");
  assert.equal(logged.includes("XX000"), true);
  assert.equal(logged.includes("fake-service-role-key"), false);
});

/* ------------------------------------------------------------------ */
/* db.js options                                                      */
/* ------------------------------------------------------------------ */

test("db.upsert keeps merge-duplicates by default", async (t) => {
  const fake = createBackend();
  t.after(() => fake.restore());

  const db = createDb(ENV);
  await db.upsert("meeting_attendance", { a: 1 }, { conflict: "session_id,employee_id" });

  const write = fake.state.writes[0];
  assert.equal(write.prefer, "return=representation,resolution=merge-duplicates");
  assert.equal(write.onConflict, "session_id,employee_id");
  assert.equal(write.search, "?on_conflict=session_id%2Cemployee_id&select=*");
  assert.equal(write.hasSelect, true);
});

test("db.insert accepts an array body with ignoreDuplicates", async (t) => {
  const fake = createBackend();
  t.after(() => fake.restore());

  const db = createDb(ENV);
  await db.insert("audit_logs", [{ a: 1 }, { a: 2 }], { ignoreDuplicates: true });

  const write = fake.state.writes[0];
  assert.deepEqual(write.rows, [{ a: 1 }, { a: 2 }]);
  assert.equal(write.prefer, "resolution=ignore-duplicates");
});
