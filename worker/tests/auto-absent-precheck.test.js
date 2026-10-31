import test from "node:test";
import assert from "node:assert/strict";

import {
  precheckAutoAbsent,
  runAutoAbsentOnce,
  supRulePossible,
} from "../src/auto-absent.js";

// Fake project values. Not real credentials or employee data.
const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

// Monday 5 January 2026. Bangkok is UTC+7, so 12:00 Bangkok = 05:00Z.
const TODAY = "2026-01-05";
const YESTERDAY = "2026-01-04";
const TWO_DAYS_AGO = "2026-01-03";
const NOW = new Date("2026-01-05T05:30:00.000Z"); // 12:30 Bangkok
const BEFORE_CUTOFF = new Date("2026-01-05T04:00:00.000Z"); // 11:00 Bangkok
const AT_CUTOFF = new Date("2026-01-05T05:00:00.000Z"); // 12:00 Bangkok
const JUST_AFTER_CUTOFF = new Date("2026-01-05T05:01:00.000Z"); // 12:01 Bangkok
const JUST_AFTER_MIDNIGHT = new Date("2026-01-04T17:05:00.000Z"); // 00:05 Bangkok on the 5th

const SUP = {
  id: "type-sup",
  code: "sup",
  weekday: 1, // Monday
  default_open_time: "09:00:00",
  default_cutoff_time: "12:00:00",
};
const SUP_WEDNESDAY = { ...SUP, weekday: 3 };
const SUP_NO_WEEKDAY = { ...SUP, weekday: null };
const SUP_UNPARSEABLE_CUTOFF = { ...SUP, default_cutoff_time: "nope" };
const MONTHLY = {
  id: "type-monthly",
  code: "monthly",
  weekday: null,
  default_open_time: "09:00:00",
  default_cutoff_time: "12:00:00",
};

function sessionRow(id, overrides = {}) {
  return {
    id,
    meeting_type_id: SUP.id,
    session_date: TODAY,
    cutoff_time: "12:00:00",
    ...overrides,
  };
}

function rosterRow(employeeId, overrides = {}) {
  return {
    meeting_type_id: SUP.id,
    employee_id: employeeId,
    is_active: true,
    employees: { department_id: "dept-1", position_id: "pos-1" },
    ...overrides,
  };
}

function markerRow(sessionId, count = 1) {
  return {
    actor_id: null,
    action: "auto_absent_done",
    entity: "meeting_session",
    entity_id: sessionId,
    detail: JSON.stringify({ count }),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

/** eq / gte / lte / is.null / in.(...) filter check against a fake row. */
function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (key === "select" || key === "order" || key === "limit" || key === "onConflict") continue;
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
 * Fake PostgREST with the write semantics of the real endpoints: an upsert with
 * resolution=ignore-duplicates never overwrites, and every call is recorded.
 */
function createBackend(options = {}) {
  const state = {
    types: options.types ?? [SUP, MONTHLY],
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
    state.writes.push({ table, rows, prefer });

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
      return jsonResponse(new URL(call.url).searchParams.has("select") ? inserted : rows, 201);
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

/** Every written row, order-insensitive, projected to the columns that matter. */
function snapshot(state) {
  const sortKey = (row) => JSON.stringify(row);
  return {
    sessions: state.sessions
      .map((row) => ({
        meeting_type_id: row.meeting_type_id,
        session_date: row.session_date,
        cycle_key: row.cycle_key ?? null,
        open_time: row.open_time ?? null,
        cutoff_time: row.cutoff_time ?? null,
      }))
      .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)),
    attendance: state.attendance.map((row) => ({ ...row })).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
    audit: state.auditLogs.map((row) => ({ ...row })).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1)),
  };
}

/* ------------------------------------------------------------------ */
/* supRulePossible: when the skip-date read can be dropped             */
/* ------------------------------------------------------------------ */

