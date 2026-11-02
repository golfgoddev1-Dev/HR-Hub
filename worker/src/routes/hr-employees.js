// HR employee routes: the import page (template, preview, confirm) and the
// HR employee detail with the national ID reveal counter.
// Mounted at /api/hr/employees by src/app.js. Every route requires the hr role;
// the frontend hiding a button is never the control.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { getRequiredEnv } from "../env.js";
import { nationalIdHash } from "../national-id.js";
import { decryptNationalId, encryptNationalId } from "../import/national-id-crypto.js";
import { buildPlan, DECISION_USE_FILE } from "../import/plan.js";
import { FILE_ERRORS, MAX_DATA_ROWS, MAX_FILE_BYTES, XLSX_MIME, readTable } from "../import/file.js";
import { MAX_LENGTHS, maskNationalId } from "../import/validate.js";
import { buildTemplateXlsx } from "../import/xlsx.js";
import { checkRateLimit, clientIp, ipRateLimitKey } from "../rate-limit.js";
import { bangkokToday } from "../register-window.js";
import { requireRole } from "../require-role.js";

const hrEmployees = new Hono();

const ROLE = "hr";
const RATE_LIMIT_BINDING = "RL_CONTEXT_IP";
const RATE_LIMIT_IMPORT = "hr-import";
const RATE_LIMIT_REVEAL = "hr-national-id-reveal";

const EMPLOYEES_TABLE = "employees";
const CREDENTIALS_TABLE = "employee_credentials";
const DEPARTMENTS_TABLE = "departments";
const PREFIXES_TABLE = "name_prefixes";
const AUDIT_TABLE = "audit_logs";
const HR_ADMINS_TABLE = "hr_admins";

const IMPORT_ACTION = "employees_imported";
const IMPORT_ENTITY = "employee_import";
const VIEW_COUNTER_FUNCTION = "increment_national_id_view";

const MAX_CHOICES = MAX_DATA_ROWS;
const MAX_FORM_BYTES = MAX_FILE_BYTES + 64 * 1024;

const INVALID_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const NO_FILE_MESSAGE = "ไม่พบไฟล์ที่อัปโหลด";
const NOT_FOUND_MESSAGE = "ไม่พบพนักงาน";
const SAVE_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const NATIONAL_ID_UNAVAILABLE = "ไม่สามารถแสดงเลขบัตรประชาชนของรายการนี้ได้";
const NO_PREFIXES_MESSAGE = "ยังไม่มีรายการคำนำหน้าในระบบ กรุณาแจ้งผู้ดูแล";
const NO_DEPARTMENTS_MESSAGE = "ยังไม่มีรายการแผนกในระบบ กรุณาแจ้งผู้ดูแล";
const DUPLICATE_ID_MESSAGE = "เลขบัตรประชาชนซ้ำกับพนักงานคนอื่นในระบบ";
const FORBIDDEN_MESSAGE = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";
const SEARCH_TOO_SHORT_MESSAGE = "กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา";

// The HR index page: at least two characters, at most this many rows.
const MIN_SEARCH_LENGTH = 2;
const LIST_LIMIT = 50;

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const SETTINGS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxRows: MAX_DATA_ROWS,
  maxLengths: MAX_LENGTHS,
  acceptedTypes: [".xlsx", ".csv"],
};

hrEmployees.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Logs only the error name and code; never a message body, query or value. */
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

/**
 * The employee ids that already own each hash. Chunked because a 500-row file
 * would otherwise put hundreds of 64-character values into one query string.
 */
const HASH_LOOKUP_CHUNK = 100;

async function findHashOwners(db, hashes) {
  const owners = new Map();
  for (let index = 0; index < hashes.length; index += HASH_LOOKUP_CHUNK) {
    const chunk = hashes.slice(index, index + HASH_LOOKUP_CHUNK);
    const rows = await db.select(CREDENTIALS_TABLE, {
      columns: "employee_id,national_id_hash",
      filters: [["national_id_hash", "in", chunk]],
    });
    for (const row of rows) {
      const hash = String(row.national_id_hash ?? "").toLowerCase();
      if (hash.length === 0) continue;
      if (!owners.has(hash)) owners.set(hash, new Set());
      owners.get(hash).add(row.employee_id);
    }
  }
  return owners;
}

