import test from "node:test";
import assert from "node:assert/strict";

import { createDb } from "../src/db.js";
import {
  STATUS_LABELS,
  EMPTY_MESSAGE,
  NOT_YET_LABEL,
  bangkokDayKey,
  timeOfDay,
  thaiDateLabel,
  thaiShortDateLabel,
  thaiMonthLabel,
  cycleLabel,
  cycleFullLabel,
  cycleKeyOf,
  nextMonthKey,
  registeredTime,
  latestPerEmployee,
  sortByRegisteredAt,
  countByStatus,
  rateOf,
  historyKeys,
  deptSummary,
  topAbsentPerDept,
} from "../src/meeting-dashboard.js";

function freeze(t, iso) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(iso) });
}

test("bangkokDayKey uses Asia/Bangkok calendar day", (t) => {
  freeze(t, "2026-01-05T03:00:00.000Z"); // 10:00 Bangkok
  assert.equal(bangkokDayKey(new Date()), "2026-01-05");
  assert.equal(bangkokDayKey(new Date(Date.parse("2026-01-05T16:59:00.000Z"))), "2026-01-05");
  assert.equal(bangkokDayKey(new Date(Date.parse("2026-01-05T17:01:00.000Z"))), "2026-01-06");
});

test("timeOfDay formats en-GB h23 in Bangkok and rejects junk", () => {
  assert.equal(timeOfDay("2026-01-05T03:30:00.000Z"), "10:30");
  assert.equal(timeOfDay("2026-11-03T02:00:00.000Z"), "09:00");
  assert.equal(timeOfDay("not-a-date"), null);
  assert.equal(timeOfDay(""), null);
  assert.equal(timeOfDay(null), null);
});

test("thaiDateLabel matches the draft example", () => {
  assert.equal(thaiDateLabel("2026-11-03"), "วันอังคาร 3 พ.ย. 2569");
  assert.equal(thaiDateLabel("junk"), "");
});

test("thaiShortDateLabel and thaiMonthLabel match the draft examples", () => {
  assert.equal(thaiShortDateLabel("2026-11-03"), "3 พ.ย.");
  assert.equal(thaiMonthLabel("2026-11"), "พ.ย. 2569");
  assert.equal(thaiShortDateLabel("bad"), "");
  assert.equal(thaiMonthLabel("bad"), "");
});

test("cycle key helpers match Express", () => {
  assert.equal(cycleKeyOf("sup", "2026-12-15"), "2026-12-15");
  assert.equal(cycleKeyOf("monthly", "2026-11-08"), "2026-11");
  assert.equal(cycleLabel("sup", "2026-11-03"), "3 พ.ย.");
  assert.equal(cycleLabel("monthly", "2026-11"), "พ.ย. 2569");
  assert.equal(cycleFullLabel("sup", "2026-11-03"), "วันอังคาร 3 พ.ย. 2569");
  assert.equal(nextMonthKey("2026-11"), "2026-12");
  assert.equal(nextMonthKey("2026-12"), "2027-01");
});

test("latestPerEmployee keeps the newest row per employee", () => {
  const rows = [
    { employee_id: "a", registered_at: "2026-11-03T02:00:00.000Z", status_code: "attended" },
    { employee_id: "b", registered_at: "2026-11-03T03:00:00.000Z", status_code: "leave" },
    { employee_id: "b", registered_at: "2026-11-03T01:00:00.000Z", status_code: "attended" },
    { employee_id: "c", registered_at: "not-a-date", status_code: "attended" },
    { employee_id: "a", registered_at: "2026-11-03T03:00:00.000Z", status_code: "urgent_busy" },
  ];
  const latest = latestPerEmployee(rows);
  assert.equal(latest.length, 3);
  const byId = new Map(latest.map((row) => [row.employee_id, row]));
  assert.equal(byId.get("a").status_code, "urgent_busy"); // tie: later insertion wins
  assert.equal(byId.get("b").status_code, "leave"); // newest beats earlier unknown-time rows
  assert.equal(byId.get("c").status_code, "attended"); // unparseable time weighs 0
});

