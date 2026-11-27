// GET /api/admin/settings: every organisation-wide setting on one read-only
// page. The leave values come from the leave_settings row HR edits; the rest
// are fixed in code, so they are read from the constants the Worker enforces
// and can never drift from what actually happens.

import { SESSION_IDLE_MS } from "./session.js";
import { LOCK_DURATION_MS, MAX_FAILED_ATTEMPTS } from "./pin-verify.js";
import { AUDIT_RETENTION_DAYS, AUTH_SESSION_RETENTION_DAYS } from "./maintenance/cleanup.js";

const MINUTE_MS = 60 * 1000;

export const SECURITY_POLICY = Object.freeze({
  sessionIdleMinutes: SESSION_IDLE_MS / MINUTE_MS,
  maxFailedPins: MAX_FAILED_ATTEMPTS,
  lockMinutes: LOCK_DURATION_MS / MINUTE_MS,
  sessionRetentionDays: AUTH_SESSION_RETENTION_DAYS,
  auditRetentionDays: AUDIT_RETENTION_DAYS,
});

/** The leave row for the page: values, when it last changed and by whom (code and name only). */
export function shapeLeaveSettings(settings, person) {
  return {
    configured: settings.configured,
    certificateRetentionDays: settings.certificateRetentionDays,
    leaveRetentionEnabled: settings.leaveRetentionEnabled,
    leaveRetentionDays: settings.leaveRetentionDays,
    updatedAt: settings.updatedAt,
    updatedBy: person
      ? { employeeCode: person.employee_code ?? null, fullName: person.full_name ?? null }
      : null,
  };
}