async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return c.json({ ok: false, message: auth.message }, auth.status);
  }
  c.set("hrSession", auth.session);
  return null;
}

async function limited(c, scope) {
  const result = await checkRateLimit(
    c.env,
    RATE_LIMIT_BINDING,
    ipRateLimitKey(scope, clientIp(c.req.raw))
  );
  if (result.ok) return null;
  return c.json({ ok: false, message: result.message }, result.status);
}

function encKey(env) {
  return getRequiredEnv(env, "NATIONAL_ID_ENC_KEY");
}

async function decryptStored(env, stored) {
  if (typeof stored !== "string" || stored.length === 0) return null;
  try {
    return await decryptNationalId(encKey(env), stored);
  } catch {
    return null;
  }
}

/** Reads and validates the uploaded file from a multipart body. */
async function readUpload(c) {
  const contentType = c.req.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return { ok: false, message: INVALID_MESSAGE };
  }

  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES) {
    return { ok: false, message: FILE_ERRORS.tooBig };
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
    return { ok: false, message: FILE_ERRORS.tooBig };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const table = readTable({ bytes, fileName: file.name });
  if (!table.ok) return { ok: false, message: table.error };
  return { ok: true, rows: table.rows, fileName: String(file.name ?? ""), form };
}

/** Parses the per-row decisions sent by the confirm step. */
function readDecisions(raw) {
  if (raw === null || raw === undefined || raw === "") return new Map();
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_CHOICES) return null;

  const decisions = new Map();
  for (const entry of parsed) {
    if (!isPlainObject(entry)) return null;
    const row = Number(entry.row);
    if (!Number.isInteger(row) || row < 2) return null;
    if (entry.decision === DECISION_USE_FILE) decisions.set(row, DECISION_USE_FILE);
    else if (entry.decision === "keep") decisions.set(row, "keep");
    else return null;
  }
  return decisions;
}

async function loadContext(env, db, rows) {
  const [prefixRows, departmentRows] = await Promise.all([
    db.select(PREFIXES_TABLE, { columns: "name", order: "name.asc" }),
    db.select(DEPARTMENTS_TABLE, { columns: "id,name", order: "name.asc" }),
  ]);

  const allowedPrefixes = prefixRows
    .map((row) => row.name)
    .filter((name) => typeof name === "string" && name.length > 0);
  const departments = departmentRows.filter(
    (row) => typeof row.name === "string" && row.name.length > 0 && row.id
  );

  if (allowedPrefixes.length === 0) return { error: NO_PREFIXES_MESSAGE };
  if (departments.length === 0) return { error: NO_DEPARTMENTS_MESSAGE };

  const codes = [
    ...new Set(rows.map((row) => String(row.cells[0] ?? "").trim()).filter(Boolean)),
  ];

  const employees = codes.length
    ? await db.select(EMPLOYEES_TABLE, {
        columns: "id,employee_code,full_name,name_prefix,department_id,is_active",
        filters: [["employee_code", "in", codes]],
      })
    : [];

  const employeeIds = employees.map((row) => row.id).filter(Boolean);
  const credentials = employeeIds.length
    ? await db.select(CREDENTIALS_TABLE, {
        columns: "employee_id,national_id_hash,national_id_enc",
        filters: [["employee_id", "in", employeeIds]],
      })
    : [];

  const pepper = getRequiredEnv(env, "NATIONAL_ID_PEPPER");

  return {
    allowedPrefixes,
    departments,
    counts: { prefixes: allowedPrefixes.length, departments: departments.length },
    existingByCode: new Map(employees.map((row) => [row.employee_code, row])),
    credentialByEmployeeId: new Map(credentials.map((row) => [row.employee_id, row])),
    hashOf: (digits) => nationalIdHash(digits, pepper),
    decryptOf: (stored) => decryptStored(env, stored),
  };
}

function publicChoice(choice) {
  return {
    row: choice.row,
    employeeCode: choice.employeeCode,
    name: choice.name,
    departmentName: choice.departmentName,
    fileIdMasked: choice.fileIdMasked,
    storedIdMasked: choice.storedIdMasked,
    decision: choice.decision,
  };
}

function publicRows(entries) {
  return entries.map((entry) => ({
    row: entry.row,
    employeeCode: entry.employee.employeeCode,
    name: entry.name,
    departmentName: entry.employee.departmentName,
  }));
}

