// Leave data retention is stored in leave_settings, not an environment value.
// The settings route accepts only 730..3650 days, only HR, audits every change,
// and the daily job reads the stored flag. The preview is a dry run.

import test from "node:test";
import assert from "node:assert/strict";

import app from "../src/app.js";
import {
  DEFAULT_LEAVE_RETENTION_DAYS,
  normalizeLeaveRetentionDays,
  settingsFromRow,
} from "../src/leave-settings.js";
import {
  CLEANUP_BATCH_SIZE,
  CLEANUP_MAX_ROWS,
  purgeOldLeaveData,
  runDataCleanup,
} from "../src/maintenance/cleanup.js";

const HR_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(43);
const NOW = new Date("2026-11-09T00:00:00.000Z");

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

function tableOf(url) {
  return new URL(url).pathname.split("/").pop();
}

function inList(value) {
  return String(value)
    .replace(/^in\.\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .filter((part) => part.length > 0)
    .map(decodeURIComponent);
}

function matches(row, params) {
  const status = params.get("status");
  if (status && status.startsWith("in.") && !inList(status).includes(row.status)) return false;
  const endDate = params.get("end_date");
  if (endDate && endDate.startsWith("lt.") && !(row.end_date < endDate.slice(3))) return false;
  const leaveId = params.get("leave_request_id");
  if (leaveId && leaveId.startsWith("in.") && !inList(leaveId).includes(row.leave_request_id)) {
    return false;
  }
  return true;
}

function initialSettings(overrides = {}) {
  return {
    id: 1,
    certificate_retention_days: 90,
    leave_retention_enabled: false,
    leave_retention_days: DEFAULT_LEAVE_RETENTION_DAYS,
    ...overrides,
  };
}

const LEAVES = [
  { id: "old-approved", status: "approved", end_date: "2019-01-01" },
  { id: "old-pending", status: "pending", end_date: "2019-01-01" },
  { id: "recent-approved", status: "approved", end_date: "2026-01-01" },
];

function createSettingsFake({ role = "hr", settings = initialSettings(), leaves = LEAVES } = {}) {
  const original = globalThis.fetch;
  const state = {
    role,
    settings: { ...settings },
    leaves: leaves.map((row) => ({ ...row })),
    audits: [],
    deletes: [],
  };
  // readSession rejects a session idle for more than 15 minutes, so this uses
  // the real clock rather than the fixed test date.
  const sessionNow = new Date();
  const session = {
    id: "session-1",
    employee_id: role === "hr" ? HR_ID : EMPLOYEE_ID,
    login_role: role,
    revoked_at: null,
    last_active_at: sessionNow.toISOString(),
    expires_at: new Date(sessionNow.getTime() + 6 * 60 * 60 * 1000).toISOString(),
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const params = new URL(url).searchParams;
    const table = tableOf(url);

    if (method === "GET") {
      if (table === "auth_sessions") {
        // A cleanup read has no token_hash filter; it must not see this session.
        return params.get("token_hash") ? jsonResponse([session]) : jsonResponse([]);
      }
      if (table === "hr_admins") {
        return jsonResponse(role === "hr" ? [{ employee_id: HR_ID }] : []);
      }
      if (table === "meeting_admins" || table === "system_admins") return jsonResponse([]);
      if (table === "employees") {
        const wanted = params.get("id") ?? "";
        const id = wanted.startsWith("eq.") ? wanted.slice(3) : null;
        return jsonResponse(id ? [{ id, is_active: true }] : []);
      }
      if (table === "leave_settings") return jsonResponse([state.settings]);
      if (table === "leave_requests") {
        return jsonResponse(state.leaves.filter((row) => matches(row, params)));
      }
      if (table === "notification_queue") return jsonResponse([]);
      return jsonResponse([]);
    }

    if (method === "POST") {
      if (table === "leave_settings") {
        const row = JSON.parse(init.body);
        state.settings = { ...state.settings, ...row };
        return jsonResponse([state.settings], 201);
      }
      if (table === "audit_logs") {
        state.audits.push(JSON.parse(init.body));
        return jsonResponse([], 201);
      }
      return jsonResponse([], 201);
    }

    if (method === "DELETE") {
      state.deletes.push(url);
      const ids = inList(params.get("id") ?? "");
      const removed = table === "leave_requests"
        ? state.leaves.filter((row) => ids.includes(row.id))
        : [];
      if (table === "leave_requests") {
        state.leaves = state.leaves.filter((row) => !ids.includes(row.id));
      }
      return jsonResponse(removed.map((row) => ({ id: row.id })));
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

function call(path, { method = "GET", body, role = "hr" } = {}) {
  return app.request(
    `https://fake.local${path}`,
    {
      method,
      headers: {
        Cookie: `hr_session=${TOKEN}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { ...ENV, __ROLE: role }
  );
}

test("defaults are off and 730 days, and only 730..3650 is accepted", () => {
  const defaults = settingsFromRow(null);
  assert.equal(defaults.leaveRetentionEnabled, false);
  assert.equal(defaults.leaveRetentionDays, 730);

  assert.equal(normalizeLeaveRetentionDays(729), null);
  assert.equal(normalizeLeaveRetentionDays(3651), null);
  assert.equal(normalizeLeaveRetentionDays(730), 730);
  assert.equal(normalizeLeaveRetentionDays(1825), 1825);
  assert.equal(normalizeLeaveRetentionDays(3650), 3650);
  assert.equal(normalizeLeaveRetentionDays("abc"), null);
});

test("a value below 730 days is refused with a Thai message and no audit row", async (t) => {
  const fake = createSettingsFake();
  t.after(() => fake.restore());

  const response = await call("/api/leave/hr/settings", {
    method: "PUT",
    body: { leaveRetentionDays: 729 },
  });
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.match(data.message, /730/);
  assert.match(data.message, /3650/);
  assert.equal(fake.state.audits.length, 0);
  assert.equal(fake.state.settings.leave_retention_days, 730);
});

test("a value above 3650 days is refused", async (t) => {
  const fake = createSettingsFake();
  t.after(() => fake.restore());

  const response = await call("/api/leave/hr/settings", {
    method: "PUT",
    body: { leaveRetentionDays: 3651 },
  });
  assert.equal(response.status, 400);
  assert.equal(fake.state.audits.length, 0);
});

test("a non-HR session cannot read or change the setting", async (t) => {
  const fake = createSettingsFake({ role: "employee" });
  t.after(() => fake.restore());

  assert.equal((await call("/api/leave/hr/settings")).status, 403);
  assert.equal(
    (
      await call("/api/leave/hr/settings", {
        method: "PUT",
        body: { leaveRetentionEnabled: true },
      })
    ).status,
    403
  );
  assert.equal((await call("/api/leave/hr/settings/leave-retention/preview")).status, 403);
  assert.equal(fake.state.audits.length, 0);
  assert.equal(fake.state.settings.leave_retention_enabled, false);
});

test("enabling, changing days and disabling each write one audit row", async (t) => {
  const fake = createSettingsFake();
  t.after(() => fake.restore());

  const enabled = await call("/api/leave/hr/settings", {
    method: "PUT",
    body: { leaveRetentionEnabled: true, leaveRetentionDays: 730 },
  });
  assert.equal(enabled.status, 200);
  const enabledBody = await enabled.json();
  assert.equal(enabledBody.leaveRetentionEnabled, true);
  assert.equal(enabledBody.leaveRetentionDays, 730);

  await call("/api/leave/hr/settings", {
    method: "PUT",
    body: { leaveRetentionDays: 900 },
  });
  await call("/api/leave/hr/settings", {
    method: "PUT",
    body: { leaveRetentionEnabled: false },
  });

  assert.equal(fake.state.audits.length, 3);
  for (const row of fake.state.audits) {
    assert.equal(row.actor_id, HR_ID);
    assert.equal(row.action, "leave_settings_updated");
    assert.equal(row.entity, "leave_settings");
  }
  assert.deepEqual(JSON.parse(fake.state.audits[0].detail), {
    leaveRetentionEnabled: { before: false, after: true },
    leaveRetentionDays: { before: 730, after: 730 },
  });
  assert.deepEqual(JSON.parse(fake.state.audits[2].detail), {
    leaveRetentionEnabled: { before: true, after: false },
  });

  const text = JSON.stringify(fake.state.audits);
  for (const forbidden of ["สมชาย", "ลาป่วย", "cert.pdf", "/storage/"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("the job does nothing while the stored setting is off", async (t) => {
  const fake = createSettingsFake({ settings: initialSettings({ leave_retention_enabled: false }) });
  t.after(() => fake.restore());

  const summary = await runDataCleanup(ENV, NOW);
  assert.equal(summary.leaveRetention.disabled, true);
  assert.equal(fake.state.deletes.length, 0);
  assert.equal(fake.state.leaves.length, 3);
});

test("when on, the job deletes only final requests older than the stored cutoff", async (t) => {
  const fake = createSettingsFake({
    settings: initialSettings({
      leave_retention_enabled: true,
      leave_retention_days: 730,
    }),
  });
  t.after(() => fake.restore());

  const summary = await runDataCleanup(ENV, NOW);
  assert.equal(summary.leaveRetention.disabled, false);
  assert.equal(summary.leaveRetention.cutoff, "2024-11-09");
  assert.equal(summary.leaveRetention.leaveRequests, 1);
  assert.deepEqual(
    fake.state.leaves.map((row) => row.id).sort(),
    ["old-pending", "recent-approved"]
  );
});

test("pending requests are never selected, at any age", async (t) => {
  t.mock.method(console, "log", () => {});
  const db = {
    state: [{ id: "pending", status: "pending", end_date: "2000-01-01" }],
    async select() {
      return [
        { id: "pending", status: "pending", end_date: "2000-01-01", medical_certificate_url: null },
      ];
    },
    async remove() {
      throw new Error("must not delete");
    },
  };

  const summary = await purgeOldLeaveData(db, NOW, {
    enabled: true,
    retentionDays: 730,
  });
  assert.equal(summary.leaveRequests, 0);
});

test("children are removed before parents and deletes are chunked at 200", async (t) => {
  t.mock.method(console, "log", () => {});
  const total = 450;
  const leaves = Array.from({ length: total }, (_, index) => ({
    id: `leave-${index}`,
    status: "approved",
    end_date: "2019-01-01",
    medical_certificate_url: null,
  }));
  const notifications = leaves.map((row) => ({
    id: `notice-${row.id}`,
    leave_request_id: row.id,
    status: "sent",
  }));
  const state = { leave_requests: leaves, notification_queue: notifications };
  const calls = [];

  const db = {
    async select(table, options = {}) {
      const params = new Map();
      for (const [column, op, value] of options.filters ?? []) {
        if (op === "in") params.set(column, value);
      }
      let rows = state[table] ?? [];
      if (params.has("leave_request_id")) {
        const ids = params.get("leave_request_id");
        rows = rows.filter((row) => ids.includes(row.leave_request_id));
      }
      if (options.limit) rows = rows.slice(0, options.limit);
      return rows;
    },
    async remove(table, filters) {
      const ids = filters.find(([column, op]) => column === "id" && op === "in")?.[2] ?? [];
      calls.push({ table, ids: [...ids] });
      const removed = (state[table] ?? []).filter((row) => ids.includes(row.id));
      state[table] = (state[table] ?? []).filter((row) => !ids.includes(row.id));
      return { data: removed.map((row) => ({ id: row.id })), error: null };
    },
  };

  const summary = await purgeOldLeaveData(db, NOW, {
    enabled: true,
    retentionDays: 730,
  });

  assert.equal(summary.leaveRequests, total);
  assert.equal(summary.notifications, total);
  assert.equal(summary.certificates, 0);
  assert.equal(summary.leaveRequests <= CLEANUP_MAX_ROWS, true);

  const notificationCalls = calls.filter((call) => call.table === "notification_queue");
  const leaveCalls = calls.filter((call) => call.table === "leave_requests");
  assert.equal(notificationCalls.length, Math.ceil(total / CLEANUP_BATCH_SIZE));
  assert.equal(leaveCalls.length, Math.ceil(total / CLEANUP_BATCH_SIZE));
  for (const call of [...notificationCalls, ...leaveCalls]) {
    assert.equal(call.ids.length <= CLEANUP_BATCH_SIZE, true);
  }
  // Within each batch the children are removed first: the first notification
  // delete precedes the first leave delete, and the two streams alternate.
  const firstNotificationIndex = calls.findIndex(
    (call) => call.table === "notification_queue"
  );
  const firstLeaveIndex = calls.findIndex((call) => call.table === "leave_requests");
  assert.equal(firstNotificationIndex, 0);
  assert.ok(firstNotificationIndex < firstLeaveIndex);
  assert.deepEqual(
    calls.map((call) => call.table),
    [
      "notification_queue",
      "leave_requests",
      "notification_queue",
      "leave_requests",
      "notification_queue",
      "leave_requests",
    ]
  );
});

test("the preview is a dry run that returns leave and certificate counts", async (t) => {
  const fake = createSettingsFake({
    settings: initialSettings({
      leave_retention_enabled: false,
      leave_retention_days: 1825,
    }),
    leaves: [
      { id: "old-file", status: "approved", end_date: "2019-01-01" },
      { id: "old-plain", status: "rejected", end_date: "2019-02-01" },
      { id: "old-pending", status: "pending", end_date: "2019-01-01" },
    ],
  });
  t.after(() => fake.restore());
  fake.state.leaves[0].medical_certificate_url = "leave-certificates/leave/a/cert.pdf";

  const response = await call("/api/leave/hr/settings/leave-retention/preview?days=1825");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.leaveRequests, 2);
  assert.equal(data.certificateFiles, 1);
  assert.equal(fake.state.leaves.length, 3);
  assert.equal(fake.state.deletes.length, 0);
});

test("the preview refuses an out-of-range days value", async (t) => {
  const fake = createSettingsFake();
  t.after(() => fake.restore());

  const response = await call("/api/leave/hr/settings/leave-retention/preview?days=10");
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /730/);
});
