// Medical certificate access rules and the certificate-view audit, in one place.
//
// Rules (owner-confirmed):
// - a certificate exists only for a sick-leave request ("ลาป่วย") that has an
//   object path stored by this system;
// - HR opens any of them through the HR-only routes; the owning employee opens
//   only their own through the employee route; approvers, shift leads and
//   everyone else are refused;
// - the file is streamed by the Worker after the check, never through a public
//   or signed URL;
// - each open writes at most one audit row per viewer, request and Bangkok
//   calendar day. The unique index in the SQL does the dedupe; the insert here
//   asks PostgREST to ignore a conflicting row. The row carries ids, the action
//   and the time only.
// - an audit failure is logged as a fixed code and never blocks the view.

import { isCertificatePath, normalizeContentType } from "./leave-attachment.js";
import { downloadCertificate } from "./leave-storage.js";

export const SICK_LEAVE_TYPE_NAME = "ลาป่วย";

export const MEDICAL_CERT_AUDIT_TABLE = "audit_logs";
export const MEDICAL_CERT_AUDIT_ACTION = "view_medical_cert";
export const MEDICAL_CERT_AUDIT_ENTITY = "leave_request";

export const MEDICAL_CERT_MESSAGES = Object.freeze({
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  notFound: "ไม่พบไฟล์ใบรับรองแพทย์",
  invalid: "ข้อมูลไม่ถูกต้อง",
  employeeNotFound: "ไม่พบพนักงาน",
  unavailable: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
});

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** True only for the configured sick-leave type name. */
export function isSickLeaveName(value) {
  return typeof value === "string" && value.trim() === SICK_LEAVE_TYPE_NAME;
}

/** The stored object path, or null when the row has no usable certificate. */
export function certificateObjectPath(row) {
  const stored = row?.medical_certificate_url;
  if (typeof stored !== "string") return null;
  const trimmed = stored.trim();
  return isCertificatePath(trimmed) ? trimmed : null;
}

/** A certificate needs the flag and an object path this system wrote. */
export function hasOpenableCertificate(row) {
  return row?.has_medical_certificate === true && certificateObjectPath(row) !== null;
}

/** The list row the HR page may see: ids, code, dates and status only. */
export function publicCertificateRequest(row) {
  return {
    id: row.id,
    requestCode: row.request_code ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    status: row.status ?? null,
  };
}

/** The Bangkok calendar date of an instant, e.g. "2026-11-09". */
export function bangkokDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The audit row: ids, action, entity and time. Nothing personal. */
export function certificateAuditRow({ viewerId, requestId, now = new Date() } = {}) {
  return {
    actor_id: viewerId,
    action: MEDICAL_CERT_AUDIT_ACTION,
    entity: MEDICAL_CERT_AUDIT_ENTITY,
    entity_id: requestId,
    detail: null,
    created_at: now.toISOString(),
  };
}

/**
 * One insert, conflicts ignored. Returns { ok } and never throws. The log line
 * carries a code only, never an id, a path or a name.
 */
export async function writeCertificateAudit(db, { viewerId, requestId, now = new Date() } = {}) {
  try {
    const result = await db.insert(
      MEDICAL_CERT_AUDIT_TABLE,
      certificateAuditRow({ viewerId, requestId, now }),
      { ignoreDuplicates: true }
    );
    if (result?.error) {
      console.error("[medical-cert-audit]", { code: result.error.code ?? null });
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.error("[medical-cert-audit]", {
      name: error?.name ?? "Error",
      code: error?.code ?? null,
    });
    return { ok: false };
  }
}

/** Response headers for the streamed file: no cache, inline, no indexing. */
export function certificateHeaders(contentType) {
  return {
    "Content-Type": normalizeContentType(contentType) ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  };
}

/**
 * Downloads and streams one certificate after the caller's check, then writes
 * the daily-deduped audit row. A failed download answers a fixed message and a
 * status only.
 */
export async function sendCertificate(
  c,
  env,
  { db = null, path, viewerId, requestId, now = new Date(), download = downloadCertificate } = {}
) {
  let file;
  try {
    file = await download(env, path);
  } catch (error) {
    console.error("[medical-cert-download]", { name: error?.name ?? "Error" });
    return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.unavailable }, 502);
  }

  if (file?.ok !== true) {
    console.error("[medical-cert-download]", { status: file?.status ?? null });
    return c.json(
      { ok: false, message: MEDICAL_CERT_MESSAGES.notFound },
      file?.status === 404 ? 404 : 502
    );
  }

  // The audit must never block the view: the helper swallows its own failure.
  await writeCertificateAudit(db, { viewerId, requestId, now }).catch(() => {});

  return c.body(file.body, 200, certificateHeaders(file.contentType));
}
