import test from "node:test";
import assert from "node:assert/strict";

import {
  AFTER_MESSAGE,
  BEFORE_MESSAGE,
  NO_SESSION_MESSAGE,
  bangkokToday,
  normalizeTime,
  resolveScanState,
} from "../src/register-window.js";

const MONDAY_10AM = new Date("2026-01-05T03:00:00.000Z");
const SUP_DEFAULTS = { weekday: 1, openTime: "09:00", cutoffTime: "12:00" };

test("bangkokToday uses the Bangkok calendar day across the UTC boundary", () => {
  assert.equal(bangkokToday(new Date("2026-01-04T16:59:00.000Z")), "2026-01-04");
  assert.equal(bangkokToday(new Date("2026-01-04T17:00:00.000Z")), "2026-01-05");
});

test("normalizeTime keeps HH:mm and rejects unusable values", () => {
  assert.equal(normalizeTime("09:00:00"), "09:00");
  assert.equal(normalizeTime("09:00"), "09:00");
  assert.equal(normalizeTime("9:00"), null);
  assert.equal(normalizeTime(null), null);
  assert.equal(normalizeTime(900), null);
});

test("sup before the open time is before", () => {
  const state = resolveScanState({
    now: MONDAY_10AM,
    typeCode: "sup",
    meetingDefaults: { ...SUP_DEFAULTS, openTime: "11:00" },
    sessions: [],
  });
  assert.deepEqual(state, {
    state: "before",
    openTime: "11:00",
    cutoffTime: "12:00",
    message: BEFORE_MESSAGE,
  });
});

test("sup inside the window is open with the default times", () => {
  const state = resolveScanState({
    now: MONDAY_10AM,
    typeCode: "sup",
    meetingDefaults: SUP_DEFAULTS,
    sessions: [],
  });
  assert.deepEqual(state, {
    state: "open",
    session: { sessionDate: "2026-01-05", openTime: "09:00", cutoffTime: "12:00" },
  });
});

test("sup at or after the cutoff is after", () => {
  for (const cutoffTime of ["10:00", "09:00"]) {
    const state = resolveScanState({
      now: MONDAY_10AM,
      typeCode: "sup",
      meetingDefaults: { ...SUP_DEFAULTS, cutoffTime },
      sessions: [],
    });
    assert.deepEqual(state, { state: "after", message: AFTER_MESSAGE });
  }
});

test("sup on the wrong weekday or without defaults has no session", () => {
  assert.deepEqual(
    resolveScanState({
      now: MONDAY_10AM,
      typeCode: "sup",
      meetingDefaults: { ...SUP_DEFAULTS, weekday: 2 },
      sessions: [],
    }),
    { state: "no_session", message: NO_SESSION_MESSAGE }
  );
  assert.deepEqual(
    resolveScanState({
      now: MONDAY_10AM,
      typeCode: "sup",
      meetingDefaults: { ...SUP_DEFAULTS, openTime: null },
      sessions: [],
    }),
    { state: "no_session", message: NO_SESSION_MESSAGE }
  );
});

test("monthly needs a session for today", () => {
  assert.deepEqual(
    resolveScanState({
      now: MONDAY_10AM,
      typeCode: "monthly",
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    }),
    { state: "no_session", message: NO_SESSION_MESSAGE }
  );

  const state = resolveScanState({
    now: MONDAY_10AM,
    typeCode: "monthly",
    meetingDefaults: SUP_DEFAULTS,
    sessions: [
      { sessionDate: "2026-01-04", openTime: "00:00", cutoffTime: "23:59" },
      { sessionDate: "2026-01-05", openTime: "09:00", cutoffTime: "12:00" },
    ],
  });
  assert.deepEqual(state, {
    state: "open",
    session: { sessionDate: "2026-01-05", openTime: "09:00", cutoffTime: "12:00" },
  });
});

test("monthly before and after use the session times", () => {
  const before = resolveScanState({
    now: MONDAY_10AM,
    typeCode: "monthly",
    meetingDefaults: SUP_DEFAULTS,
    sessions: [{ sessionDate: "2026-01-05", openTime: "11:00", cutoffTime: "12:00" }],
  });
  assert.equal(before.state, "before");

  const after = resolveScanState({
    now: MONDAY_10AM,
    typeCode: "monthly",
    meetingDefaults: SUP_DEFAULTS,
    sessions: [{ sessionDate: "2026-01-05", openTime: "08:00", cutoffTime: "09:00" }],
  });
  assert.deepEqual(after, { state: "after", message: AFTER_MESSAGE });
});

test("an unknown meeting type has no session", () => {
  assert.deepEqual(
    resolveScanState({
      now: MONDAY_10AM,
      typeCode: "other",
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    }),
    { state: "no_session", message: NO_SESSION_MESSAGE }
  );
});
