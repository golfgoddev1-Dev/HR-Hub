// Department shift leads: at most two per department, each with a free-text
// shift label of 1 to 30 characters after trimming. Labels are unique inside a
// department, compared case-insensitively after trimming.
//
// The two-person limit is an application rule, not a database constraint: the
// HR route replaces the whole list (delete the department's rows, then insert
// at most two), so a request can never create a third row. The database does
// enforce one row per person and one label per department.

import { displayName } from "./leave-calendar.js";

export const SHIFT_LEADS_TABLE = "department_shift_leads";
export const SHIFT_LEADS_MAX = 2;
export const SHIFT_LABEL_MAX_LENGTH = 30;

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const ENTRY_KEYS = ["employeeId", "shiftLabel"];

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collapse whitespace runs, then trim: the stored label is this value. */
export function normalizeShiftLabel(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** Code points, so a label of Thai characters is counted the way it reads. */
export function shiftLabelLength(value) {
  return Array.from(normalizeShiftLabel(value)).length;
}

/** Case-insensitive comparison key for one label. */
export function shiftLabelKey(value) {
  return normalizeShiftLabel(value).toLocaleLowerCase("th");
}

/**
 * Validates the request's entry list without touching the database.
 * Returns { ok: true, leads: [{ employeeId, shiftLabel }] } or
 * { ok: false, code } with a fixed code the route maps to a Thai message.
 */
export function validateShiftLeadEntries(entries) {
  if (!Array.isArray(entries)) return { ok: false, code: "invalid" };
  if (entries.length > SHIFT_LEADS_MAX) return { ok: false, code: "too_many" };

  const leads = [];
  const employeeIds = new Set();
  const labels = new Set();

  for (const entry of entries) {
    if (!isPlainObject(entry)) return { ok: false, code: "invalid" };
    if (Object.keys(entry).some((key) => !ENTRY_KEYS.includes(key))) {
      return { ok: false, code: "invalid" };
    }
    if (!isUuid(entry.employeeId)) return { ok: false, code: "invalid_employee" };
    if (employeeIds.has(entry.employeeId)) return { ok: false, code: "duplicate_employee" };

    const shiftLabel = normalizeShiftLabel(entry.shiftLabel);
    if (shiftLabel.length === 0) return { ok: false, code: "label_required" };
    if (Array.from(shiftLabel).length > SHIFT_LABEL_MAX_LENGTH) {
      return { ok: false, code: "label_too_long" };
    }

    const labelKey = shiftLabelKey(shiftLabel);
    if (labels.has(labelKey)) return { ok: false, code: "duplicate_label" };

    employeeIds.add(entry.employeeId);
    labels.add(labelKey);
    leads.push({ employeeId: entry.employeeId, shiftLabel });
  }

  return { ok: true, leads };
}

/**
 * Checks the chosen people against the department's employee rows. `people` is
 * a Map keyed by employee id. Returns null when every lead is usable, or one of
 * the fixed codes. Only an employee with a real email address can be a lead,
 * because the notice has nowhere to go otherwise.
 */
export function shiftLeadPeopleProblem(leads, people, departmentId) {
  for (const lead of leads) {
    const person = people.get(lead.employeeId);
    if (!person) return "employee_not_found";
    if (person.department_id !== departmentId) return "employee_not_in_department";
    if (typeof person.email !== "string" || person.email.trim().length === 0) {
      return "employee_no_email";
    }
  }
  return null;
}

/** The API row for one lead: no email address, only whether one exists. */
export function publicShiftLead(row, person) {
  const email = typeof person?.email === "string" ? person.email.trim() : "";
  return {
    id: row.id ?? null,
    employeeId: row.employee_id ?? null,
    employeeCode: person?.employee_code ?? null,
    employeeName: displayName(person?.name_prefix, person?.full_name) || null,
    shiftLabel: row.shift_label ?? "",
    hasEmail: email.length > 0,
  };
}

/** Rows to insert for a validated list. */
export function shiftLeadRows(leads, { departmentId, createdBy = null } = {}) {
  return leads.map((lead) => ({
    department_id: departmentId,
    employee_id: lead.employeeId,
    shift_label: lead.shiftLabel,
    created_by: createdBy,
  }));
}
