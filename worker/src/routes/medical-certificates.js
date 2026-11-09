// Medical certificate access for HR, mounted at /api/hr by src/app.js.
//
// Rules kept here:
// - the existing HR guard is re-checked on every request;
// - the list is limited to sick-leave requests ("ลาป่วย") that have a stored
//   object path, and carries the request code, dates and status only — no file
//   name, no URL and no file bytes;
// - the stream is authorised here, then downloaded and sent by the Worker; no
//   public or signed URL ever leaves the server;
// - each open writes one audit row per viewer, request and Bangkok day (the
//   table's unique index dedupes), and an audit failure never blocks the view.

import { Hono } from "hono";

import { requireHrAdmin } from "../hr-guard.js";
import {
  MEDICAL_CERT_MESSAGES,
  certificateObjectPath,
  hasOpenableCertificate,
  isSickLeaveName,
  isUuid,
  publicCertificateRequest,
  sendCertificate,
} from "../medical-certificate.js";

const EMPLOYEES_TABLE = "employees";
const LEAVE_REQUESTS_TABLE = "leave_requests";
const LEAVE_TYPES_TABLE = "leave_types";

const LIST_LIMIT = 100;

function logError(scope, error) {
  console.error(scope, { name: error?.name ?? null, code: error?.code ?? null });
}

const medicalCertificates = new Hono();

medicalCertificates.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

// --- GET /api/hr/employees/:employeeId/medical-certificates -----------------

medicalCertificates.get("/employees/:employeeId/medical-certificates", async (c) => {
  const auth = await requireHrAdmin(c);
  if (auth.response) return auth.response;

  const employeeId = c.req.param("employeeId");
  if (!isUuid(employeeId)) {
    return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.invalid }, 400);
  }

  try {
    const db = auth.db;
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id",
      filters: [["id", "eq", employeeId]],
      single: true,
    });
    if (!employee) {
      return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.employeeNotFound }, 404);
    }

    // Only the sick-leave type can carry a medical certificate.
    const types = await db.select(LEAVE_TYPES_TABLE, { columns: "id,name" });
    const sickTypeIds = new Set(
      (Array.isArray(types) ? types : [])
        .filter((row) => isSickLeaveName(row.name))
        .map((row) => row.id)
    );

    const rows =
      sickTypeIds.size === 0
        ? []
        : await db.select(LEAVE_REQUESTS_TABLE, {
            columns:
              "id,request_code,leave_type_id,start_date,end_date,status,has_medical_certificate,medical_certificate_url",
            filters: [["employee_id", "eq", employeeId]],
            order: "start_date.desc",
            limit: LIST_LIMIT,
          });

    const results = rows
      .filter((row) => sickTypeIds.has(row.leave_type_id) && hasOpenableCertificate(row))
      .map(publicCertificateRequest);

    return c.json({ ok: true, employeeId, count: results.length, results }, 200);
  } catch (error) {
    logError("[medical-cert-list]", error);
    return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.unavailable }, 500);
  }
});

// --- GET /api/hr/leave-requests/:requestId/medical-certificate --------------

medicalCertificates.get("/leave-requests/:requestId/medical-certificate", async (c) => {
  const auth = await requireHrAdmin(c);
  if (auth.response) return auth.response;

  const requestId = c.req.param("requestId");
  if (!isUuid(requestId)) {
    return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.invalid }, 400);
  }

  try {
    const db = auth.db;
    const request = await db.select(LEAVE_REQUESTS_TABLE, {
      columns:
        "id,employee_id,leave_type_id,medical_certificate_url,has_medical_certificate",
      filters: [["id", "eq", requestId]],
      single: true,
    });
    if (!request) {
      return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.notFound }, 404);
    }

    const type = request.leave_type_id
      ? await db.select(LEAVE_TYPES_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", request.leave_type_id]],
          single: true,
        })
      : null;
    if (!isSickLeaveName(type?.name)) {
      return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.forbidden }, 403);
    }

    const path = certificateObjectPath(request);
    if (!path) {
      return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.notFound }, 404);
    }

    return sendCertificate(c, c.env, {
      db,
      path,
      viewerId: auth.session.employeeId,
      requestId: request.id,
    });
  } catch (error) {
    logError("[medical-cert-stream]", error);
    return c.json({ ok: false, message: MEDICAL_CERT_MESSAGES.unavailable }, 500);
  }
});

export default medicalCertificates;
