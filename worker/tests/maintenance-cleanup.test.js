import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { CERT_CLEANUP_CRON } from "../src/leave-retention.js";
import {
  AUDIT_RETENTION_DAYS,
  AUTH_SESSION_RETENTION_DAYS,
  CLEANUP_BATCH_SIZE,
  CLEANUP_MAX_ROWS,
  purgeOldAuditLogs,
  purgeOldAuthSessions,
  retentionCutoff,
} from "../src/maintenance/cleanup.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const AUTH_CUTOFF = retentionCutoff(NOW, AUTH_SESSION_RETENTION_DAYS);
const AUDIT_CUTOFF = retentionCutoff(NOW, AUDIT_RETENTION_DAYS);

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
};

function matches(row, filters) {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "eq") return actual === value;
    if (op === "lt") return actual !== null && actual !== undefined && actual < value;
    if (op === "is") return value === null ? actual === null || actual === undefined : actual === value;
    if (op === "not.is") return value === null ? actual !== null && actual !== undefined : actual !== value;
    if (op === "in") return Array.isArray(value) && value.includes(actual);
    throw new Error(`unsupported test filter: ${op}`);
  });
}

function createFakeDb({ sessions = [], auditLogs = [], failAuth = false } = {}) {
  const state = {
    auth_sessions: [...sessions],
    audit_logs: [...auditLogs],
  };
  const calls = [];

  return {
    calls,
    state,
    async select(table, options = {}) {
      calls.push({ method: "select", table, options });
      if (failAuth && table === "auth_sessions") {
        throw Object.assign(
          new Error("secret-token-marker 203.0.113.9 Somchai"),
          { name: "DbError", code: "XX000" }
        );
      }

      let rows = state[table].filter((row) => matches(row, options.filters ?? []));
      if (typeof options.order === "string") {
        const [column, direction] = options.order.split(".");
        rows = [...rows].sort((a, b) => {
          const left = String(a[column] ?? "");
          const right = String(b[column] ?? "");
          return left.localeCompare(right) * (direction === "desc" ? -1 : 1);
        });
      }
      if (typeof options.limit === "number") rows = rows.slice(0, options.limit);
      return rows.map((row) => ({ id: row.id }));
    },
    async remove(table, filters = [], options = {}) {
      calls.push({ method: "remove", table, filters, options });
      const ids = filters.find(([column, op]) => column === "id" && op === "in")?.[2] ?? [];
      const removed = state[table].filter((row) => ids.includes(row.id));
      state[table] = state[table].filter((row) => !ids.includes(row.id));
      return {
        data: options.returning ? removed.map((row) => ({ id: row.id })) : [],
        error: null,
      };
    },
  };
}

function sessionRows() {
  return [
    {
      id: "expired-old",
      expires_at: "2026-04-01T00:00:00.000Z",
      revoked_at: null,
    },
    {
      id: "revoked-old",
      expires_at: "2026-07-01T00:00:00.000Z",
      revoked_at: "2026-04-15T00:00:00.000Z",
    },
    {
      id: "active",
      expires_at: "2026-07-01T00:00:00.000Z",
      revoked_at: null,
    },
    {
      id: "revoked-recent",
      expires_at: "2026-07-01T00:00:00.000Z",
      revoked_at: "2026-05-20T00:00:00.000Z",
    },
  ];
}