/** First row of a to-one embed, which PostgREST returns as object or array. */
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Collapses whitespace and trims. The search text is never logged. */
function normalizeSearch(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The or filter for the name and employee code search. Each value is
 * URL-encoded so a comma or parenthesis in the typed text cannot open or close
 * the or=() group; PostgREST decodes each leaf value itself.
 */
function buildSearchFilter(pattern) {
  const encodeOrValue = (value) =>
    encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}

/** The hr login role is not enough: membership is re-read on every request. */
async function isHrAdmin(db, employeeId) {
  const row = await db.select(HR_ADMINS_TABLE, {
    columns: "employee_id",
    filters: [["employee_id", "eq", employeeId]],
    single: true,
  });
  return row !== null;
}

// --- GET /api/hr/employees?q=... ---------------------------------------------
// The employee list behind the HR index page. It reads the employees table
// only, so a national ID cannot appear in this response.

hrEmployees.get("/", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const query = normalizeSearch(new URL(c.req.raw.url).searchParams.get("q"));
  if (query.length < MIN_SEARCH_LENGTH) {
    return c.json({ ok: false, message: SEARCH_TOO_SHORT_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    if (!(await isHrAdmin(db, c.get("hrSession").employeeId))) {
      return c.json({ ok: false, message: FORBIDDEN_MESSAGE }, 403);
    }

    const rows = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,name_prefix,full_name,is_active,departments(name)",
      extra: [buildSearchFilter(`%${query}%`)],
      order: "employee_code.asc",
      limit: LIST_LIMIT,
    });

    const results = rows.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code ?? null,
      namePrefix: row.name_prefix ?? null,
      fullName: row.full_name ?? null,
      departmentName: firstEmbedded(row.departments)?.name ?? null,
      isActive: row.is_active === true,
    }));

    return c.json({ ok: true, query, limit: LIST_LIMIT, count: results.length, results }, 200);
  } catch (error) {
    logError("hr employee list failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- GET /api/hr/employees/import/template ------------------------------------

hrEmployees.get("/import/template", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const bytes = buildTemplateXlsx();
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": 'attachment; filename="employees-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
});

// --- POST /api/hr/employees/import/preview ------------------------------------

hrEmployees.post("/import/preview", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const throttled = await limited(c, RATE_LIMIT_IMPORT);
  if (throttled) return throttled;

  const upload = await readUpload(c);
  if (!upload.ok) return c.json({ ok: false, message: upload.message }, 400);

  try {
    const db = createDb(c.env);
    const context = await loadContext(c.env, db, upload.rows);
    if (context.error) return c.json({ ok: false, message: context.error }, 400);

    const plan = await buildPlan({
      rows: upload.rows,
      allowedPrefixes: context.allowedPrefixes,
      departments: context.departments,
      existingByCode: context.existingByCode,
      credentialByEmployeeId: context.credentialByEmployeeId,
      hashOf: context.hashOf,
      decryptOf: context.decryptOf,
    });

    return c.json(
      {
        ok: true,
        fileName: upload.fileName,
        summary: plan.summary,
        settings: SETTINGS,
        added: publicRows(plan.added),
        updated: publicRows(plan.updated),
        choices: plan.choices.map(publicChoice),
        skipped: plan.skipped,
        adjustments: plan.adjustments,
      },
      200
    );
  } catch (error) {
    logError("hr import preview failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/hr/employees/import/confirm ------------------------------------

hrEmployees.post("/import/confirm", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const throttled = await limited(c, RATE_LIMIT_IMPORT);
  if (throttled) return throttled;

  const upload = await readUpload(c);
  if (!upload.ok) return c.json({ ok: false, message: upload.message }, 400);

  const decisions = readDecisions(upload.form ? upload.form.get("choices") : null);
  if (decisions === null) return c.json({ ok: false, message: INVALID_MESSAGE }, 400);

  try {
    const db = createDb(c.env);
    const context = await loadContext(c.env, db, upload.rows);
    if (context.error) return c.json({ ok: false, message: context.error }, 400);

    const plan = await buildPlan({
      rows: upload.rows,
      allowedPrefixes: context.allowedPrefixes,
      departments: context.departments,
      existingByCode: context.existingByCode,
      credentialByEmployeeId: context.credentialByEmployeeId,
      hashOf: context.hashOf,
      decryptOf: context.decryptOf,
      decisions,
    });

    const session = c.get("hrSession");
    const nowIso = new Date().toISOString();

    // 1. Hashes and the duplicate check, before anything is written. A national
    //    ID that already belongs to another employee is rejected with its row
    //    number and employee code only; the file value is never echoed back.
    const needsHash = [
      ...plan.added.map((entry) => ({ entry })),
      ...plan.updated.filter((entry) => entry.useFileId).map((entry) => ({ entry })),
    ];

    const hashByRow = new Map();
    for (const item of needsHash) {
      hashByRow.set(item.entry.row, await context.hashOf(item.entry.employee.nationalId));
    }

    const owners = await findHashOwners(db, [...new Set(hashByRow.values())]);
    const claimants = new Map();
    for (const item of needsHash) {
      const hash = hashByRow.get(item.entry.row);
      const list = claimants.get(hash) ?? [];
      list.push(item);
      claimants.set(hash, list);
    }

    const rejected = [];
    const rejectedRows = new Set();
    const rejectRow = (entry) => {
      if (rejectedRows.has(entry.row)) return;
      rejectedRows.add(entry.row);
      rejected.push({
        row: entry.row,
        employeeCode: entry.employee.employeeCode,
        name: entry.name,
        reason: DUPLICATE_ID_MESSAGE,
      });
    };

    for (const [hash, list] of claimants) {
      // Two rows in one file claiming the same ID cannot both be right.
      if (list.length > 1) {
        for (const item of list) rejectRow(item.entry);
        continue;
      }
      const only = list[0];
      const ownerIds = owners.get(hash) ?? new Set();
      const ownedByOther = [...ownerIds].some((id) => Boolean(id) && id !== only.entry.employeeId);
      if (ownedByOther) rejectRow(only.entry);
    }

    plan.added = plan.added.filter((entry) => !rejectedRows.has(entry.row));
    plan.updated = plan.updated.filter((entry) => !rejectedRows.has(entry.row));
    const filledCount = plan.updated.filter((entry) => entry.fillsCredential === true).length;

    // 2. Employees: one upsert per group. New rows carry is_active=true;
    //    updated rows deliberately omit it, so an inactive employee can never
    //    be reactivated or deleted by an import.
    const idByCode = new Map();

    if (plan.added.length > 0) {
      const rows = plan.added.map((entry) => ({
        employee_code: entry.employee.employeeCode,
        name_prefix: entry.employee.prefix,
        full_name: entry.name,
        department_id: entry.departmentId,
        is_active: true,
      }));
      const result = ensureOk(
        await db.upsertMany(EMPLOYEES_TABLE, rows, {
          conflict: "employee_code",
          columns: "id,employee_code",
        })
      );
      for (const row of result.data ?? []) idByCode.set(row.employee_code, row.id);
    }

    if (plan.updated.length > 0) {
      const rows = plan.updated.map((entry) => ({
        employee_code: entry.employee.employeeCode,
        name_prefix: entry.employee.prefix,
        full_name: entry.name,
        department_id: entry.departmentId,
      }));
      const result = ensureOk(
        await db.upsertMany(EMPLOYEES_TABLE, rows, {
          conflict: "employee_code",
          columns: "id,employee_code",
        })
      );
      for (const row of result.data ?? []) idByCode.set(row.employee_code, row.id);
    }

    for (const entry of [...plan.added, ...plan.updated]) {
      const id = idByCode.get(entry.employee.employeeCode) ?? entry.employeeId ?? null;
      if (id) entry.employeeId = id;
    }

    // 3. Credentials. The payload carries employee_id, the hash, the encrypted
    //    value and updated_at only. pin_hash, pin_set_at, failed_attempts and
    //    locked_until are never sent, so an upsert merging into an existing row
    //    cannot erase a PIN or a lock.
    const credentialRow = async (entry) => {
      if (!entry.employeeId) throw new Error("missing employee id");
      return {
        employee_id: entry.employeeId,
        national_id_hash: hashByRow.get(entry.row),
        national_id_enc: await encryptNationalId(encKey(c.env), entry.employee.nationalId),
        updated_at: nowIso,
      };
    };

    const newCredentials = [];
    for (const entry of plan.added) newCredentials.push(await credentialRow(entry));

    const changedIds = plan.updated.filter((entry) => entry.useFileId);
    const updatedCredentials = [];
    for (const entry of changedIds) updatedCredentials.push(await credentialRow(entry));

    if (newCredentials.length > 0) {
      ensureOk(
        await db.upsertMany(CREDENTIALS_TABLE, newCredentials, {
          conflict: "employee_id",
        })
      );
    }
    if (updatedCredentials.length > 0) {
      ensureOk(
        await db.upsertMany(CREDENTIALS_TABLE, updatedCredentials, {
          conflict: "employee_id",
        })
      );
    }

    // 3. One audit row per import. No national ID, no file contents.
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: session.employeeId,
        action: IMPORT_ACTION,
        entity: IMPORT_ENTITY,
        entity_id: null,
        detail: {
          file: upload.fileName,
          added: plan.added.length,
          updated: plan.updated.length,
          keptExisting: plan.keptExisting.length,
          skipped: plan.skipped.length,
          rejected: rejected.length,
          credentialsFilled: filledCount,
          usedFileValue: changedIds.length,
          adjusted: plan.adjustments.length,
        },
      })
    );

    return c.json(
      {
        ok: true,
        summary: {
          added: plan.added.length,
          updated: plan.updated.length,
          keptExisting: plan.keptExisting.length,
          credentialsFilled: filledCount,
          skipped: plan.skipped.length,
          rejected: rejected.length,
        },
        skipped: plan.skipped,
        rejected,
        adjustments: plan.adjustments,
      },
      200
    );
  } catch (error) {
    logError("hr import confirm failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- GET /api/hr/employees/:id ------------------------------------------------

hrEmployees.get("/:id", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const employeeId = c.req.param("id");
  if (!UUID_PATTERN.test(employeeId)) {
    return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns:
        "id,employee_code,full_name,name_prefix,is_active,departments(name),positions(name)",
      filters: [["id", "eq", employeeId]],
      single: true,
    });
    if (!employee) return c.json({ ok: false, message: NOT_FOUND_MESSAGE }, 404);

    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "employee_id,national_id_enc",
      filters: [["employee_id", "eq", employeeId]],
      single: true,
    });

    const digits = credential ? await decryptStored(c.env, credential.national_id_enc) : null;
    const department = Array.isArray(employee.departments)
      ? employee.departments[0]
      : employee.departments;
    const position = Array.isArray(employee.positions)
      ? employee.positions[0]
      : employee.positions;

    return c.json(
      {
        ok: true,
        employee: {
          id: employee.id,
          employeeCode: employee.employee_code ?? null,
          namePrefix: employee.name_prefix ?? null,
          fullName: employee.full_name ?? null,
          departmentName: department?.name ?? null,
          positionName: position?.name ?? null,
          isActive: employee.is_active === true,
          nationalIdMasked: digits ? maskNationalId(digits) : null,
          nationalIdAvailable: Boolean(digits),
        },
      },
      200
    );
  } catch (error) {
    logError("hr employee read failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/hr/employees/:id/reveal-national-id ----------------------------

hrEmployees.post("/:id/reveal-national-id", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const throttled = await limited(c, RATE_LIMIT_REVEAL);
  if (throttled) return throttled;

  const employeeId = c.req.param("id");
  if (!UUID_PATTERN.test(employeeId)) {
    return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "employee_id,national_id_enc",
      filters: [["employee_id", "eq", employeeId]],
      single: true,
    });

    const digits = credential ? await decryptStored(c.env, credential.national_id_enc) : null;
    if (!digits) {
      return c.json({ ok: false, message: NATIONAL_ID_UNAVAILABLE }, 404);
    }

    // One row per (viewer, day). The counter is incremented inside the
    // database by the function, so concurrent clicks cannot lose a count.
    const counted = await db.rpc(VIEW_COUNTER_FUNCTION, {
      p_viewer: c.get("hrSession").employeeId,
      p_day: bangkokToday(),
    });
    if (counted.error) {
      // Fail closed: a view that cannot be counted is not shown.
      logError("hr national id view counter failed", new Error("rpc failed"));
      return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
    }

    return c.json({ ok: true, nationalId: digits }, 200);
  } catch (error) {
    logError("hr employee reveal failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

export default hrEmployees;
