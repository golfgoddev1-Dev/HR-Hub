// Historical attendance ("ข้อมูลย้อนหลัง") routes.
// Mounted at /api/meeting/backfill by src/app.js. Every route requires the
// meeting_controller login role; the frontend hiding a page is never the control.
//
// Two upload shapes share one planning and writing path:
//   - multipart (one .xlsx per request), kept for scripts and small files;
//   - JSON batches (at most 500 rows each) that the browser sends after it has
//     read the workbook itself, so the Worker never unzips a large file.
//
// Reads never aggregate in the database: PostgREST returns rows, the Worker
// counts them, and every read is bounded by a page size or a hard row cap.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { buildBackfillPlan, DECISION_JOIN, normalizeClock, normalizeLocationValue } from "../import/backfill/plan.js";
import { buildBackfillTemplateXlsx } from "../import/backfill/template.js";
import { BACKFILL_HEADERS, parseDateCell } from "../import/backfill/validate.js";
import { XlsxError, buildSheetXlsx, parseXlsx } from "../import/xlsx.js";
import { requireRole } from "../require-role.js";

const backfill = new Hono();

const ROLE = "meeting_controller";

const TYPES_TABLE = "meeting_types";
const SESSIONS_TABLE = "meeting_sessions";
const ATTENDANCE_TABLE = "meeting_attendance";
const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const AUDIT_TABLE = "audit_logs";

const AUDIT_ACTION = "meeting_backfill_imported";
const AUDIT_ENTITY = "meeting_backfill";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_FILE_BYTES + 128 * 1024;
const MAX_DATA_ROWS = 5000;
const MAX_BATCH_ROWS = 500;
const MAX_CELL_LENGTH = 500;
const MAX_DECISIONS = 500;
const MAX_BODY_BYTES = 512 * 1024;

const PAGE_SIZE = 20;
const EXPORT_LIMIT = 5000;
const QUERY_CHUNK = 100;
const FETCH_PAGE = 1000;

const INVALID_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const NO_FILE_MESSAGE = "ไม่พบไฟล์ที่อัปโหลด";
const SAVE_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const SEARCH_TOO_SHORT_MESSAGE = "กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา";
const SEARCH_ERROR_MESSAGE = "ไม่พบพนักงานที่ระบุ";
const HEADER_MESSAGE = "หัวคอลัมน์ไม่ตรงกับเทมเพลต (ต้องมี A–G ครบตามลำดับ)";
const EMPTY_FILE_MESSAGE = "ไม่พบแถวข้อมูลในไฟล์";
const TOO_MANY_ROWS_MESSAGE = `ไฟล์มีข้อมูลเกิน ${MAX_DATA_ROWS} แถว กรุณาแบ่งไฟล์`;
const MISSING_COLUMNS_MESSAGE =
  "ยังไม่ได้เพิ่มคอลัมน์ของข้อมูลย้อนหลัง (session_time, location) กรุณารันไฟล์ worker/sql/backfill-columns.sql ก่อน";

// The one reason a route answers 503: the database has not been migrated yet.
const UNDEFINED_COLUMN = "42703";

const STATUS_CODES = ["attended", "leave", "not_attended", "urgent_busy"];
const STATUS_LABEL_BY_CODE = {
  attended: "เข้าร่วมประชุม",
  leave: "ลาประชุม",
  not_attended: "ไม่เข้าร่วม",
  urgent_busy: "ติดงานด่วน",
};
const SHIFTS = ["กะ A", "กะ B"];

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

backfill.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

function ensureOk(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}

async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return c.json({ ok: false, message: auth.message }, auth.status);
  }
  c.set("controllerSession", auth.session);
  return null;
}

function isMissingColumn(error) {
  return error?.code === UNDEFINED_COLUMN || /column .* does not exist/i.test(String(error?.message ?? ""));
}

function errorResponse(c, scope, error) {
  logError(scope, error);
  if (isMissingColumn(error)) {
    return c.json({ ok: false, message: MISSING_COLUMNS_MESSAGE }, 503);
  }
  return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
}

