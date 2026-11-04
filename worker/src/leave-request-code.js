// Request codes: LV-YYYYMMDD-NNN, where NNN is a per-day sequence.
//
// The sequence is read from the highest code of the same Bangkok day rather
// than kept in a counter table, so there is no second source of truth to keep in
// sync. Two submissions in the same second can still pick the same number; the
// caller retries with a fresh read when the unique index rejects the insert.

import { requestCodeFor, requestCodePrefix, requestCodeSequence } from "./leave-rules.js";

export const LEAVE_REQUESTS_TABLE = "leave_requests";
export const REQUEST_CODE_ATTEMPTS = 3;
const SEQUENCE_SCAN_LIMIT = 1000;

/** Highest sequence already used for this prefix, or 0. */
export function highestSequence(codes, prefix) {
  let highest = 0;
  for (const code of Array.isArray(codes) ? codes : []) {
    const value = requestCodeSequence(code, prefix);
    if (value > highest) highest = value;
  }
  return highest;
}

/** Next free code for the Bangkok day of `now`. */
export async function nextRequestCode(db, now = new Date()) {
  const prefix = requestCodePrefix(now);
  const rows = await db.select(LEAVE_REQUESTS_TABLE, {
    columns: "request_code",
    filters: [["request_code", "like", `${prefix}%`]],
    order: "request_code.desc",
    limit: SEQUENCE_SCAN_LIMIT,
  });

  return requestCodeFor(prefix, highestSequence(rows.map((row) => row.request_code), prefix) + 1);
}

/**
 * Inserts one row with a fresh code, retrying on a unique violation.
 * `buildRow(requestCode)` returns the row to insert. Returns
 * { ok: true, row, inserted } or { ok: false, error, duplicate }.
 */
export async function insertWithRequestCode(
  db,
  buildRow,
  { now = new Date(), attempts = REQUEST_CODE_ATTEMPTS, beforeInsert } = {}
) {
  let error = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const requestCode = await nextRequestCode(db, now);
    const row = buildRow(requestCode);

    const prepared = beforeInsert ? await beforeInsert(row) : { ok: true };
    if (prepared.ok !== true) return { ok: false, ...prepared };

    const inserted = await db.insert(LEAVE_REQUESTS_TABLE, row, { returning: true });
    if (!inserted.error) return { ok: true, row, inserted };

    // The row was not saved: undo whatever this attempt uploaded. That covers
    // both a code collision (retry with a fresh code) and a real failure.
    if (prepared.rollback) await prepared.rollback();

    if (inserted.error.code !== "23505") return { ok: false, error: inserted.error, duplicate: false };
    error = inserted.error;
  }

  return { ok: false, error, duplicate: true };
}
