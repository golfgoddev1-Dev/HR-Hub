// Pure rules for the system-admin permission screen, kept out of the route so
// the body shape, the flag diff and the PostgREST search escaping can be tested
// without a database. The frontend keeps the same small escaping rule in
// src/lib/admin-permissions.js: the Worker bundle cannot import from src/.

export const PERMISSION_KEYS = Object.freeze([
  "hrAdmin",
  "meetingAdmin",
  "systemAdmin",
  "leaveApprover",
]);

/** Audit names. The detail row carries this name, never a flag value. */
export const PERMISSION_NAMES = Object.freeze({
  hrAdmin: "hr_admin",
  meetingAdmin: "meeting_admin",
  systemAdmin: "system_admin",
  leaveApprover: "leave_approver",
});

export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_LIMIT = 20;

export function normalizeQuery(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Escapes what PostgREST's ilike reads as a wildcard, so a typed % or _ is a
 * literal character. The backslash itself must be escaped first.
 */
export function escapeLikePattern(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/([%_*])/g, "\\$1");
}

/**
 * One leaf value inside or=(). Encoding keeps a typed comma or parenthesis from
 * opening or closing the group; the dot is encoded too so it can only ever be a
 * literal. PostgREST decodes each leaf value itself.
 */
export function encodeOrValue(value) {
  return encodeURIComponent(value)
    .replace(/\./g, "%2E")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

/** The or=(...) filter matching full_name or employee_code, case-insensitively. */
export function buildSearchFilter(text) {
  const pattern = `%${escapeLikePattern(normalizeQuery(text))}%`;
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}

function emptyFlags() {
  const flags = {};
  for (const key of PERMISSION_KEYS) flags[key] = false;
  return flags;
}

export { emptyFlags };

/**
 * The PUT body is exactly the four flags, all booleans: a missing key, an extra
 * key or a non-boolean is refused (null) instead of being dropped silently.
 */
export function parsePermissionBody(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;

  const keys = Object.keys(body);
  if (keys.some((key) => !PERMISSION_KEYS.includes(key))) return null;

  const flags = emptyFlags();
  for (const key of PERMISSION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return null;
    if (typeof body[key] !== "boolean") return null;
    flags[key] = body[key];
  }
  return flags;
}

/** The flags that actually change, in a stable order; one audit row each. */
export function changedFlags(current, next) {
  const changes = [];
  for (const key of PERMISSION_KEYS) {
    const was = current?.[key] === true;
    const will = next?.[key] === true;
    if (was === will) continue;
    changes.push({ key, name: PERMISSION_NAMES[key], granted: will });
  }
  return changes;
}
