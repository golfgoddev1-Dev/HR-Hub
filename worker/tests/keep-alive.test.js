import test from "node:test";
import assert from "node:assert/strict";

import { AUTO_ABSENT_CRON } from "../src/auto-absent.js";
import { KEEP_ALIVE_CRON, runKeepAlive } from "../src/keep-alive.js";
import worker from "../src/index.js";

// Fake project values. Not real credentials or employee data.
const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

const NOW_ISO = "2026-01-05T05:30:00.000Z";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function collector() {
  const pending = [];
  return { pending, ctx: { waitUntil(promise) { pending.push(promise); } } };
}

/* ------------------------------------------------------------------ */
/* runKeepAlive                                                       */
/* ------------------------------------------------------------------ */

test("keep-alive issues exactly one read and writes nothing", async (t) => {
  const fake = installFetch(() => jsonResponse([{ id: "type-sup" }]));
  t.after(() => fake.restore());

  await runKeepAlive(ENV);

  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.init.method, "GET");
  assert.equal(tableOf(call.url), "meeting_types");
  assert.equal(call.init.body, undefined);

  const params = new URL(call.url).searchParams;
  assert.equal(params.get("select"), "id");
  assert.equal(params.get("limit"), "1");
  assert.equal(params.has("order"), false);
  assert.equal(params.has("on_conflict"), false);
  assert.equal(params.has("onConflict"), false);
});

test("a failing read is caught and logs only the fixed message and status", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = installFetch(() =>
    jsonResponse({ code: "XX000", message: "body-marker-123" }, 503),
  );
  t.after(() => fake.restore());

  await assert.doesNotReject(() => runKeepAlive(ENV));

  assert.deepEqual(logs, ["keep-alive failed status=503"]);
  assert.equal(logs[0].includes("body-marker-123"), false);
  assert.equal(logs[0].includes("XX000"), false);
  assert.equal(logs[0].includes("fake-service-role-key"), false);
  assert.equal(logs[0].includes("fake-project.supabase.co"), false);
});

test("a transport failure is caught and logs the fixed message alone", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = installFetch(() => {
    throw new TypeError("network down body-marker-456");
  });
  t.after(() => fake.restore());

  await assert.doesNotReject(() => runKeepAlive(ENV));

  assert.deepEqual(logs, ["keep-alive failed"]);
  assert.equal(logs[0].includes("body-marker-456"), false);
});

test("a healthy run logs nothing", async (t) => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args.join(" ")));

  const fake = installFetch(() => jsonResponse([]));
  t.after(() => fake.restore());

  await runKeepAlive(ENV);

  assert.deepEqual(logs, []);
});

/* ------------------------------------------------------------------ */
/* scheduled() dispatch                                               */
/* ------------------------------------------------------------------ */

test("the 0 1,9,17 cron dispatches keep-alive and not auto-absent", async (t) => {
  const fake = installFetch(() => jsonResponse([{ id: "type-sup" }]));
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: KEEP_ALIVE_CRON, scheduledTime: NOW_ISO }, ENV, ctx);
  assert.equal(pending.length, 1);
  await pending[0];

  assert.equal(fake.calls.length, 1);
  assert.equal(tableOf(fake.calls[0].url), "meeting_types");
  assert.equal(new URL(fake.calls[0].url).searchParams.get("limit"), "1");
  assert.equal(fake.calls.some((call) => tableOf(call.url) === "meeting_skip_dates"), false);
  assert.equal(fake.calls.some((call) => tableOf(call.url) === "meeting_sessions"), false);
});

test("the every-minute cron dispatches auto-absent and not keep-alive", async (t) => {
  const at = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

  const tables = {
    meeting_types: [
      {
        id: "type-sup",
        code: "sup",
        weekday: null,
        default_open_time: "09:00:00",
        default_cutoff_time: "12:00:00",
      },
    ],
    meeting_skip_dates: [],
    meeting_sessions: [
      { id: "s1", meeting_type_id: "type-sup", session_date: today, cutoff_time: "00:00:00" },
    ],
    meeting_roster: [
      {
        meeting_type_id: "type-sup",
        employee_id: "e1",
        is_active: true,
        employees: { department_id: "d1", position_id: "p1" },
      },
    ],
    meeting_attendance: [],
    audit_logs: [],
  };

  const writes = [];
  const fake = installFetch(({ url, init }) => {
    const table = tableOf(url);
    if ((init.method ?? "GET") === "GET") return jsonResponse(tables[table] ?? []);
    writes.push({ table, body: JSON.parse(init.body ?? "[]") });
    return new Response("", { status: 201 });
  });
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: AUTO_ABSENT_CRON, scheduledTime: at.toISOString() }, ENV, ctx);
  await pending[0];

  assert.equal(writes.length, 2); // batched attendance upsert, then the markers
  assert.equal(writes[0].table, "meeting_attendance");
  assert.equal(writes[0].body.length, 1);
  assert.equal(writes[1].table, "audit_logs");
  assert.equal(writes[1].body.length, 1);

  // The keep-alive read is the only bare `select=id&limit=1` call; auto-absent's
  // meeting_types read filters by code and asks for more columns.
  const typesParams = new URL(
    fake.calls.find((call) => tableOf(call.url) === "meeting_types").url,
  ).searchParams;
  assert.equal(typesParams.has("code"), true);
  assert.equal(typesParams.has("limit"), false);
});

test("an unknown cron returns with no effect and no request", async (t) => {
  const fake = installFetch(() => jsonResponse([]));
  t.after(() => fake.restore());

  const { pending, ctx } = collector();
  worker.scheduled({ cron: "5 5 * * *", scheduledTime: NOW_ISO }, ENV, ctx);

  assert.equal(pending.length, 0);
  assert.equal(fake.calls.length, 0);
});
