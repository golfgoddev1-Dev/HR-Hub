// Daily cleanup of medical certificates that outlived the retention setting.
//
// The job is safe to re-run: a row is only cleared after its object is gone
// (or was already missing), so a failed batch simply stays eligible for the
// next run. `now` is always passed in, never read inside, so tests can use a
// fixed clock.
//
// There is no PDF, no email and no push here: only Storage deletion plus the
// column clear.

import { createDb } from "./db.js";
import { getRequiredEnv } from "./env.js";
import { isMissingTableError } from "./pg-errors.js";
import { readLeaveSettings } from "./leave-settings.js";

export const CERT_CLEANUP_CRON = "0 2 * * *";
export const CERT_BUCKET = "leave-certificates";
export const CLEANUP_BATCH = 50;

const LEAVE_REQUESTS_TABLE = "leave_requests";

/** ISO cutoff: certificates created at or before this instant are expired. */
export function cutoffIso(now, retentionDays) {
  const moment = now instanceof Date ? now : new Date(now);
  return new Date(moment.getTime() - retentionDays * 86400000).toISOString();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Object path inside `bucket`. Only links addressed to this bucket count:
 * `<bucket>/<object>`, a public/signed/authenticated URL of that bucket, or an
 * object key that already starts with the bucket. Anything else returns null,
 * which the cleanup clears without deleting the source object.
 */
export function certificateStoragePath(value, bucket = CERT_BUCKET) {
  if (typeof value !== "string") return null;
  const trimmed = safeDecode(value.trim());
  if (trimmed.length === 0) return null;

  if (/^https?:\/\//i.test(trimmed) === false) {
    return objectPathInBucket(trimmed, bucket);
  }

  try {
    const url = new URL(trimmed);
    const marker = "/storage/v1/object/";
    const index = url.pathname.indexOf(marker);
    if (index === -1) return null;

    const parts = url.pathname.slice(index + marker.length).split("/");
    if (["public", "sign", "authenticated"].includes(parts[0])) parts.shift();

    return objectPathInBucket(parts.join("/"), bucket);
  } catch {
    return null;
  }
}

/** `<bucket>/<object>`; everything else is not ours to delete. */
function objectPathInBucket(path, bucket) {
  if (path.startsWith(`${bucket}/`) === false) return null;
  const rest = path.slice(bucket.length + 1);
  return rest.length > 0 ? rest : null;
}

/**
 * Rows whose certificate is older than the retention window. `createdAt` is the
 * request's created_at: there is no separate upload timestamp, and a
 * certificate can never be older than its request.
 */
export function selectExpiredCertificates(rows, { now, retentionDays }) {
  const cutoffMs = new Date(cutoffIso(now, retentionDays)).getTime();
  const expired = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const url = row?.medical_certificate_url;
    if (typeof url !== "string" || url.trim().length === 0) continue;

    const createdMs = new Date(row.created_at ?? "").getTime();
    if (Number.isFinite(createdMs) === false) continue;
    if (createdMs > cutoffMs) continue;

    expired.push({
      id: row.id ?? null,
      url,
      path: certificateStoragePath(url),
      createdAt: row.created_at ?? null,
    });
  }

  return expired;
}

/** Removes objects from the private bucket. Returns { ok, status }. */
export async function deleteStorageObjects(env, paths, bucket = CERT_BUCKET) {
  if (!Array.isArray(paths) || paths.length === 0) return { ok: true, status: 204 };

  const baseUrl = getRequiredEnv(env, "SUPABASE_URL").trim().replace(/\/+$/, "");
  const apiKey = getRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const response = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
    {
      method: "DELETE",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: paths }),
    }
  );

  // 404 means the objects are already gone, which is the state we want.
  return { ok: response.ok || response.status === 404, status: response.status };
}

/**
 * One cleanup pass. Never throws: a failure is reported in the summary so the
 * scheduler can log it and the next run retries the same rows.
 */
export async function runCertificateCleanup(env, now = new Date()) {
  const summary = { selected: 0, deleted: 0, cleared: 0, failed: 0, configured: false };

  let db;
  try {
    db = createDb(env);
    const settings = await readLeaveSettings(db);
    summary.configured = settings.configured;

    let rows = [];
    try {
      rows = await db.select(LEAVE_REQUESTS_TABLE, {
        columns: "id,medical_certificate_url,created_at",
        filters: [["medical_certificate_url", "not.is", null]],
        order: "created_at.asc",
        limit: CLEANUP_BATCH,
      });
    } catch (error) {
      if (isMissingTableError(error)) return summary;
      throw error;
    }

    const expired = selectExpiredCertificates(rows, {
      now,
      retentionDays: settings.certificateRetentionDays,
    });
    summary.selected = expired.length;
    if (expired.length === 0) return summary;

    const withPath = expired.filter((item) => item.path !== null);
    const withoutPath = expired.filter((item) => item.path === null);

    let storageDeleted = true;
    if (withPath.length > 0) {
      const result = await deleteStorageObjects(
        env,
        withPath.map((item) => item.path)
      );
      storageDeleted = result.ok;
      if (!result.ok) {
        summary.failed = withPath.length;
        console.error("[cert-cleanup-storage]", { status: result.status });
      }
    }

    const clearable = [...(storageDeleted ? withPath : []), ...withoutPath];
    summary.deleted = storageDeleted ? withPath.length : 0;

    const nowIso = new Date(now).toISOString();
    for (const item of clearable) {
      if (!item.id) continue;
      const updated = await db.update(
        LEAVE_REQUESTS_TABLE,
        { medical_certificate_url: null, updated_at: nowIso },
        [["id", "eq", item.id]]
      );
      if (updated.error) {
        summary.failed += 1;
        console.error("[cert-cleanup-clear]", { code: updated.error.code });
        continue;
      }
      summary.cleared += 1;
    }

    return summary;
  } catch (error) {
    console.error("[cert-cleanup-error]", { name: error?.name, code: error?.code });
    summary.failed += 1;
    return summary;
  }
}
