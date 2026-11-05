// notification_queue.next_attempt_at is NOT NULL. A default does not help when
// the Worker writes null, so both the insert and the finishing update must
// always carry a valid ISO timestamp.
import test from "node:test";
import assert from "node:assert/strict";

import { enqueueNotification, runNotificationQueue } from "../src/push/queue.js";

const ENV = {
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
  VAPID_PUBLIC_KEY: "fake-public-key",
  VAPID_PRIVATE_KEY: "fake-private-key",
  VAPID_SUBJECT: "mailto:test@example.com",
};

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-05T10:00:00.000Z");

function isIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

test("enqueue writes next_attempt_at even when the caller passes no usable now", async () => {
  const writes = [];
  const db = {
    async insert(table, row) {
      writes.push({ table, row });
      return { data: { id: "queue-1" } };
    },
  };

  for (const now of [null, undefined]) {
    const result = await enqueueNotification(db, {
      employeeId: EMPLOYEE_ID,
      kind: "leave_submitted",
      now,
    });
    assert.equal(result.ok, true);
  }

  assert.equal(writes.length, 2);
  for (const { table, row } of writes) {
    assert.equal(table, "notification_queue");
    assert.equal(isIso(row.next_attempt_at), true, String(row.next_attempt_at));
    assert.equal(isIso(row.created_at), true);
    assert.equal(row.next_attempt_at, row.created_at);
  }
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function matches(params, row) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset", "or", "on_conflict", "like"].includes(key)) {
      continue;
    }
    if (value.startsWith("eq.")) {
      if (String(row[key] ?? "") !== value.slice(3)) return false;
      continue;
    }
    if (value.startsWith("lte.")) {
      const left = Date.parse(String(row[key] ?? ""));
      const right = Date.parse(value.slice(4));
      if (!Number.isFinite(left) || !Number.isFinite(right) || !(left <= right)) return false;
      continue;
    }
    if (value.startsWith("in.(")) {
      const list = value.slice(4, -1).split(",").map((entry) => decodeURIComponent(entry));
      if (!list.includes(String(row[key] ?? ""))) return false;
    }
  }
  return true;
}

test("a finished row never writes a null next_attempt_at", async (t) => {
  const state = {
    notification_queue: [
      {
        id: "queue-1",
        employee_id: EMPLOYEE_ID,
        leave_request_id: null,
        kind: "leave_submitted",
        payload: { title: "x", body: "y", url: "/leave/approvals" },
        status: "pending",
        attempts: 0,
        next_attempt_at: NOW.toISOString(),
      },
    ],
    push_subscriptions: [],
  };

  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith("https://fake-project.supabase.co")) {
      return new Response(null, { status: 500 });
    }

    const method = (init.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const table = parsed.pathname.split("/").pop();
    const params = parsed.searchParams;

    if (method === "GET") {
      return jsonResponse((state[table] ?? []).filter((row) => matches(params, row)));
    }

    if (method === "PATCH") {
      const patch = init.body ? JSON.parse(init.body) : {};
      const updated = (state[table] ?? []).filter((row) => matches(params, row));
      for (const row of updated) Object.assign(row, patch);
      return jsonResponse(updated);
    }

    return new Response(null, { status: 204 });
  };

  const summary = await runNotificationQueue(ENV, NOW);

  assert.equal(summary.cancelled, 1);
  const saved = state.notification_queue[0];
  assert.equal(saved.status, "cancelled");
  assert.equal(isIso(saved.next_attempt_at), true, String(saved.next_attempt_at));
  assert.equal(saved.next_attempt_at, NOW.toISOString());
});
