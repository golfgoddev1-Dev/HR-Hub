// Query parsing and row shaping for GET /api/admin/audit.
//
// The page never returns audit_logs.detail. Detail is free-form JSON written by
// many features, so only one value is read back out of it: the permission name of
// a permission_granted / permission_revoked row, and only when it is one of the
// four known names. Everything else the reader sees is action, entity, time and
// the two people (actor, and target for permission rows).

import { PERMISSION_NAMES } from "./admin-permissions.js";

export const AUDIT_PAGE_SIZE = 50;
export const PERMISSION_ENTITY = "permission";
// Rows whose entity_id is the employee the action was done to.
const TARGET_ACTIONS = new Set(["session_revoked", "account_unlocked"]);

const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR_PATTERN = /^[1-9]\d{0,17}$/;
const BANGKOK_OFFSET = "+07:00";
const PERMISSION_NAME_VALUES = new Set(Object.values(PERMISSION_NAMES));

function isRealDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextDay(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Query string to PostgREST filters, or null when any given value is malformed
 * (a bad filter is refused, never ignored, so a typo cannot widen the result).
 */
export function parseAuditQuery(searchParams) {
  const filters = [];
  const action = searchParams.get("action");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const before = searchParams.get("before");

  if (action) {
    if (!ACTION_PATTERN.test(action)) return null;
    filters.push(["action", "eq", action]);
  }
  if (from) {
    if (!isRealDate(from)) return null;
    filters.push(["created_at", "gte", `${from}T00:00:00${BANGKOK_OFFSET}`]);
  }
  if (to) {
    if (!isRealDate(to)) return null;
    // Start of the next Bangkok day, exclusive, so the whole of `to` is included.
    filters.push(["created_at", "lt", `${nextDay(to)}T00:00:00${BANGKOK_OFFSET}`]);
  }
  if (from && to && from > to) return null;
  if (before) {
    if (!CURSOR_PATTERN.test(before)) return null;
    filters.push(["id", "lt", before]);
  }
  return filters;
}

function permissionOf(detail) {
  let value = detail;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const name = value && typeof value === "object" ? value.permission : null;
  return PERMISSION_NAME_VALUES.has(name) ? name : null;
}

function person(employee) {
  if (!employee) return null;
  return { employeeCode: employee.employee_code ?? null, fullName: employee.full_name ?? null };
}

function hasTarget(row) {
  return row.entity === PERMISSION_ENTITY || TARGET_ACTIONS.has(row.action);
}

/** One audit row as the page sees it. `people` maps employee id to its row. */
export function shapeAuditRow(row, people) {
  const isPermission = row.entity === PERMISSION_ENTITY;
  return {
    id: String(row.id),
    createdAt: row.created_at,
    action: row.action,
    entity: row.entity,
    actor: person(people.get(row.actor_id)),
    target: hasTarget(row) ? person(people.get(row.entity_id)) : null,
    permission: isPermission ? permissionOf(row.detail) : null,
  };
}

/** The ids whose names the page needs: every actor, plus permission targets. */
export function auditPeopleIds(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row.actor_id) ids.add(row.actor_id);
    if (hasTarget(row) && row.entity_id) ids.add(row.entity_id);
  }
  return [...ids];
}
