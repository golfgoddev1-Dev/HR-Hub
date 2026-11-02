// Pure planning for the historical attendance import ("ข้อมูลย้อนหลัง").
// No database access: the caller supplies meeting types, employees, the
// sessions that already exist for the dates in the file and the
// (session, employee) pairs that are already recorded.
//
// A round is identified by ประเภท + วันที่ only: every imported round is stored
// with session_time = "". The time in column C belongs to the person, not to the
// round, and becomes that row's registered_at (Asia/Bangkok). When a round for
// the type and date already exists it is reused, never duplicated, so there is
// no join/skip decision to make.

import { REASONS, collapseWhitespace, matchEmployees, validateBackfillRow } from "./validate.js";

// Still exported because the route validates the legacy `decisions` field of
// older clients; planning itself ignores it now that a round is never a conflict.
export const DECISION_JOIN = "join";
export const DECISION_SKIP = "skip";

export const REASON_DUPLICATE_IN_ROUND = "ชื่อพนักงานซ้ำในรอบเดียวกันของไฟล์";
export const REASON_ALREADY_RECORDED = "มีข้อมูลของคนนี้ในรอบนี้แล้ว";

/** HH:mm from a text or time column value ("10:00", "10:00:00"). */
export function normalizeClock(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(text);
  return match ? `${match[1]}:${match[2]}` : "";
}

export function normalizeLocationValue(value) {
  return collapseWhitespace(value ?? "");
}

/** A round is type + date; the time in the file is per person, not per round. */
export function roundKeyOf(typeId, dateIso) {
  return [typeId, dateIso].join("|");
}

/**
 * The file time as a timestamptz in Asia/Bangkok. Thailand has no daylight
 * saving, so the offset is always +07:00 and the value never depends on the
 * clock or timezone of the machine that runs the Worker.
 * Returns null for anything that is not a date + HH:mm.
 */
export function bangkokTimestamp(dateIso, hhmm) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso ?? ""))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(hhmm ?? ""))) return null;
  const value = `${dateIso}T${hhmm}:00+07:00`;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

const EMPTY_COUNTS = () => ({
  attended: 0,
  leave: 0,
  not_attended: 0,
  urgent_busy: 0,
});

/**
 * @param {object} input
 * @param {Array<{rowNumber:number, cells:string[]}>} input.rows
 * @param {Array<{id:string, code:string, name:string}>} input.meetingTypes
 * @param {Array<{id:string, full_name:string, name_prefix?:string}>} input.employees
 * @param {Array<{id:string, meeting_type_id:string, session_date:string, session_time?:string|null, location?:string|null}>} [input.sessions]
 * @param {Set<string>} [input.recorded]  "sessionId:employeeId" of existing rows
 * @param {Map<string, string>} [input.decisions]  legacy field, ignored
 */