test("purgeOldAuthSessions deletes old expired and old revoked rows", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (...args) => logs.push(args));

  const fake = createFakeDb({ sessions: sessionRows() });
  const deleted = await purgeOldAuthSessions(fake, NOW);

  assert.equal(deleted, 2);
  assert.deepEqual(
    fake.state.auth_sessions.map((row) => row.id).sort(),
    ["active", "revoked-recent"]
  );

  const expired = fake.calls.find(
    (call) =>
      call.method === "select" &&
      call.options.filters.some(([column, op]) => column === "expires_at" && op === "lt")
  );
  assert.deepEqual(expired.options.filters, [["expires_at", "lt", AUTH_CUTOFF]]);
  assert.equal(expired.options.order, "expires_at.asc");
  assert.equal(expired.options.limit, CLEANUP_BATCH_SIZE);

  const revoked = fake.calls.find(
    (call) =>
      call.method === "select" &&
      call.options.filters.some(([column, op]) => column === "revoked_at" && op === "not.is")
  );
  assert.deepEqual(revoked.options.filters, [
    ["revoked_at", "not.is", null],
    ["revoked_at", "lt", AUTH_CUTOFF],
  ]);
  assert.equal(revoked.options.order, "revoked_at.asc");

  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], "[maintenance-cleanup]");
  assert.deepEqual(Object.keys(logs[0][1]).sort(), ["deleted", "durationMs", "table"]);
  assert.equal(logs[0][1].table, "auth_sessions");
  assert.equal(logs[0][1].deleted, 2);
  assert.equal(JSON.stringify(logs).includes("Somchai"), false);
  assert.equal(JSON.stringify(logs).includes("203.0.113.9"), false);
});

test("purgeOldAuditLogs keeps rows inside the retention window", async (t) => {
  t.mock.method(console, "log", () => {});
  const fake = createFakeDb({
    auditLogs: [
      { id: "outside-2024", created_at: "2024-01-01T00:00:00.000Z" },
      { id: "outside-2025", created_at: "2025-01-01T00:00:00.000Z" },
      { id: "inside-2025", created_at: "2025-07-01T00:00:00.000Z" },
      { id: "inside-2026", created_at: "2026-05-01T00:00:00.000Z" },
    ],
  });

  const deleted = await purgeOldAuditLogs(fake, NOW);

  assert.equal(deleted, 2);
  assert.deepEqual(
    fake.state.audit_logs.map((row) => row.id).sort(),
    ["inside-2025", "inside-2026"]
  );

  const call = fake.calls.find((entry) => entry.method === "select");
  assert.deepEqual(call.options.filters, [["created_at", "lt", AUDIT_CUTOFF]]);
  assert.equal(call.options.order, "created_at.asc");
  assert.equal(call.options.limit, CLEANUP_BATCH_SIZE);
});

test("purging loops past one batch until the eligible rows are gone", async (t) => {
  t.mock.method(console, "log", () => {});
  const sessions = Array.from({ length: 1201 }, (_, index) => ({
    id: `session-${index}`,
    expires_at: "2026-04-01T00:00:00.000Z",
    revoked_at: null,
  }));
  const fake = createFakeDb({ sessions });

  const deleted = await purgeOldAuthSessions(fake, NOW);

  assert.equal(deleted, 1201);
  assert.equal(fake.state.auth_sessions.length, 0);
  assert.equal(
    fake.calls.filter((call) => call.method === "remove").length,
    Math.ceil(1201 / CLEANUP_BATCH_SIZE)
  );
  // One empty read ends the expired leg, then the revoked leg reads once.
  assert.equal(
    fake.calls.filter((call) => call.method === "select").length,
    Math.ceil(1201 / CLEANUP_BATCH_SIZE) + 1
  );
});

test("purging stops at the hard per-run cap", async (t) => {
  t.mock.method(console, "log", () => {});
  const sessions = Array.from({ length: CLEANUP_MAX_ROWS + 200 }, (_, index) => ({
    id: `session-${index}`,
    expires_at: "2026-04-01T00:00:00.000Z",
    revoked_at: null,
  }));
  const fake = createFakeDb({ sessions });

  const deleted = await purgeOldAuthSessions(fake, NOW);

  assert.equal(deleted, CLEANUP_MAX_ROWS);
  assert.equal(fake.state.auth_sessions.length, 200);
  assert.equal(
    fake.calls.filter((call) => call.method === "remove").length,
    CLEANUP_MAX_ROWS / CLEANUP_BATCH_SIZE
  );
});