test("supRulePossible is false only when the sup rule provably cannot fire", () => {
  const supType = SUP;
  assert.equal(supRulePossible({ now: NOW, supType, todayKey: TODAY }), true); // Monday after cutoff
  assert.equal(supRulePossible({ now: AT_CUTOFF, supType, todayKey: TODAY }), true); // exactly at
  assert.equal(supRulePossible({ now: BEFORE_CUTOFF, supType, todayKey: TODAY }), false); // before
  assert.equal(supRulePossible({ now: NOW, supType: SUP_WEDNESDAY, todayKey: TODAY }), false); // weekday
  assert.equal(supRulePossible({ now: NOW, supType: SUP_NO_WEEKDAY, todayKey: TODAY }), false); // no weekday
  assert.equal(supRulePossible({ now: NOW, supType: null, todayKey: TODAY }), false); // no sup row
  // Fail open: a value the rule cannot interpret keeps the read.
  assert.equal(
    supRulePossible({ now: NOW, supType: SUP_UNPARSEABLE_CUTOFF, todayKey: TODAY }),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* Parity: precheck verdict vs the full run, scenario by scenario      */
/* ------------------------------------------------------------------ */

const SCENARIOS = [
  ["weekday before the sup cutoff", () => ({ now: BEFORE_CUTOFF, types: [SUP], sessions: [] })],
  ["exactly at the sup cutoff", () => ({ now: AT_CUTOFF, types: [SUP], sessions: [] })],
  ["just after the sup cutoff", () => ({ now: JUST_AFTER_CUTOFF, types: [SUP], sessions: [] })],
  [
    "sup cutoff passed but today is a skip date",
    () => ({ now: NOW, types: [SUP], skipDates: [TODAY], sessions: [] }),
  ],
  [
    "sup session already created by an earlier run",
    () => ({ now: NOW, types: [SUP], sessions: [sessionRow("sup-1")], roster: [rosterRow("e1")] }),
  ],
  [
    "due session, never marked",
    () => ({ now: NOW, types: [SUP], sessions: [sessionRow("s1")], roster: [rosterRow("e1")] }),
  ],
  [
    "due session already marked",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [sessionRow("s1")],
      auditLogs: [markerRow("s1")],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    "due session with an empty roster",
    () => ({ now: NOW, types: [SUP], sessions: [sessionRow("s1")], roster: [] }),
  ],
  ["no sessions at all", () => ({ now: NOW, types: [SUP, MONTHLY], sessions: [] })],
  [
    "yesterday's unmarked session is still inside the 48-hour window",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [sessionRow("s1", { session_date: YESTERDAY, cutoff_time: "18:00:00" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    // The counterexample to a cutoff-time-only precheck: every cutoff today is
    // still in the future, yet yesterday's session is due and unmarked.
    "before today's cutoff, but yesterday's session is due",
    () => ({
      now: BEFORE_CUTOFF,
      types: [SUP],
      sessions: [sessionRow("s1", { session_date: YESTERDAY, cutoff_time: "18:00:00" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    "session more than 48 hours past its cutoff",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [sessionRow("s-old", { session_date: TWO_DAYS_AGO, cutoff_time: "00:00:00" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    "session of a meeting type the job does not handle",
    () => ({
      now: NOW,
      types: [SUP, MONTHLY],
      sessions: [sessionRow("s1", { meeting_type_id: "type-training" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    "sup type without a weekday",
    () => ({ now: NOW, types: [SUP_NO_WEEKDAY], sessions: [sessionRow("s1")], roster: [rosterRow("e1")] }),
  ],
  [
    "unparseable session cutoff falls back to the type default",
    () => ({ now: NOW, types: [SUP], sessions: [sessionRow("s1", { cutoff_time: null })], roster: [rosterRow("e1")] }),
  ],
  [
    "both roster rows missing, one already attended",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [sessionRow("s1")],
      roster: [rosterRow("e1"), rosterRow("e2")],
      attendance: [{ session_id: "s1", employee_id: "e1", status_code: "attended" }],
    }),
  ],
  [
    "just after Bangkok midnight",
    () => ({
      now: JUST_AFTER_MIDNIGHT,
      types: [SUP],
      sessions: [sessionRow("s1", { cutoff_time: "00:00:00" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    // Existence is proven from the loaded row, so the sup upsert is skipped and
    // the manual fields must stay exactly as they are.
    "sup session present with different fields",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [sessionRow("sup-manual", { cutoff_time: "08:00:00", open_time: "07:00:00", cycle_key: "manual" })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    // Same date, other type: not proof that the sup session exists.
    "monthly session today, no sup session",
    () => ({
      now: NOW,
      types: [SUP, MONTHLY],
      sessions: [sessionRow("m1", { meeting_type_id: MONTHLY.id })],
      roster: [rosterRow("e1")],
    }),
  ],
  [
    // A loaded row with no meeting_type_id proves nothing, so the upsert stays.
    "session row missing its meeting_type_id",
    () => ({
      now: NOW,
      types: [SUP],
      sessions: [{ id: "s-notype", session_date: TODAY, cutoff_time: "12:00:00" }],
      roster: [rosterRow("e1")],
    }),
  ],
];

test("the precheck never skips a write, and the gate never changes one", async (t) => {
  for (const [name, options] of SCENARIOS) {
    await t.test(name, async (sub) => {
      const { now } = options();
      sub.mock.timers.enable({ apis: ["Date"], now: now.getTime() });

      // Store A: precheck first (read-only), then the real tick.
      const gated = createBackend(options());
      sub.after(() => gated.restore());
      const verdict = await precheckAutoAbsent(ENV, now);
      assert.equal(gated.state.writes.length, 0, "the precheck must not write");
      const gatedResult = await runAutoAbsentOnce(ENV, now);

      // Store B: the same tick with the pre-4c read sequence (skip dates always).
      const ungated = createBackend(options());
      sub.after(() => ungated.restore());
      const ungatedResult = await runAutoAbsentOnce(ENV, now, { skipDateGate: false });

      assert.deepEqual(snapshot(gated.state), snapshot(ungated.state), `writes differ: ${name}`);
      assert.deepEqual(gatedResult, ungatedResult, `result differs: ${name}`);

      if (verdict.nothingToDo) {
        assert.equal(gated.state.writes.length, 0, `skipped but wrote: ${name}`);
        assert.deepEqual(gatedResult, { processed: 0 }, `skipped but processed: ${name}`);
      }
    });
  }
});

test("the precheck drops the skip-date read only when the sup rule cannot fire", async (t) => {
  const closed = createBackend({ now: NOW, types: [SUP_WEDNESDAY], sessions: [] });
  t.after(() => closed.restore());
  const skipped = await precheckAutoAbsent(ENV, NOW);
  assert.deepEqual(skipped, { nothingToDo: true, reason: "no-due-session" });
  assert.deepEqual(closed.state.calls.map((call) => tableOf(call.url)), [
    "meeting_types",
    "meeting_sessions",
  ]);
  assert.equal(closed.state.writes.length, 0);

  const open = createBackend({ now: NOW, types: [SUP], sessions: [] });
  t.after(() => open.restore());
  const work = await precheckAutoAbsent(ENV, NOW);
  assert.deepEqual(work, { nothingToDo: false, reason: "sup-session" });
  assert.deepEqual(open.state.calls.map((call) => tableOf(call.url)), [
    "meeting_types",
    "meeting_skip_dates",
    "meeting_sessions",
  ]);
  assert.equal(open.state.writes.length, 0);
});

test("the precheck reads skip dates when the sup cutoff cannot be parsed", async (t) => {
  const fake = createBackend({ types: [SUP_UNPARSEABLE_CUTOFF], sessions: [] });
  t.after(() => fake.restore());

  const verdict = await precheckAutoAbsent(ENV, NOW);

  assert.equal(verdict.nothingToDo, true); // the rule itself cannot fire
  assert.equal(fake.state.calls.some((call) => tableOf(call.url) === "meeting_skip_dates"), true);
  assert.deepEqual(await runAutoAbsentOnce(ENV, NOW), { processed: 0 });
  assert.equal(fake.state.writes.length, 0);
});

test("a failing skip-date read ends the tick without writing", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = createBackend({ types: [SUP], sessions: [], fail: ["meeting_skip_dates"] });
  t.after(() => fake.restore());

  const verdict = await precheckAutoAbsent(ENV, NOW);
  assert.deepEqual(verdict, { nothingToDo: true, reason: "skip-dates" });

  assert.deepEqual(await runAutoAbsentOnce(ENV, NOW), { processed: 0 });
  assert.equal(fake.state.writes.length, 0);
  assert.equal(logs.join("\n").includes("XX000"), true);
});

test("an invalid clock is skipped by both paths", async (t) => {
  const fake = createBackend({ types: [SUP], sessions: [sessionRow("s1")] });
  t.after(() => fake.restore());

  assert.deepEqual(await precheckAutoAbsent(ENV, new Date(Number.NaN)), {
    nothingToDo: true,
    reason: "clock",
  });
  assert.deepEqual(await runAutoAbsentOnce(ENV, new Date(Number.NaN)), { processed: 0 });
  assert.equal(fake.state.calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* Fix 1: the sup upsert runs only when the loaded read does not prove  */
/* that today's sup session already exists.                            */
/* ------------------------------------------------------------------ */

/** POSTs to meeting_sessions: one means "an upsert was issued". */
function sessionPosts(state) {
  return state.writes.filter((write) => write.table === "meeting_sessions");
}

test("the sup upsert is skipped only when the window read proves the row exists", async (t) => {
  const base = () => ({ types: [SUP], roster: [rosterRow("e1")] });
  const cases = [
    ["absent, so it must be created", { sessions: [] }, 1],
    ["present with the same fields", { sessions: [sessionRow("sup-1")] }, 0],
    [
      "present with different fields",
      { sessions: [sessionRow("sup-manual", { cutoff_time: "08:00:00", open_time: "07:00:00", cycle_key: "manual" })] },
      0,
    ],
    [
      "monthly session on the same date only",
      { types: [SUP, MONTHLY], sessions: [sessionRow("m1", { meeting_type_id: MONTHLY.id })] },
      1,
    ],
    [
      "loaded row without a meeting_type_id",
      { sessions: [{ id: "s-notype", session_date: TODAY, cutoff_time: "12:00:00" }] },
      1,
    ],
  ];

  for (const [name, options, expectedPosts] of cases) {
    await t.test(name, async (sub) => {
      sub.mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });

      const gated = createBackend({ now: NOW, ...base(), ...options });
      sub.after(() => gated.restore());
      const gatedResult = await runAutoAbsentOnce(ENV, NOW);
      const gatedPosts = sessionPosts(gated.state).length;

      const ungated = createBackend({ now: NOW, ...base(), ...options });
      sub.after(() => ungated.restore());
      const ungatedResult = await runAutoAbsentOnce(ENV, NOW, { skipDateGate: false });
      const ungatedPosts = sessionPosts(ungated.state).length;

      assert.equal(gatedPosts, expectedPosts, `upsert count: ${name}`);
      // The comparison is against a tick that really issues the no-op upsert.
      assert.equal(ungatedPosts, 1, `ungated tick must upsert: ${name}`);
      assert.deepEqual(snapshot(gated.state), snapshot(ungated.state), `rows differ: ${name}`);
      assert.deepEqual(gatedResult, ungatedResult, `result differs: ${name}`);
    });
  }
});

test("a manual sup row keeps its fields when the upsert is skipped", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW.getTime() });
  const manual = sessionRow("sup-manual", {
    cutoff_time: "08:00:00",
    open_time: "07:00:00",
    cycle_key: "manual",
  });
  const fake = createBackend({ types: [SUP], sessions: [manual], roster: [rosterRow("e1")] });
  t.after(() => fake.restore());

  assert.deepEqual(await runAutoAbsentOnce(ENV, NOW), { processed: 1 });
  assert.equal(sessionPosts(fake.state).length, 0);
  assert.deepEqual(fake.state.sessions, [manual]);
  assert.equal(fake.state.attendance.length, 1);
  assert.equal(fake.state.attendance[0].session_id, "sup-manual");
});

const SUP_WINDOW_TICKS = 720; // 12:00 to 23:59 Asia/Bangkok, one tick per minute

test("twelve hours of sup-weekday ticks issue the sup upsert once", async (t) => {
  const start = AT_CUTOFF.getTime();
  const options = () => ({ types: [SUP], sessions: [], roster: [rosterRow("e1"), rosterRow("e2")] });
  t.mock.timers.enable({ apis: ["Date"], now: start });

  async function simulate(skipDateGate) {
    const backend = createBackend(options());
    const results = [];
    const callsPerTick = [];
    try {
      for (let index = 0; index < SUP_WINDOW_TICKS; index += 1) {
        const now = new Date(start + index * 60_000);
        t.mock.timers.setTime(now.getTime());
        const before = backend.state.calls.length;
        results.push(await runAutoAbsentOnce(ENV, now, { skipDateGate }));
        callsPerTick.push(backend.state.calls.length - before);
      }
      return {
        rows: snapshot(backend.state),
        processed: results.map((result) => result.processed),
        posts: sessionPosts(backend.state).length,
        callsPerTick,
      };
    } finally {
      backend.restore();
    }
  }

  const gated = await simulate(true);
  const ungated = await simulate(false);

  assert.equal(gated.posts, 1, "one creation, no repeated no-op upserts");
  assert.equal(ungated.posts, SUP_WINDOW_TICKS, "the ungated path still upserts every tick");
  assert.deepEqual(gated.rows, ungated.rows, "rows must not depend on the upsert gate");
  assert.deepEqual(gated.processed, ungated.processed, "per-tick results must match");

  assert.equal(gated.processed[0], 1); // the tick that creates also marks
  assert.equal(gated.processed.slice(1).every((count) => count === 0), true);
  assert.equal(gated.rows.attendance.length, 2);
  assert.equal(gated.rows.audit.length, 1);

  // Creation tick: types, skip dates, sessions, upsert, marker, roster,
  // attendance read, attendance write, audit insert.
  assert.equal(gated.callsPerTick[0], 9);
  // Steady tick: types, skip dates, sessions, marker read. No upsert.
  assert.equal(gated.callsPerTick[300], 4);
  // Same tick before the fix, with the no-op upsert: one request more.
  assert.equal(ungated.callsPerTick[300], 5);
});
