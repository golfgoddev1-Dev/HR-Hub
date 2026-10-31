// Pure meeting roster helpers, ported from server/meeting-roster.js and the
// Express route's inline helpers. No I/O, no secrets, no logging.

/** Trims and collapses internal whitespace runs to one space. Non-strings -> "". */
export function normalizeSearchQuery(q) {
  if (typeof q !== "string") return "";
  return q.trim().replace(/\s+/g, " ");
}

/** Same rule as the Express isValidSearchQuery: at least two characters. */
export function isValidSearchQuery(q) {
  return normalizeSearchQuery(q).length >= 2;
}

/** Escapes the LIKE wildcards with a backslash, like the Express escapeLike. */
export function escapeIlike(value) {
  return value.replace(/[\\%_]/g, (match) => "\\" + match);
}

/** Thai-collated sort on fullName, same as the Express sortByName. */
export function sortThai(list) {
  return [...list].sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}