test("latestPerEmployee skips rows without an employee id", () => {
  const latest = latestPerEmployee([
    { employee_id: "", registered_at: "2026-11-03T02:00:00.000Z", status_code: "attended" },
    { registered_at: "2026-11-03T02:00:00.000Z" },
  ]);
  assert.equal(latest.length, 0);
});

test("sortByRegisteredAt sorts ascending, weighs unknown time as 0, does not mutate", () => {
  const input = [
    { id: 1, registered_at: "2026-11-03T02:00:00.000Z" },
    { id: 2, registered_at: "junk" },
    { id: 3, registered_at: "2026-11-03T01:00:00.000Z" },
  ];
  const copy = [...input];
  const sorted = sortByRegisteredAt(input);
  assert.deepEqual(sorted.map((row) => row.id), [2, 3, 1]);
  assert.deepEqual(input, copy); // input untouched
  assert.equal(registeredTime({ registered_at: "junk" }), 0);
});

test("countByStatus matches Express: unknown codes raise total only", () => {
  const counts = countByStatus([
    { status_code: "attended" },
    { status_code: "attended" },
    { status_code: "not_attended" },
    { status_code: "urgent_busy" },
    { status_code: "leave" },
    { status_code: "mystery" },
    { status_code: null },
    {},
  ]);
  assert.deepEqual(counts, {
    attended: 2,
    not_attended: 1,
    urgent_busy: 1,
    leave: 1,
    total: 6, // only rows with a non-empty status_code count as total
  });
});

test("rateOf clamps and guards totals", () => {
  assert.equal(rateOf(3, 6), 0.5);
  assert.equal(rateOf(10, 6), 1);
  assert.equal(rateOf(-1, 6), 0);
  assert.equal(rateOf(1, 0), 0);
  assert.equal(rateOf(1, -2), 0);
});

test("STATUS_LABELS is exactly the Phase 2 order", () => {
  assert.deepEqual(STATUS_LABELS, [
    "เข้าร่วมประชุม",
    "ไม่เข้าร่วม",
    "ติดงานด่วน",
    "ลาประชุม",
  ]);
  assert.equal(EMPTY_MESSAGE, "ยังไม่มีข้อมูลในระบบ");
  assert.equal(NOT_YET_LABEL, "ยังไม่ลงทะเบียน");
});

/* ------------------------------------------------------------------ */
/* historyKeys                                                         */
/* ------------------------------------------------------------------ */

test("historyKeys sup/day: 12 Tuesdays ending at the anchor", () => {
  // 2026-12-22 is a Tuesday.
  const keys = historyKeys({
    code: "sup",
    mode: "day",
    value: "",
    availableKeys: ["2026-12-08", "2026-12-15", "2026-12-22"],
  });
  assert.equal(keys.length, 12);
  assert.equal(keys[0], "2026-10-06");
  assert.equal(keys.at(-1), "2026-12-22");
  for (const key of keys) {
    const [y, m, d] = key.split("-").map(Number);
    assert.equal(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 2); // Tuesday
  }
});

test("historyKeys sup/day snaps a mid-week value to its Tuesday", () => {
  const keys = historyKeys({
    code: "sup",
    mode: "day",
    value: "2026-12-02", // Wednesday
    availableKeys: ["2026-12-01"],
  });
  assert.equal(keys.length, 12);
  assert.equal(keys[0], "2026-09-15");
  assert.equal(keys.at(-1), "2026-12-01");
});

test("historyKeys monthly/day: calendar months of the last 12 cycles", () => {
  // 2026-01-05 is a Monday 10:00 Bangkok; monthly day window ends at month of anchor.
  const keys = historyKeys({
    code: "monthly",
    mode: "day",
    value: "",
    availableKeys: ["2026-01-05"],
  });
  assert.deepEqual(keys, [
    "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07",
    "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01",
  ]);
});

test("historyKeys monthly/month: available months up to the value, last 12", () => {
  const keys = historyKeys({
    code: "monthly",
    mode: "month",
    value: "2026-04",
    availableKeys: [
      "2025-06-10", "2026-03-10", "2026-04-10", "2026-05-10",
    ],
  });
  assert.deepEqual(keys, ["2025-06", "2026-03", "2026-04"]);
});