export function buildBackfillPlan(input) {
  const {
    rows = [],
    meetingTypes = [],
    employees = [],
    sessions = [],
    recorded = new Set(),
  } = input;

  const types = meetingTypes.filter((type) => type && type.id && type.name);
  const typeByName = new Map(types.map((type) => [collapseWhitespace(type.name), type]));
  const employeeById = new Map(employees.filter((row) => row && row.id).map((row) => [row.id, row]));

  const skipped = [];
  const valid = [];

  for (const row of rows) {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const result = validateBackfillRow(cells, { meetingTypes: types });
    if (!result.ok) {
      skipped.push({
        row: row.rowNumber,
        typeName: collapseWhitespace(cells[0]),
        dateIso: "",
        name: collapseWhitespace(cells[4]),
        reason: result.reason,
      });
      continue;
    }

    const data = result.row;
    const type = typeByName.get(data.meetingTypeName);

    // The registration time comes from this row's own column C. A row without a
    // usable time is reported and never given an invented value.
    const registeredAt = bangkokTimestamp(data.dateIso, data.timeHhmm);
    if (registeredAt === null) {
      skipped.push({
        row: row.rowNumber,
        typeName: data.meetingTypeName,
        dateIso: data.dateIso,
        name: data.employeeName,
        reason: REASONS.timeInvalid,
      });
      continue;
    }

    // The browser matches the name against the employee list and sends the id,
    // so the Worker only checks that the id exists. A request without ids (the
    // legacy workbook upload) still falls back to matching here.
    let employeeId = typeof row.employeeId === "string" && row.employeeId !== "" ? row.employeeId : null;
    let employeeName = data.employeeName;

    if (employeeId) {
      const employee = employeeById.get(employeeId) ?? null;
      if (!employee) {
        skipped.push({
          row: row.rowNumber,
          typeName: data.meetingTypeName,
          dateIso: data.dateIso,
          name: data.employeeName,
          reason: REASONS.employeeUnknown,
        });
        continue;
      }
      employeeName = employee.full_name ?? data.employeeName;
    } else {
      const match = matchEmployees(data.employeeName, employees);
      if (!match.ok) {
        skipped.push({
          row: row.rowNumber,
          typeName: data.meetingTypeName,
          dateIso: data.dateIso,
          name: data.employeeName,
          reason: match.reason,
        });
        continue;
      }
      employeeId = match.employee.id;
      employeeName = match.employee.full_name ?? data.employeeName;
    }

    valid.push({
      row: row.rowNumber,
      employeeId,
      employeeName,
      typeId: type.id,
      typeCode: type.code ?? "",
      typeName: type.name,
      dateIso: data.dateIso,
      time: data.timeHhmm,
      registeredAt,
      location: normalizeLocationValue(data.location),
      statusCode: data.statusCode,
      shift: data.shift,
      reason: data.reason,
    });
  }

  // One round per type + date. When the database still holds more than one row
  // for the pair (older data), the day round with session_time = "" wins so the
  // import never creates a second round.
  const sessionByRoundKey = new Map();
  for (const session of sessions) {
    if (!session || !session.id) continue;
    const key = roundKeyOf(session.meeting_type_id, session.session_date);
    const current = sessionByRoundKey.get(key);
    const blank = normalizeClock(session.session_time) === "";
    if (!current || (blank && normalizeClock(current.session_time) !== "")) {
      sessionByRoundKey.set(key, session);
    }
  }

  const groups = new Map();
  for (const entry of valid) {
    const key = roundKeyOf(entry.typeId, entry.dateIso);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        typeId: entry.typeId,
        typeCode: entry.typeCode,
        typeName: entry.typeName,
        dateIso: entry.dateIso,
        candidates: [],
      });
    }
    groups.get(key).candidates.push(entry);
  }

  const rounds = [];
  let writtenRows = 0;

  for (const group of groups.values()) {
    const existing = sessionByRoundKey.get(group.key) ?? null;
    const mode = existing ? "existing" : "new";
    const sessionId = existing ? existing.id : null;

    // An imported round never carries a location: the file column is ignored and
    // null is stored, so several places in one round cannot pick one of them.
    const times = [...new Set(group.candidates.map((candidate) => candidate.time))].sort();

    const statusCounts = EMPTY_COUNTS();
    const shiftCounts = { "กะ A": 0, "กะ B": 0 };
    const seen = new Set();
    const entries = [];

    for (const candidate of group.candidates) {
      if (seen.has(candidate.employeeId)) {
        skipped.push({
          row: candidate.row,
          typeName: candidate.typeName,
          dateIso: candidate.dateIso,
          name: candidate.employeeName,
          reason: REASON_DUPLICATE_IN_ROUND,
        });
        continue;
      }
      seen.add(candidate.employeeId);

      if (sessionId && recorded.has(`${sessionId}:${candidate.employeeId}`)) {
        skipped.push({
          row: candidate.row,
          typeName: candidate.typeName,
          dateIso: candidate.dateIso,
          name: candidate.employeeName,
          reason: REASON_ALREADY_RECORDED,
        });
        continue;
      }

      entries.push({
        row: candidate.row,
        employeeId: candidate.employeeId,
        employeeName: candidate.employeeName,
        time: candidate.time,
        registeredAt: candidate.registeredAt,
        statusCode: candidate.statusCode,
        shift: candidate.shift,
        reason: candidate.reason,
      });
      statusCounts[candidate.statusCode] += 1;
      if (candidate.statusCode === "leave" && candidate.shift) shiftCounts[candidate.shift] += 1;
    }

    rounds.push({
      key: group.key,
      typeId: group.typeId,
      typeCode: group.typeCode,
      typeName: group.typeName,
      dateIso: group.dateIso,
      // The stored round has no time of its own; `times` lists the file times of
      // the people in it, for display only.
      time: "",
      times,
      location: null,
      rows: entries.length,
      fileRows: group.candidates.length,
      mode,
      decision: null,
      sessionId,
      existing: existing
        ? {
            sessionId: existing.id,
            time: normalizeClock(existing.session_time),
            location: normalizeLocationValue(existing.location),
          }
        : null,
      statusCounts,
      shiftCounts,
      entries,
    });

    writtenRows += entries.length;
  }

  rounds.sort((a, b) =>
    a.dateIso === b.dateIso ? a.typeCode.localeCompare(b.typeCode) : a.dateIso.localeCompare(b.dateIso)
  );

  const summary = {
    dataRows: rows.length,
    rounds: rounds.length,
    newRounds: rounds.filter((round) => round.mode === "new").length,
    existingRounds: rounds.filter((round) => round.mode === "existing").length,
    // Kept so older clients keep working; a round is never a conflict now.
    joinedRounds: 0,
    conflictRounds: 0,
    needsDecision: 0,
    pendingRows: 0,
    writeRounds: rounds.length,
    writeRows: writtenRows,
    skipped: skipped.length,
  };

  return { rounds, skipped, summary };
}
