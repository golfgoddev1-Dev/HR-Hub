// Reason/shift rules for a manual attendance status change. Same contract as
// tests/attendance-status.test.js on the Express side.

import test from "node:test";
import assert from "node:assert/strict";

import {
  REASON_MAX_LENGTH,
  REASON_REQUIRED_STATUS_CODES,
  REASON_STATUS_CODES,
  SHIFT_VALUES,
  STATUS_CODES,
  normalizeStatusUpdate,
  requiresReason,
  requiresReasonText,
  requiresShift,
} from "../src/attendance-status.js";

test("STATUS_CODES lists exactly the four stored codes", () => {
  assert.deepEqual(STATUS_CODES, ["attended", "not_attended", "urgent_busy", "leave"]);
});

test("a reason is used only for urgent_busy and leave", () => {
  assert.deepEqual(REASON_STATUS_CODES, ["urgent_busy", "leave"]);
  assert.equal(requiresReason("urgent_busy"), true);
  assert.equal(requiresReason("leave"), true);
  assert.equal(requiresReason("attended"), false);
  assert.equal(requiresReason("not_attended"), false);
});

test("the reason is mandatory only for urgent_busy", () => {
  assert.deepEqual(REASON_REQUIRED_STATUS_CODES, ["urgent_busy"]);
  assert.equal(requiresReasonText("urgent_busy"), true);
  assert.equal(requiresReasonText("leave"), false);
  assert.equal(requiresReasonText("attended"), false);
  assert.equal(requiresReasonText("not_attended"), false);
});

test("a shift is required only for leave, and the two allowed shifts are pinned", () => {
  assert.equal(requiresShift("leave"), true);
  assert.equal(requiresShift("urgent_busy"), false);
  assert.deepEqual(SHIFT_VALUES, ["กะ A", "กะ B"]);
});

test("attended and not_attended clear reason and shift", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "attended" }), {
    ok: true,
    value: { status_code: "attended", reason: null, shift: null },
  });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "not_attended", reason: "", shift: null }), {
    ok: true,
    value: { status_code: "not_attended", reason: null, shift: null },
  });
});

test("a reason or shift on a status that does not use it is rejected", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "attended", reason: "มีเหตุผล" }), { ok: false });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "not_attended", shift: "กะ A" }), { ok: false });
});

test("urgent_busy keeps a trimmed reason and never a shift", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "urgent_busy", reason: "  ติดงานด่วน  " }), {
    ok: true,
    value: { status_code: "urgent_busy", reason: "ติดงานด่วน", shift: null },
  });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "urgent_busy" }), { ok: false });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "urgent_busy", reason: "   " }), { ok: false });
  assert.deepEqual(
    normalizeStatusUpdate({ statusCode: "urgent_busy", reason: "ติดงานด่วน", shift: "กะ A" }),
    { ok: false },
  );
});

test("leave accepts no reason and stores null", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave", shift: "กะ A" }), {
    ok: true,
    value: { status_code: "leave", reason: null, shift: "กะ A" },
  });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave", reason: "", shift: "กะ B" }), {
    ok: true,
    value: { status_code: "leave", reason: null, shift: "กะ B" },
  });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave", reason: "   ", shift: "กะ A" }), {
    ok: true,
    value: { status_code: "leave", reason: null, shift: "กะ A" },
  });
});

test("leave keeps an optional trimmed reason within the limit", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave", reason: "  ลาป่วย  ", shift: "กะ B" }), {
    ok: true,
    value: { status_code: "leave", reason: "ลาป่วย", shift: "กะ B" },
  });
  assert.deepEqual(
    normalizeStatusUpdate({ statusCode: "leave", reason: "ก".repeat(REASON_MAX_LENGTH + 1), shift: "กะ A" }),
    { ok: false },
  );
  assert.deepEqual(
    normalizeStatusUpdate({ statusCode: "leave", reason: "ก".repeat(REASON_MAX_LENGTH), shift: "กะ A" }),
    { ok: true, value: { status_code: "leave", reason: "ก".repeat(REASON_MAX_LENGTH), shift: "กะ A" } },
  );
});

test("leave still needs a valid shift without a reason", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave" }), { ok: false });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "leave", shift: "กะเช้า" }), { ok: false });
});

test("an unknown or empty status code is rejected", () => {
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "meeting_skipped" }), { ok: false });
  assert.deepEqual(normalizeStatusUpdate({ statusCode: "attended " }), { ok: false });
  assert.deepEqual(normalizeStatusUpdate({}), { ok: false });
});
