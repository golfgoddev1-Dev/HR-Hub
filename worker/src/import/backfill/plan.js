// Pure planning for the historical attendance import ("ข้อมูลย้อนหลัง").
// No database access: the caller supplies meeting types, employees, the
// sessions that already exist for the dates in the file and the
// (session, employee) pairs that are already recorded.
//
// A round is identified by ประเภท + วันที่ + เวลา + สถานที่. When a session for
// the same type and date already exists with a different time or location, the
// round is a conflict: HR either joins the existing round ("join") or skips it.
// Anything not chosen is skipped.

import { REASONS, collapseWhitespace, matchEmployees, validateBackfillRow } from "./validate.js";

export const DECISION_JOIN = "join";
export const DECISION_SKIP = "skip";

export const REASON_DUPLICATE_IN_ROUND = "ชื่อพนักงานซ้ำในรอบเดียวกันของไฟล์";
export const REASON_ALREADY_RECORDED = "มีข้อมูลของคนนี้ในรอบนี้แล้ว";
export const REASON_CONFLICT_SKIPPED = "รอบนี้มีอยู่ในระบบด้วยเวลา/สถานที่ต่างกัน และเลือกข้าม";

/** HH:mm from a text or time column value ("10:00", "10:00:00"). */
export function normalizeClock(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(text);
  return match ? `${match[1]}:${match[2]}` : "";
}

export function normalizeLocationValue(value) {
  return collapseWhitespace(value ?? "");
}

export function roundKeyOf(typeId, dateIso, time, location) {
  return [typeId, dateIso, time, normalizeLocationValue(location)].join("|");
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
 * @param {Map<string, string>} [input.decisions]  round key -> "join" | "skip"
 */
export function buildBackfillPlan(input) {
  const {
    rows = [],
    meetingTypes = [],
    employees = [],
    sessions = [],
    recorded = new Set(),
    decisions = new Map(),
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
      location: normalizeLocationValue(data.location),
      statusCode: data.statusCode,
      shift: data.shift,
      reason: data.reason,
    });
  }

  // A round is keyed by type + date + time: one type can have several rounds a day.
  const sessionByRoundKey = new Map();
  for (const session of sessions) {
    if (!session || !session.id) continue;
    const time = normalizeClock(session.session_time);
    sessionByRoundKey.set(`${session.meeting_type_id}|${session.session_date}|${time}`, session);
  }

  const groups = new Map();
  for (const entry of valid) {
    const key = roundKeyOf(entry.typeId, entry.dateIso, entry.time, entry.location);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        typeId: entry.typeId,
        typeCode: entry.typeCode,
        typeName: entry.typeName,
        dateIso: entry.dateIso,
        time: entry.time,
        location: entry.location,
        candidates: [],
      });
    }
    groups.get(key).candidates.push(entry);
  }

  const rounds = [];
  let writtenRows = 0;
  let pendingRounds = 0;
  let pendingRows = 0;

  for (const group of groups.values()) {
    const lookupKey = `${group.typeId}|${group.dateIso}|${group.time}`;
    const existing = sessionByRoundKey.get(lookupKey) ?? null;
    const existingTime = existing ? normalizeClock(existing.session_time) : "";
    const existingLocation = existing ? normalizeLocationValue(existing.location) : "";

    let mode = "new";
    let sessionId = null;
    let decision = null;

    if (existing) {
      if (existingLocation === group.location) {
        mode = "existing";
        sessionId = existing.id;
      } else {
        decision = decisions.get(group.key) === DECISION_JOIN ? DECISION_JOIN : DECISION_SKIP;
        if (decision === DECISION_JOIN) {
          mode = "joined";
          sessionId = existing.id;
        } else {
          mode = "conflict";
        }
      }
    }

    const statusCounts = EMPTY_COUNTS();
    const shiftCounts = { "กะ A": 0, "กะ B": 0 };
    const seen = new Set();
    const entries = [];
    let roundSkipped = 0;

    for (const candidate of group.candidates) {
      if (mode === "conflict") {
        roundSkipped += 1;
        continue;
      }
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
        statusCode: candidate.statusCode,
        shift: candidate.shift,
        reason: candidate.reason,
      });
      statusCounts[candidate.statusCode] += 1;
      if (candidate.statusCode === "leave" && candidate.shift) shiftCounts[candidate.shift] += 1;
    }

    const round = {
      key: group.key,
      typeId: group.typeId,
      typeCode: group.typeCode,
      typeName: group.typeName,
      dateIso: group.dateIso,
      time: group.time,
      location: group.location,
      rows: entries.length,
      fileRows: group.candidates.length,
      mode,
      decision,
      sessionId,
      existing: existing
        ? { sessionId: existing.id, time: existingTime, location: existingLocation }
        : null,
      statusCounts,
      shiftCounts,
      entries,
    };

    if (mode === "conflict") {
      pendingRounds += 1;
      pendingRows += roundSkipped;
    } else {
      writtenRows += entries.length;
    }

    if (roundSkipped > 0 && mode === "conflict") {
      round.skippedRows = roundSkipped;
    }

    rounds.push(round);
  }

  rounds.sort((a, b) => (a.dateIso === b.dateIso ? a.time.localeCompare(b.time) : a.dateIso.localeCompare(b.dateIso)));

  const summary = {
    dataRows: rows.length,
    rounds: rounds.length,
    newRounds: rounds.filter((round) => round.mode === "new").length,
    existingRounds: rounds.filter((round) => round.mode === "existing").length,
    joinedRounds: rounds.filter((round) => round.mode === "joined").length,
    conflictRounds: pendingRounds,
    needsDecision: pendingRounds,
    pendingRows,
    writeRounds: rounds.filter((round) => round.mode !== "conflict").length,
    writeRows: writtenRows,
    skipped: skipped.length,
  };

  return { rounds, skipped, summary };
}
