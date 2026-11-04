// PostgREST error classification, shared by the leave modules.
// The client keeps only the error code (src/db.js), never the response body.

/**
 * True when the request failed because the table does not exist yet: a missing
 * table answers 404 with PGRST205 on current PostgREST, or 42P01 from Postgres.
 */
export function isMissingTableError(error) {
  if (!error) return false;
  return error.status === 404 || error.code === "PGRST205" || error.code === "42P01";
}