test("a failing purge logs only name/code and audit cleanup still runs", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  t.mock.method(console, "log", () => {});

  const fake = createFakeDb({
    failAuth: true,
    auditLogs: [{ id: "old-audit", created_at: "2024-01-01T00:00:00.000Z" }],
  });

  assert.equal(await purgeOldAuthSessions(fake, NOW), 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "[maintenance-cleanup:auth_sessions:error]");
  assert.deepEqual(errors[0][1], { name: "DbError", code: "XX000" });

  const logged = JSON.stringify(errors);
  for (const marker of ["secret-token-marker", "203.0.113.9", "Somchai"]) {
    assert.equal(logged.includes(marker), false);
  }

  assert.equal(await purgeOldAuditLogs(fake, NOW), 1);
  assert.equal(fake.state.audit_logs.length, 0);
});

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

function installCleanupBackend() {
  return installFetch(({ url, init }) => {
    const table = tableOf(url);
    const method = init.method ?? "GET";
    if (method !== "GET") return new Response(null, { status: 204 });
    if (table === "auth_sessions") {
      return jsonResponse(
        { code: "XX000", message: "secret-token-marker 203.0.113.9 Somchai" },
        500
      );
    }
    return jsonResponse([]);
  });
}

test("the 0 2 * * * branch runs certificate retention and data cleanup", async (t) => {
  const errors = [];
  const logs = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  t.mock.method(console, "log", (...args) => logs.push(args));

  const fake = installCleanupBackend();
  t.after(() => fake.restore());

  const pending = [];
  worker.scheduled(
    { cron: CERT_CLEANUP_CRON, scheduledTime: NOW_ISO },
    ENV,
    { waitUntil: (job) => pending.push(job) }
  );

  assert.equal(pending.length, 1);
  await Promise.all(pending);

  const tables = fake.calls.map((call) => tableOf(call.url));
  assert.equal(tables.includes("leave_settings"), true);
  assert.equal(tables.includes("leave_requests"), true);
  assert.equal(tables.includes("auth_sessions"), true);
  assert.equal(tables.includes("audit_logs"), true);

  const authCall = fake.calls.find((call) => tableOf(call.url) === "auth_sessions");
  const authParams = new URL(authCall.url).searchParams;
  assert.equal(authParams.get("select"), "id");
  assert.equal(authParams.get("order"), "expires_at.asc");
  assert.equal(authParams.get("limit"), String(CLEANUP_BATCH_SIZE));
  assert.equal(authParams.get("expires_at").startsWith("lt."), true);

  const auditCall = fake.calls.find((call) => tableOf(call.url) === "audit_logs");
  const auditParams = new URL(auditCall.url).searchParams;
  assert.equal(auditParams.get("order"), "created_at.asc");
  assert.equal(auditParams.get("created_at").startsWith("lt."), true);

  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "[maintenance-cleanup:auth_sessions:error]");
  assert.deepEqual(errors[0][1], { name: "Error", code: "XX000" });

  // audit_logs, the new notification queue summary, and the opt-in leave job's
  // "disabled" line: each job logs its own summary.
  assert.equal(logs.length, 3);
  const auditSummary = logs.find((entry) => entry[1]?.table === "audit_logs");
  assert.ok(auditSummary);
  assert.equal(auditSummary[1].deleted, 0);
  assert.equal(
    logs.some((entry) => entry[1]?.disabled === "leave retention disabled"),
    true
  );

  const logged = JSON.stringify([...errors, ...logs]);
  for (const marker of ["secret-token-marker", "203.0.113.9", "Somchai", "fake-service-role-key"]) {
    assert.equal(logged.includes(marker), false);
  }
});

test("the 02:00 branch awaits the jobs when waitUntil is unavailable", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});

  const fake = installCleanupBackend();
  t.after(() => fake.restore());

  await worker.scheduled(
    { cron: CERT_CLEANUP_CRON, scheduledTime: NOW_ISO },
    ENV,
    undefined
  );

  const tables = fake.calls.map((call) => tableOf(call.url));
  assert.equal(tables.includes("auth_sessions"), true);
  assert.equal(tables.includes("audit_logs"), true);
});
