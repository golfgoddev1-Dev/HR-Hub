// Turns validated rows plus current database state into a written plan.
// Pure logic: the caller supplies lookups, hashing, encryption and decryption.

import { REASONS, maskNationalId, validateRow } from "./validate.js";

export const DECISION_USE_FILE = "file";
export const DECISION_KEEP = "keep";

function fullName(prefix, firstName, lastName) {
  return [prefix, firstName, lastName].filter((part) => part !== "").join(" ");
}

/**
 * @param {object} input
 * @param {Array<{rowNumber:number, cells:string[]}>} input.rows
 * @param {string[]} input.allowedPrefixes
 * @param {Array<{id:string, name:string}>} input.departments
 * @param {Map<string, object>} input.existingByCode  employee_code -> employees row
 * @param {Map<string, object>} input.credentialByEmployeeId  employee id -> employee_credentials row
 * @param {(digits:string)=>Promise<string>} input.hashOf
 * @param {(stored:string)=>Promise<string|null>} [input.decryptOf]
 * @param {Map<number, string>} [input.decisions]  rowNumber -> "file" | "keep"
 */
export async function buildPlan(input) {
  const {
    rows,
    allowedPrefixes,
    departments,
    existingByCode,
    credentialByEmployeeId,
    hashOf,
    decryptOf = async () => null,
    decisions = new Map(),
  } = input;

  const departmentNames = departments.map((department) => department.name);
  const departmentIdByName = new Map(departments.map((entry) => [entry.name, entry.id]));

  const skipped = [];
  const adjustments = [];
  const valid = [];
  const codeCounts = new Map();

  for (const row of rows) {
    const result = validateRow(row.cells, { allowedPrefixes, departmentNames });
    if (!result.ok) {
      const cells = row.cells;
      skipped.push({
        row: row.rowNumber,
        employeeCode: String(cells[0] ?? "").trim(),
        name: [cells[2], cells[3]].map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" "),
        reason: result.reason,
      });
      continue;
    }

    for (const adjustment of result.adjustments) {
      adjustments.push({
        row: row.rowNumber,
        employeeCode: result.employee.employeeCode,
        field: adjustment.field,
        from: adjustment.from,
        to: adjustment.to,
      });
    }

    valid.push({ rowNumber: row.rowNumber, employee: result.employee });
    const code = result.employee.employeeCode;
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  }

  const added = [];
  const updated = [];
  const choices = [];
  const keptExisting = [];

  for (const entry of valid) {
    const { rowNumber, employee } = entry;
    const duplicateCount = codeCounts.get(employee.employeeCode) ?? 0;

    if (duplicateCount > 1) {
      skipped.push({
        row: rowNumber,
        employeeCode: employee.employeeCode,
        name: fullName(employee.prefix, employee.firstName, employee.lastName),
        reason: REASONS.duplicateInFile,
      });
      continue;
    }

    const departmentId = departmentIdByName.get(employee.departmentName) ?? null;
    const name = fullName(employee.prefix, employee.firstName, employee.lastName);
    const existing = existingByCode.get(employee.employeeCode) ?? null;

    if (!existing) {
      added.push({ row: rowNumber, employee, departmentId, name });
      continue;
    }

    const fileHash = await hashOf(employee.nationalId);
    const credential = credentialByEmployeeId.get(existing.id) ?? null;
    const storedHash =
      typeof credential?.national_id_hash === "string" ? credential.national_id_hash : null;
    const idsMatch = storedHash !== null && storedHash.toLowerCase() === fileHash.toLowerCase();

    if (idsMatch) {
      updated.push({ row: rowNumber, employee, departmentId, name, employeeId: existing.id, useFileId: false });
      continue;
    }

    const storedDigits = credential?.national_id_enc
      ? await decryptOf(credential.national_id_enc)
      : null;
    const decision = decisions.get(rowNumber) === DECISION_USE_FILE ? DECISION_USE_FILE : DECISION_KEEP;

    if (decision === DECISION_USE_FILE) {
      updated.push({ row: rowNumber, employee, departmentId, name, employeeId: existing.id, useFileId: true });
      continue;
    }

    choices.push({
      row: rowNumber,
      employeeCode: employee.employeeCode,
      name,
      departmentName: employee.departmentName,
      fileIdMasked: maskNationalId(employee.nationalId),
      storedIdMasked: storedDigits ? maskNationalId(storedDigits) : null,
      decision: DECISION_KEEP,
      applied: decisions.has(rowNumber),
    });
    keptExisting.push({ row: rowNumber, employeeCode: employee.employeeCode, name });
  }

  return {
    added,
    updated,
    choices,
    keptExisting,
    skipped,
    adjustments,
    summary: {
      dataRows: rows.length,
      added: added.length,
      updated: updated.length,
      needsChoice: choices.filter((choice) => !choice.applied).length,
      keptExisting: keptExisting.length,
      skipped: skipped.length,
      rejected: 0,
    },
  };
}
