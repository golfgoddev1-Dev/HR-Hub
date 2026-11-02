// Small PostgREST client. No supabase-js, no logging of response bodies.

import { getRequiredEnv } from "./env.js";

const CONTENT_TYPE = "application/json";

function encodeValue(value) {
  return value === null ? "null" : encodeURIComponent(String(value));
}

/** Builds ["column=eq.value", "revoked_at=is.null", ...]. */
function buildFilters(filters = []) {
  const parts = [];
  for (const [column, op, value] of filters) {
    const name = encodeURIComponent(column);
    if (op === "is") {
      parts.push(`${name}=is.${value === null ? "null" : encodeValue(value)}`);
      continue;
    }
    // in.(v1,v2,...): each value is URL-encoded separately, so a value that
    // contains a comma cannot leak into the list syntax.
    if (op === "in") {
      const list = Array.isArray(value) ? value : [value];
      parts.push(`${name}=in.(${list.map(encodeValue).join(",")})`);
      continue;
    }
    parts.push(`${name}=${op}.${encodeValue(value)}`);
  }
  return parts;
}

/**
 * Reads the project URL and service role key, and returns the query helpers.
 * Every request carries apikey, Authorization: Bearer and Content-Type.
 */
export function createDb(env) {
  const baseUrl = getRequiredEnv(env, "SUPABASE_URL").trim().replace(/\/+$/, "");
  const apiKey = getRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  function headers() {
    return {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": CONTENT_TYPE,
    };
  }

  function url(table, queryParts = []) {
    const base = `${baseUrl}/rest/v1/${encodeURIComponent(table)}`;
    return queryParts.length > 0 ? `${base}?${queryParts.join("&")}` : base;
  }

  /** Error from a non-2xx response: only the code, never the body. */
  async function readError(response) {
    let code = null;
    try {
      const body = await response.json();
      if (body && typeof body.code === "string") code = body.code;
    } catch {
      code = null;
    }
    return { code };
  }

  /**
   * GET rows. `single` uses limit=1 and returns the first row or null (never the
   * vnd.pgrst.object header, which answers 406 for zero rows).
   * `extra` appends raw query parameters (already encoded), used for or=()
   * search filters whose values are URL-encoded inside the filter.
   */
  async function select(table, { columns = "*", filters = [], order, limit, single = false, extra = [] } = {}) {
    const query = [`select=${columns}`, ...buildFilters(filters), ...extra];
    if (typeof order === "string" && order.length > 0) query.push(`order=${order}`);
    const effectiveLimit = single ? 1 : limit;
    if (typeof effectiveLimit === "number" && Number.isFinite(effectiveLimit)) {
      query.push(`limit=${effectiveLimit}`);
    }

    const response = await fetch(url(table, query), { method: "GET", headers: headers() });
    if (!response.ok) {
      const error = new Error("postgrest request failed");
      error.status = response.status;
      error.code = (await readError(response)).code;
      throw error;
    }

    const data = await response.json().catch(() => null);
    if (single) return Array.isArray(data) && data.length > 0 ? data[0] : null;
    return Array.isArray(data) ? data : [];
  }

  /**
   * POST a row or an array of rows. Returns { error: null } or { error: { code } }.
   * With `returning: true` the inserted row is requested and returned as
   * { data, error }, which is needed for inserts whose generated id is used.
   * With `ignoreDuplicates: true` rows that already exist are left untouched
   * (resolution=ignore-duplicates) instead of raising a unique violation.
   */
  async function insert(table, row, { returning = false, ignoreDuplicates = false } = {}) {
    const requestHeaders = headers();
    const prefer = [];
    if (returning) prefer.push("return=representation");
    if (ignoreDuplicates) prefer.push("resolution=ignore-duplicates");
    if (prefer.length > 0) requestHeaders.Prefer = prefer.join(",");

    const response = await fetch(url(table), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(row),
    });
    if (!response.ok) return { error: await readError(response) };
    if (!returning) return { error: null };

    const data = await response.json().catch(() => null);
    return {
      data: Array.isArray(data) ? data[0] ?? null : data ?? null,
      error: null,
    };
  }

  /**
   * PATCH matching rows. Returns { error: null } or { error: { code } }.
   * With `returning: true` the patched rows are requested and returned as
   * { data: rows, error: null }, which lets a caller count how many rows matched
   * (Patch itself answers 204 whether zero or more rows matched).
   */
  async function update(table, patch, filters = [], { returning = false, columns = "*" } = {}) {
    const requestHeaders = headers();
    if (returning) {
      requestHeaders.Prefer = "return=representation";
    }

    const response = await fetch(url(table, returning ? [`select=${columns}`, ...buildFilters(filters)] : buildFilters(filters)), {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify(patch),
    });
    if (!response.ok) return { error: await readError(response) };
    if (!returning) return { error: null };

    const data = await response.json().catch(() => null);
    return { data: Array.isArray(data) ? data : [], error: null };
  }

  /**
   * Upsert a row or an array of rows. `conflict` is the composite conflict target
   * sent as the onConflict query parameter, and the saved row is requested back
   * when `columns` is given, like supabase-js
   * .upsert(row, { onConflict }).select().single().
   * With `ignoreDuplicates: true` existing rows are kept
   * (resolution=ignore-duplicates) instead of being merged; pass `columns: null`
   * for large array bodies that need no rows back.
   * Returns { data: row | null, error: null } or { error: { code } }.
   */
  async function upsert(table, row, { conflict, columns = "*", ignoreDuplicates = false } = {}) {
    const requestHeaders = headers();
    const resolution = ignoreDuplicates
      ? "resolution=ignore-duplicates"
      : "resolution=merge-duplicates";
    const wantsRows = typeof columns === "string" && columns.length > 0;
    requestHeaders.Prefer = wantsRows ? `return=representation,${resolution}` : resolution;

    const queryParts = [];
    // PostgREST's parameter is on_conflict (snake_case), as supabase-js sends.
    // A camelCase name is not a parameter: PostgREST parses it as a column
    // filter, and the comma in the list makes that filter unparseable (PGRST100).
    if (conflict) queryParts.push(`on_conflict=${encodeURIComponent(conflict)}`);
    if (wantsRows) queryParts.push(`select=${columns}`);

    const response = await fetch(url(table, queryParts), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(row),
    });
    if (!response.ok) return { error: await readError(response) };
    if (!wantsRows) return { data: null, error: null };

    const data = await response.json().catch(() => null);
    return {
      data: Array.isArray(data) ? data[0] ?? null : data ?? null,
      error: null,
    };
  }


  /**
   * POST an array of rows in one request. With `returning: true` every
   * inserted row comes back, which the employee import needs to map new
   * employee codes to the ids the database generated.
   */
  async function insertMany(table, rows, { returning = false } = {}) {
    const requestHeaders = headers();
    if (returning) requestHeaders.Prefer = "return=representation";

    const response = await fetch(url(table), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(rows),
    });
    if (!response.ok) return { data: null, error: await readError(response) };
    if (!returning) return { data: [], error: null };

    const data = await response.json().catch(() => null);
    return { data: Array.isArray(data) ? data : [], error: null };
  }

  /**
   * Upserts an array of rows in one request and returns every affected row.
   * A batch import therefore needs one round trip per table, not one per row.
   */
  async function upsertMany(table, rows, { conflict, columns = null } = {}) {
    const requestHeaders = headers();
    const resolution = "resolution=merge-duplicates";
    requestHeaders.Prefer = columns
      ? `return=representation,${resolution}`
      : resolution;

    const queryParts = [];
    if (conflict) queryParts.push(`on_conflict=${encodeURIComponent(conflict)}`);
    if (columns) queryParts.push(`select=${columns}`);

    const response = await fetch(url(table, queryParts), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(rows),
    });
    if (!response.ok) return { data: null, error: await readError(response) };
    if (!columns) return { data: [], error: null };

    const data = await response.json().catch(() => null);
    return { data: Array.isArray(data) ? data : [], error: null };
  }

  /**
   * Calls a PostgREST RPC function. Used for the daily view counter, which has
   * to increment inside the database in a single statement.
   */
  async function rpc(name, args) {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(args ?? {}),
    });
    if (!response.ok) return { data: null, error: await readError(response) };
    const data = await response.json().catch(() => null);
    return { data, error: null };
  }

  return { select, insert, insertMany, update, upsert, upsertMany, rpc };
}
