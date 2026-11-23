/** Collapses whitespace and trims. The search text is never logged. */
export function normalizeSearch(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

function encodeOrValue(value) {
  return encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * PostgREST or-filter for name + employee code ilike search. Parentheses and
 * commas in the search text are percent-encoded so they cannot break the or=()
 * structure.
 */
export function buildSearchFilter(pattern) {
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}