/** Escapes LIKE wildcards so a typed % cannot match everything. */
function likeValue(text) {
  return `%${String(text).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function collapse(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Reads every row of a small table, page by page, capped. */
async function loadAll(db, table, columns, filters = [], cap = 6000) {
  const rows = [];
  let offset = 0;
  while (offset < cap) {
    const page = await db.select(table, {
      columns,
      filters,
      order: "id.asc",
      limit: FETCH_PAGE,
      extra: offset > 0 ? [`offset=${offset}`] : [],
    });
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
    offset += FETCH_PAGE;
  }
  return rows;
}

function chunk(list, size) {
  const out = [];
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size));
  return out;
}

// --- upload -----------------------------------------------------------------

function headerMatches(row) {
  const cells = Array.isArray(row) ? row : [];
  const required = BACKFILL_HEADERS.slice(0, 7);
  for (let index = 0; index < required.length; index += 1) {
    if (collapse(cells[index]) !== required[index]) return false;
  }
  return true;
}

function isZipSignature(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Reads the uploaded workbook from a multipart body. */
async function readUpload(c) {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    return { ok: false, message: "ไฟล์ใหญ่เกิน 5 MB" };
  }

  let form;
  try {
    form = await c.req.formData();
  } catch {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return { ok: false, message: NO_FILE_MESSAGE };
  }
  if (typeof file.size === "number" && file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "ไฟล์ใหญ่เกิน 5 MB" };
  }

  const name = String(file.name ?? "");
  if (!name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, message: "รับเฉพาะไฟล์ .xlsx" };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZipSignature(bytes)) {
    return { ok: false, message: "ไฟล์ .xlsx ต้องเป็นไฟล์ Excel ที่ถูกต้อง" };
  }

  let sheetRows;
  try {
    sheetRows = parseXlsx(bytes);
  } catch (error) {
    if (error instanceof XlsxError) {
      return { ok: false, message: "อ่านไฟล์ Excel ไม่ได้ (ไม่รับไฟล์ที่มี macro หรือลิงก์ภายนอก)" };
    }
    throw error;
  }

  if (sheetRows.length === 0) return { ok: false, message: EMPTY_FILE_MESSAGE };
  if (!headerMatches(sheetRows[0])) return { ok: false, message: HEADER_MESSAGE };

  const rows = [];
  for (let index = 1; index < sheetRows.length; index += 1) {
    const cells = sheetRows[index];
    if (!Array.isArray(cells)) continue;
    if (!cells.some((cell) => collapse(cell) !== "")) continue;
    rows.push({ rowNumber: index + 1, cells });
    if (rows.length > MAX_DATA_ROWS) return { ok: false, message: TOO_MANY_ROWS_MESSAGE };
  }
  if (rows.length === 0) return { ok: false, message: EMPTY_FILE_MESSAGE };

  return { ok: true, rows, fileName: name, form };
}

/**
 * Reads one JSON batch: { fileName, startRow, rows: string[][], decisions?, final?, totals? }.
 * The browser has already read the workbook, so only plain rows arrive here.
 */
async function readBatch(c) {
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, message: INVALID_MESSAGE };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const rawRows = body.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > MAX_BATCH_ROWS) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const startRow = Number(body.startRow);
  if (!Number.isInteger(startRow) || startRow < 2) return { ok: false, message: INVALID_MESSAGE };

  // The sheet row of every row, so a batch that skipped blank rows still
  // reports the real row numbers the controller sees in Excel.
  const rowNumbers = Array.isArray(body.rowNumbers) ? body.rowNumbers : null;
  if (rowNumbers && rowNumbers.length !== rawRows.length) return { ok: false, message: INVALID_MESSAGE };

  // The browser matched each name against the employee list; only the ids of
  // matched rows arrive here and each one is checked again below.
  const employeeIds = Array.isArray(body.employeeIds) ? body.employeeIds : null;
  if (employeeIds && employeeIds.length !== rawRows.length) return { ok: false, message: INVALID_MESSAGE };
  if (employeeIds) {
    for (const value of employeeIds) {
      if (value === null || value === undefined) continue;
      if (typeof value !== "string" || !UUID_PATTERN.test(value)) return { ok: false, message: INVALID_MESSAGE };
    }
  }

  const rows = [];
  for (let index = 0; index < rawRows.length; index += 1) {
    const raw = rawRows[index];
    if (!Array.isArray(raw) || raw.length > BACKFILL_HEADERS.length + 4) {
      return { ok: false, message: INVALID_MESSAGE };
    }
    const cells = [];
    for (const value of raw) {
      if (value === null || value === undefined) {
        cells.push("");
        continue;
      }
      if (typeof value === "object") return { ok: false, message: INVALID_MESSAGE };
      const text = String(value);
      if (text.length > MAX_CELL_LENGTH) return { ok: false, message: INVALID_MESSAGE };
      cells.push(text);
    }
    let rowNumber = startRow + index;
    if (rowNumbers) {
      const explicit = Number(rowNumbers[index]);
      if (!Number.isInteger(explicit) || explicit < 2) return { ok: false, message: INVALID_MESSAGE };
      rowNumber = explicit;
    }
    const employeeId = employeeIds ? employeeIds[index] ?? null : null;
    rows.push({ rowNumber, cells, employeeId });
  }

  const decisions = readDecisions(body.decisions);
  if (decisions === null) return { ok: false, message: INVALID_MESSAGE };

  const fileName = collapse(body.fileName).slice(0, 120) || "backfill.xlsx";
  const final = body.final === true;
  const totals = final ? readTotals(body.totals) : null;
  if (final && totals === null) return { ok: false, message: INVALID_MESSAGE };

  return { ok: true, rows, decisions, fileName, final, totals };
}

function readDecisions(raw) {
  if (raw === null || raw === undefined || raw === "") return new Map();
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_DECISIONS) return null;

  const decisions = new Map();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (typeof entry.key !== "string" || entry.key.length === 0 || entry.key.length > 200) return null;
    if (entry.decision === DECISION_JOIN) decisions.set(entry.key, DECISION_JOIN);
    else if (entry.decision === "skip") decisions.set(entry.key, "skip");
    else return null;
  }
  return decisions;
}

/** Counters the browser accumulated across batches, for the single audit row. */
function readTotals(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = ["rounds", "sessionsCreated", "sessionsReused", "attendance", "skipped", "conflictsSkipped"];
  const totals = {};
  for (const key of keys) {
    const value = Number(raw[key]);
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) return null;
    totals[key] = value;
  }
  return totals;
}

// --- database reads shared by preview and confirm ---------------------------

async function loadPlanInputs(db, rows) {
  const [types, employees] = await Promise.all([
    db.select(TYPES_TABLE, { columns: "id,code,name", order: "code.asc" }),
    loadAll(db, EMPLOYEES_TABLE, "id,full_name,name_prefix,employee_code", [], 8000),
  ]);

  // session_date is an ISO date in the database while the file carries either an
  // Excel serial or dd/mm/yyyy, so the lookup uses the parsed date, not the raw cell.
  const dates = [
    ...new Set(
      rows
        .map((row) => {
          const parsed = parseDateCell(row.cells?.[1]);
          return parsed.ok ? parsed.iso : String(row.cells?.[1] ?? "").trim();
        })
        .filter(Boolean)
    ),
  ];
  const typeIds = types.map((type) => type.id).filter(Boolean);

  const sessions = [];
  if (dates.length > 0 && typeIds.length > 0) {
    for (const group of chunk(dates, QUERY_CHUNK)) {
      const found = await db.select(SESSIONS_TABLE, {
        columns: "id,meeting_type_id,session_date,session_time,location",
        filters: [
          ["meeting_type_id", "in", typeIds],
          ["session_date", "in", group],
        ],
      });
      sessions.push(...found);
    }
  }

  const recorded = new Set();
  const sessionIds = sessions.map((session) => session.id).filter(Boolean);
  for (const group of chunk(sessionIds, QUERY_CHUNK)) {
    const existing = await db.select(ATTENDANCE_TABLE, {
      columns: "session_id,employee_id",
      filters: [["session_id", "in", group]],
    });
    for (const row of existing) recorded.add(`${row.session_id}:${row.employee_id}`);
  }

  return { types, employees, sessions, recorded };
}

async function planForRows(db, rows, decisions) {
  const inputs = await loadPlanInputs(db, rows);
  return buildBackfillPlan({
    rows,
    meetingTypes: inputs.types,
    employees: inputs.employees,
    sessions: inputs.sessions,
    recorded: inputs.recorded,
    decisions,
  });
}

function publicRound(round) {
  return {
    key: round.key,
    typeCode: round.typeCode,
    typeName: round.typeName,
    dateIso: round.dateIso,
    time: round.time,
    location: round.location,
    rows: round.rows,
    fileRows: round.fileRows,
    mode: round.mode,
    decision: round.decision,
    sessionId: round.sessionId,
    existing: round.existing,
    statusCounts: round.statusCounts,
    shiftCounts: round.shiftCounts,
  };
}

function previewPayload(fileName, plan) {
  return {
    ok: true,
    fileName,
    settings: { maxFileBytes: MAX_FILE_BYTES, maxRows: MAX_DATA_ROWS, batchRows: MAX_BATCH_ROWS },
    summary: plan.summary,
    rounds: plan.rounds.map(publicRound),
    skipped: plan.skipped.slice(0, 500),
    skippedTotal: plan.skipped.length,
  };
}

/**
 * Writes one plan. `totals` is present only on the last batch of an import, so
 * the audit row counts the whole import while the writes count this batch.
 */
async function applyPlan(db, plan, { fileName, actorId, totals = null }) {
  const writable = plan.rounds.filter((round) => round.mode !== "conflict" && round.entries.length > 0);

  // 1. New rounds: one upsert. The unique key is (meeting_type_id, session_date,
  //    session_time), so a round that raced into existence is reused instead of
  //    duplicated. open_time/cutoff_time describe a registration window that is
  //    irrelevant for a past date and are set to a closed full day.
  const newRounds = writable.filter((round) => round.mode === "new");
  const sessionIdByRound = new Map(
    writable.filter((round) => round.sessionId).map((round) => [round.key, round.sessionId])
  );

  if (newRounds.length > 0) {
    const sessionRows = newRounds.map((round) => ({
      meeting_type_id: round.typeId,
      session_date: round.dateIso,
      cycle_key: `${round.typeCode}-${round.dateIso}`,
      session_time: round.time,
      location: round.location === "" ? null : round.location,
      open_time: "00:00",
      cutoff_time: "23:59",
    }));

    const created = ensureOk(
      await db.upsertMany(SESSIONS_TABLE, sessionRows, {
        conflict: "meeting_type_id,session_date,session_time",
        columns: "id,meeting_type_id,session_date,session_time",
      })
    );

    for (const row of created.data ?? []) {
      sessionIdByRound.set(`${row.meeting_type_id}|${row.session_date}|${row.session_time ?? ""}`, row.id);
    }
    for (const round of newRounds) {
      const id = sessionIdByRound.get(`${round.typeId}|${round.dateIso}|${round.time}`) ?? null;
      if (id) sessionIdByRound.set(round.key, id);
    }
  }

  // 2. Attendance rows. ignore-duplicates keeps an existing registration
  //    untouched instead of overwriting status, reason or registered_at.
  const attendanceRows = [];
  for (const round of writable) {
    const sessionId =
      sessionIdByRound.get(round.key) ??
      sessionIdByRound.get(`${round.typeId}|${round.dateIso}|${round.time}`);
    if (!sessionId) continue;
    for (const entry of round.entries) {
      attendanceRows.push({
        session_id: sessionId,
        employee_id: entry.employeeId,
        status_code: entry.statusCode,
        reason: entry.reason,
        shift: entry.shift,
        registered_at: new Date().toISOString(),
      });
    }
  }

  if (attendanceRows.length > 0) {
    for (const group of chunk(attendanceRows, 500)) {
      ensureOk(await db.insert(ATTENDANCE_TABLE, group, { ignoreDuplicates: true }));
    }
  }

  const conflictsSkipped = plan.rounds.filter((round) => round.mode === "conflict").length;
  const counts = {
    rounds: writable.length,
    sessionsCreated: newRounds.length,
    sessionsReused: writable.length - newRounds.length,
    attendance: attendanceRows.length,
    skipped: plan.skipped.length,
    conflictsSkipped,
  };

  // 3. One audit row per import (only the last batch of a chunked import writes
  //    it). No employee name, no reason text, no file contents beyond its name.
  if (totals) {
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: actorId,
        action: AUDIT_ACTION,
        entity: AUDIT_ENTITY,
        entity_id: null,
        detail: { file: fileName, ...totals },
      })
    );
  }

  return {
    sessionsCreated: counts.sessionsCreated,
    sessionsReused: counts.sessionsReused,
    attendanceWritten: counts.attendance,
    conflictsSkipped: counts.conflictsSkipped,
    skipped: counts.skipped,
    skippedRows: plan.skipped,
  };
}

// --- GET /api/meeting/backfill/template -------------------------------------

backfill.get("/template", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const bytes = buildBackfillTemplateXlsx();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": 'attachment; filename="meeting-backfill-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});

// --- GET /api/meeting/backfill/meta -----------------------------------------

backfill.get("/meta", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const db = createDb(c.env);
    const [types, departments, positions] = await Promise.all([
      db.select(TYPES_TABLE, { columns: "code,name", order: "code.asc" }),
      db.select(DEPARTMENTS_TABLE, { columns: "id,name", order: "name.asc", limit: 500 }),
      db.select(POSITIONS_TABLE, { columns: "id,name", order: "name.asc", limit: 500 }),
    ]);

    return c.json(
      {
        ok: true,
        types: types.map((type) => ({ code: type.code ?? "", name: type.name ?? "" })),
        departments: departments
          .filter((row) => row.id && row.name)
          .map((row) => ({ id: row.id, name: row.name })),
        positions: positions.filter((row) => row.id && row.name).map((row) => ({ id: row.id, name: row.name })),
        statuses: STATUS_CODES.map((code) => ({ code, label: STATUS_LABEL_BY_CODE[code] })),
        shifts: SHIFTS,
        settings: { maxFileBytes: MAX_FILE_BYTES, maxRows: MAX_DATA_ROWS, batchRows: MAX_BATCH_ROWS },
      },
      200
    );
  } catch (error) {
    return errorResponse(c, "backfill meta failed", error);
  }
});

// --- GET /api/meeting/backfill/employees ------------------------------------
// The list the browser matches names against. Ids only, no national ID, no
// department or position: the department and level always come from employees
// at read time.

backfill.get("/employees", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const db = createDb(c.env);
    const rows = await loadAll(
      db,
      EMPLOYEES_TABLE,
      "id,full_name,name_prefix,employee_code,is_active",
      [["is_active", "eq", true]],
      8000
    );

    return c.json(
      {
        ok: true,
        count: rows.length,
        employees: rows
          .filter((row) => row.id && row.full_name)
          .map((row) => ({
            id: row.id,
            full_name: row.full_name,
            name_prefix: row.name_prefix ?? "",
          })),
      },
      200
    );
  } catch (error) {
    return errorResponse(c, "backfill employee list failed", error);
  }
});

// --- POST /api/meeting/backfill/preview (multipart .xlsx) --------------------

backfill.post("/preview", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const upload = await readUpload(c);
    if (!upload.ok) return c.json({ ok: false, message: upload.message }, 400);

    const decisions = readDecisions(upload.form ? upload.form.get("decisions") : null);
    if (decisions === null) return c.json({ ok: false, message: INVALID_MESSAGE }, 400);

    const db = createDb(c.env);
    const plan = await planForRows(db, upload.rows, decisions);
    return c.json(previewPayload(upload.fileName, plan), 200);
  } catch (error) {
    return errorResponse(c, "backfill preview failed", error);
  }
});

// --- POST /api/meeting/backfill/preview-batch (JSON rows, at most 500) -------

backfill.post("/preview-batch", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const batch = await readBatch(c);
    if (!batch.ok) return c.json({ ok: false, message: batch.message }, 400);

    const db = createDb(c.env);
    const plan = await planForRows(db, batch.rows, batch.decisions);
    return c.json(previewPayload(batch.fileName, plan), 200);
  } catch (error) {
    return errorResponse(c, "backfill preview batch failed", error);
  }
});

// --- POST /api/meeting/backfill/confirm (multipart .xlsx) --------------------

backfill.post("/confirm", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const upload = await readUpload(c);
    if (!upload.ok) return c.json({ ok: false, message: upload.message }, 400);

    const decisions = readDecisions(upload.form ? upload.form.get("decisions") : null);
    if (decisions === null) return c.json({ ok: false, message: INVALID_MESSAGE }, 400);

    const db = createDb(c.env);
    const plan = await planForRows(db, upload.rows, decisions);
    const actorId = c.get("controllerSession").employeeId;

    const summary = await applyPlan(db, plan, { fileName: upload.fileName, actorId });
    const totals = {
      rounds: summary.sessionsCreated + summary.sessionsReused,
      sessionsCreated: summary.sessionsCreated,
      sessionsReused: summary.sessionsReused,
      attendance: summary.attendanceWritten,
      skipped: summary.skipped,
      conflictsSkipped: summary.conflictsSkipped,
    };
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: actorId,
        action: AUDIT_ACTION,
        entity: AUDIT_ENTITY,
        entity_id: null,
        detail: { file: upload.fileName, ...totals },
      })
    );

    return c.json({ ok: true, summary }, 200);
  } catch (error) {
    return errorResponse(c, "backfill confirm failed", error);
  }
});

// --- POST /api/meeting/backfill/confirm-batch --------------------------------

backfill.post("/confirm-batch", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const batch = await readBatch(c);
    if (!batch.ok) return c.json({ ok: false, message: batch.message }, 400);

    const db = createDb(c.env);
    const plan = await planForRows(db, batch.rows, batch.decisions);
    const actorId = c.get("controllerSession").employeeId;

    const summary = await applyPlan(db, plan, {
      fileName: batch.fileName,
      actorId,
      totals: batch.final ? batch.totals : null,
    });

    return c.json({ ok: true, final: batch.final, summary }, 200);
  } catch (error) {
    return errorResponse(c, "backfill confirm batch failed", error);
  }
});

// --- history filters ---------------------------------------------------------

function dateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null;
}

function readFilters(url) {
  const query = new URL(url).searchParams;
  const params = query;

  const year = /^\d{4}$/.test(query.get("year") ?? "") ? query.get("year") : null;
  const month = /^\d{4}-\d{2}$/.test(query.get("month") ?? "") ? query.get("month") : null;
  const from = dateText(query.get("from"));
  const to = dateText(query.get("to"));
  const type = ["sup", "monthly"].includes(query.get("type") ?? "") ? query.get("type") : null;
  const status = STATUS_CODES.includes(query.get("status") ?? "") ? query.get("status") : null;
  const shift = SHIFTS.includes(query.get("shift") ?? "") ? query.get("shift") : null;
  const dept = UUID_PATTERN.test(query.get("dept") ?? "") ? query.get("dept") : null;
  const position = UUID_PATTERN.test(query.get("position") ?? "") ? query.get("position") : null;
  const location = collapse(query.get("location")).slice(0, 120) || null;
  const q = collapse(query.get("q")).slice(0, 120) || null;
  const page = Math.max(1, Math.min(500, Number(query.get("page") ?? 1) || 1)) || 1;

  return {
    year,
    month,
    from,
    to,
    type,
    status,
    shift,
    dept,
    position,
    location,
    q,
    page,
    params,
  };
}

const FILTER_ECHO_KEYS = ["year", "month", "from", "to", "type", "status", "shift", "dept", "position", "location", "q"];

function echoFilters(filters) {
  const out = {};
  for (const key of FILTER_ECHO_KEYS) out[key] = filters[key];
  return out;
}

/** The inclusive date range for the session_date column. */
function dateRange(filters) {
  if (filters.from || filters.to) {
    return { from: filters.from ?? "1900-01-01", to: filters.to ?? "2999-12-31" };
  }
  if (filters.year) return { from: `${filters.year}-01-01`, to: `${filters.year}-12-31` };
  if (filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { from: `${filters.month}-01`, to: `${filters.month}-${String(lastDay).padStart(2, "0")}` };
  }
  return null;
}

function typeIdOf(types, code) {
  const found = types.find((type) => type.code === code);
  return found ? found.id : null;
}

async function loadFilterOptions(db) {
  const [departments, positions] = await Promise.all([
    db.select(DEPARTMENTS_TABLE, { columns: "id,name", order: "name.asc", limit: 500 }),
    db.select(POSITIONS_TABLE, { columns: "id,name", order: "name.asc", limit: 500 }),
  ]);
  return {
    departments: departments.filter((row) => row.id && row.name).map((row) => ({ id: row.id, name: row.name })),
    positions: positions.filter((row) => row.id && row.name).map((row) => ({ id: row.id, name: row.name })),
  };
}

// --- GET /api/meeting/backfill/history/rounds -------------------------------

backfill.get("/history/rounds", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const filters = readFilters(c.req.url);
    const db = createDb(c.env);
    const [types, options] = await Promise.all([
      db.select(TYPES_TABLE, { columns: "id,code,name", order: "code.asc" }),
      loadFilterOptions(db),
    ]);

    const sessionFilters = [];
    if (filters.type) {
      const id = typeIdOf(types, filters.type);
      if (!id) return c.json({ ok: false, message: "ประเภทการประชุมไม่ถูกต้อง" }, 400);
      sessionFilters.push(["meeting_type_id", "eq", id]);
    }
    const range = dateRange(filters);
    if (range) {
      sessionFilters.push(["session_date", "gte", range.from], ["session_date", "lte", range.to]);
    }
    if (filters.location) sessionFilters.push(["location", "ilike", likeValue(filters.location)]);

    const offset = (filters.page - 1) * PAGE_SIZE;
    const sessions = await db.select(SESSIONS_TABLE, {
      columns: "id,meeting_type_id,session_date,session_time,location,cycle_key",
      filters: sessionFilters,
      order: "session_date.desc,id.desc",
      limit: PAGE_SIZE,
      extra: offset > 0 ? [`offset=${offset}`] : [],
    });

    const countsBySession = new Map();
    const sessionIds = sessions.map((session) => session.id).filter(Boolean);
    for (const group of chunk(sessionIds, QUERY_CHUNK)) {
      const attendanceFilters = [["session_id", "in", group]];
      if (filters.status) attendanceFilters.push(["status_code", "eq", filters.status]);
      if (filters.shift) attendanceFilters.push(["shift", "eq", filters.shift]);
      if (filters.dept) attendanceFilters.push(["employees.department_id", "eq", filters.dept]);
      if (filters.position) attendanceFilters.push(["employees.position_id", "eq", filters.position]);
      if (filters.q) attendanceFilters.push(["employees.full_name", "ilike", likeValue(filters.q)]);

      const rows = await db.select(ATTENDANCE_TABLE, {
        columns: "session_id,status_code,shift,employees!inner(department_id,position_id,full_name)",
        filters: attendanceFilters,
      });

      for (const row of rows) {
        const bucket = countsBySession.get(row.session_id) ?? {
          attended: 0,
          leave: 0,
          not_attended: 0,
          urgent_busy: 0,
          leaveShift: { "กะ A": 0, "กะ B": 0 },
        };
        if (STATUS_CODES.includes(row.status_code)) bucket[row.status_code] += 1;
        if (row.status_code === "leave" && row.shift && row.shift in bucket.leaveShift) {
          bucket.leaveShift[row.shift] += 1;
        }
        countsBySession.set(row.session_id, bucket);
      }
    }

    const typeById = new Map(types.map((type) => [type.id, type]));
    const rounds = sessions.map((session) => {
      const counts = countsBySession.get(session.id) ?? {
        attended: 0,
        leave: 0,
        not_attended: 0,
        urgent_busy: 0,
        leaveShift: { "กะ A": 0, "กะ B": 0 },
      };
      const total = counts.attended + counts.leave + counts.not_attended + counts.urgent_busy;
      return {
        id: session.id,
        date: session.session_date ?? null,
        time: normalizeClock(session.session_time) || null,
        location: normalizeLocationValue(session.location) || null,
        cycleKey: session.cycle_key ?? null,
        typeCode: typeById.get(session.meeting_type_id)?.code ?? null,
        typeName: typeById.get(session.meeting_type_id)?.name ?? null,
        counts: { ...counts, total },
      };
    });

    return c.json(
      {
        ok: true,
        page: filters.page,
        pageSize: PAGE_SIZE,
        hasMore: sessions.length === PAGE_SIZE,
        filters: echoFilters(filters),
        types: types.map((type) => ({ code: type.code ?? "", name: type.name ?? "" })),
        departments: options.departments,
        positions: options.positions,
        rounds,
      },
      200
    );
  } catch (error) {
    return errorResponse(c, "backfill history rounds failed", error);
  }
});

// --- GET /api/meeting/backfill/history/people -------------------------------

backfill.get("/history/people", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const url = new URL(c.req.url);
  const query = collapse(url.searchParams.get("q"));
  if (query.length < 2) {
    return c.json({ ok: false, message: SEARCH_TOO_SHORT_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const rows = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,full_name,departments(name),positions(name)",
      filters: [["full_name", "ilike", likeValue(query)]],
      order: "full_name.asc",
      limit: 10,
    });

    return c.json(
      {
        ok: true,
        query,
        people: rows.map((row) => ({
          id: row.id,
          employeeCode: row.employee_code ?? null,
          name: row.full_name ?? null,
          departmentName: firstEmbedded(row.departments)?.name ?? null,
          positionName: firstEmbedded(row.positions)?.name ?? null,
        })),
      },
      200
    );
  } catch (error) {
    return errorResponse(c, "backfill people search failed", error);
  }
});

// --- person history ----------------------------------------------------------

const HISTORY_COLUMNS =
  "id,status_code,reason,shift,registered_at,employees!inner(full_name,departments(name),positions(name)),meeting_sessions!inner(session_date,session_time,location,cycle_key,meeting_type_id,meeting_types!inner(code,name))";

function historyFilters(filters, types, employeeId) {
  const parts = [];
  if (employeeId) parts.push(["employee_id", "eq", employeeId]);
  if (filters.status) parts.push(["status_code", "eq", filters.status]);
  if (filters.shift) parts.push(["shift", "eq", filters.shift]);
  if (filters.type) {
    const id = typeIdOf(types, filters.type);
    if (!id) return null;
    parts.push(["meeting_sessions.meeting_type_id", "eq", id]);
  }
  const range = dateRange(filters);
  if (range) {
    parts.push(["meeting_sessions.session_date", "gte", range.from]);
    parts.push(["meeting_sessions.session_date", "lte", range.to]);
  }
  if (filters.location) parts.push(["meeting_sessions.location", "ilike", likeValue(filters.location)]);
  if (filters.dept) parts.push(["employees.department_id", "eq", filters.dept]);
  if (filters.position) parts.push(["employees.position_id", "eq", filters.position]);
  if (filters.q) parts.push(["employees.full_name", "ilike", likeValue(filters.q)]);
  return parts;
}

function mapHistoryRow(row) {
  const session = firstEmbedded(row.meeting_sessions);
  const type = session ? firstEmbedded(session.meeting_types) : null;
  const employee = firstEmbedded(row.employees);
  return {
    attendanceId: row.id,
    date: session?.session_date ?? null,
    time: normalizeClock(session?.session_time) || null,
    location: normalizeLocationValue(session?.location) || null,
    cycleKey: session?.cycle_key ?? null,
    typeCode: type?.code ?? null,
    typeName: type?.name ?? null,
    statusCode: row.status_code ?? null,
    statusLabel: STATUS_LABEL_BY_CODE[row.status_code] ?? null,
    shift: row.shift ?? null,
    reason: row.reason ?? null,
    registeredAt: row.registered_at ?? null,
    employeeName: employee?.full_name ?? null,
    departmentName: firstEmbedded(employee?.departments)?.name ?? null,
    positionName: firstEmbedded(employee?.positions)?.name ?? null,
  };
}

function sortHistory(items) {
  return items.sort((a, b) => {
    const left = `${a.date ?? ""}|${a.time ?? ""}`;
    const right = `${b.date ?? ""}|${b.time ?? ""}`;
    return right.localeCompare(left);
  });
}

async function loadHistoryRows(db, filters, types, employeeId, limit) {
  const parts = historyFilters(filters, types, employeeId);
  if (parts === null) return { error: "type" };

  const rows = [];
  let offset = 0;
  while (rows.length < limit) {
    const page = await db.select(ATTENDANCE_TABLE, {
      columns: HISTORY_COLUMNS,
      filters: parts,
      limit: FETCH_PAGE,
      extra: offset > 0 ? [`offset=${offset}`] : [],
    });
    rows.push(...page);
    if (page.length < FETCH_PAGE) break;
    offset += FETCH_PAGE;
  }
  return { rows: rows.slice(0, limit), truncated: rows.length >= limit };
}

// --- GET /api/meeting/backfill/history/employee -----------------------------

backfill.get("/history/employee", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const filters = readFilters(c.req.url);
  const employeeId = filters.params.get("employeeId");
  if (!UUID_PATTERN.test(String(employeeId ?? ""))) {
    return c.json({ ok: false, message: SEARCH_ERROR_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const types = await db.select(TYPES_TABLE, { columns: "id,code,name", order: "code.asc" });

    const loaded = await loadHistoryRows(db, filters, types, String(employeeId), FETCH_PAGE);
    if (loaded.error) return c.json({ ok: false, message: "ประเภทการประชุมไม่ถูกต้อง" }, 400);

    const sorted = sortHistory(loaded.rows.map(mapHistoryRow));
    const start = (filters.page - 1) * PAGE_SIZE;
    const items = sorted.slice(start, start + PAGE_SIZE);

    return c.json(
      {
        ok: true,
        page: filters.page,
        pageSize: PAGE_SIZE,
        hasMore: start + PAGE_SIZE < sorted.length,
        filtered: loaded.truncated,
        filters: echoFilters(filters),
        items,
      },
      200
    );
  } catch (error) {
    return errorResponse(c, "backfill employee history failed", error);
  }
});

// --- GET /api/meeting/backfill/history/export -------------------------------

function thaiDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function exportRow(item) {
  return [
    item.typeName ?? "",
    thaiDate(item.date),
    item.time ?? "",
    item.location ?? "",
    item.employeeName ?? "",
    item.statusLabel ?? "",
    item.shift ?? "",
    item.departmentName ?? "",
    item.positionName ?? "",
    item.cycleKey ?? "",
    "",
    item.reason ?? "",
  ];
}

backfill.get("/history/export", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const filters = readFilters(c.req.url);
  const employeeId = filters.params.get("employeeId");
  const scopedId = UUID_PATTERN.test(String(employeeId ?? "")) ? String(employeeId) : null;

  try {
    const db = createDb(c.env);
    const types = await db.select(TYPES_TABLE, { columns: "id,code,name", order: "code.asc" });
    const loaded = await loadHistoryRows(db, filters, types, scopedId, EXPORT_LIMIT);

    const items = sortHistory(loaded.rows.map(mapHistoryRow));
    const bytes = buildSheetXlsx({
      sheetName: "ข้อมูลย้อนหลัง",
      headers: BACKFILL_HEADERS,
      rows: items.map(exportRow),
      widths: [26, 14, 8, 24, 30, 16, 10, 22, 22, 16, 14, 32],
    });

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": 'attachment; filename="meeting-backfill-export.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(c, "backfill export failed", error);
  }
});

export default backfill;