test("historyKeys year: available months of the selected year", () => {
  const keys = historyKeys({
    code: "monthly",
    mode: "year",
    value: "2025",
    availableKeys: ["2025-12-08", "2026-02-10", "2025-11-08"],
  });
  assert.deepEqual(keys, ["2025-11", "2025-12"]);
});

test("historyKeys returns [] with no available data", () => {
  const keys = historyKeys({ code: "sup", mode: "day", value: "", availableKeys: [] });
  assert.deepEqual(keys, []);
});

/* ------------------------------------------------------------------ */
/* deptSummary / topAbsentPerDept                                      */
/* ------------------------------------------------------------------ */

test("deptSummary matches the Express case and dash fallback", () => {
  const roster = [
    { employeeId: "a", departmentName: "กอง" },
    { employeeId: "b", departmentName: "กอง" },
    { employeeId: "c", departmentName: "ขวัญ" },
    { employeeId: "d", departmentName: "ขวัญ" },
    { employeeId: "e", departmentName: "คง" },
  ];
  const latestRows = [
    { employee_id: "a", status_code: "attended" },
    { employee_id: "c", status_code: "attended" },
    { employee_id: "d", status_code: "not_attended" },
  ];
  const summary = deptSummary(roster, latestRows);
  assert.deepEqual(summary.map((row) => row.name), ["กอง", "คง", "ขวัญ"]);
  assert.deepEqual(summary[0], {
    name: "กอง",
    total: 2,
    registered: 1,
    notYet: 1,
    attended: 1,
    rate: 0.5,
  });
});

test("topAbsentPerDept picks top name per dept/status with Thai tie-break", () => {
  // Express vitest case, status values are codes.
  const top = topAbsentPerDept([
    { dept: "กอง", name: "กิตติ", status: "not_attended", count: 2 },
    { dept: "กอง", name: "สมชาย", status: "not_attended", count: 2 },
    { dept: "กอง", name: "สมชาย", status: "leave", count: 1 },
  ]);
  assert.equal(top.length, 3);
  assert.deepEqual(top[0], { dept: "กอง", status: "not_attended", name: "กิตติ", count: 2 });
  assert.deepEqual(top[1], { dept: "กอง", status: "urgent_busy", name: "", count: 0 });
  assert.deepEqual(top[2], { dept: "กอง", status: "leave", name: "สมชาย", count: 1 });

  const zero = topAbsentPerDept([
    { dept: "กอง", name: "กิตติ", status: "not_attended", count: 0 },
  ]);
  assert.deepEqual(zero[0], { dept: "กอง", status: "not_attended", name: "", count: 0 });

  assert.deepEqual(topAbsentPerDept([]), []);
  assert.deepEqual(topAbsentPerDept(undefined), []);

  // Label-keyed rows (the Express route's real-world input) never match the
  // code filter, so they are skipped entirely.
  assert.deepEqual(
    topAbsentPerDept([{ dept: "กอง", name: "สมชาย", status: "ไม่เข้าร่วม", count: 3 }]),
    [],
  );
});

/* ------------------------------------------------------------------ */
/* db.js additive `in` operator                                        */
/* ------------------------------------------------------------------ */

const UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const UUID_B = "987fcdeb-51a2-42d3-a456-426614174999";

test("db in filter renders in.(...) with URL-encoded values", async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    seen.push(String(input));
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const db = createDb({
      SUPABASE_URL: "https://fake-project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
    });
    await db.select("meeting_attendance", {
      columns: "id",
      filters: [["session_id", "in", [UUID_A, UUID_B]]],
    });
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]);
    const expectA = encodeURIComponent(UUID_A);
    const expectB = encodeURIComponent(UUID_B);
    assert.equal(
      url.searchParams.get("session_id"),
      `in.(${expectA},${expectB})`
    );
    // A comma-bearing value must be encoded so it cannot split the list.
    await db.select("t", { columns: "id", filters: [["col", "in", ["a,b", "c"]]] });
    // Compare the raw query string: URLSearchParams decodes %2C back to ','.
    assert.ok(seen[1].includes("col=in.(a%2Cb,c)"), seen[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
