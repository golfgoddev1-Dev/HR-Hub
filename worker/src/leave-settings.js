// Leave settings: one row, one organisation-wide value per concern. The first
// is how long a medical certificate is kept; the second is the opt-in leave
// data retention window used by the daily cleanup.
//
// A single row rather than key/value because there is exactly one
// organisation-wide value; key/value would add a lookup, a parse and a "which
// key" failure mode for no gain.

import { isMissingTableError } from "./pg-errors.js";

export const SETTINGS_TABLE = "leave_settings";
export const SETTINGS_ROW_ID = 1;

export const DEFAULT_CERTIFICATE_RETENTION_DAYS = 90;
export const MIN_CERTIFICATE_RETENTION_DAYS = 30;
export const MAX_CERTIFICATE_RETENTION_DAYS = 365;

// Leave data retention is off until HR turns it on from the settings page.
export const DEFAULT_LEAVE_RETENTION_ENABLED = false;
export const DEFAULT_LEAVE_RETENTION_DAYS = 1825;
export const MIN_LEAVE_RETENTION_DAYS = 730;
export const MAX_LEAVE_RETENTION_DAYS = 3650;

/** Integer days inside 30..365, or null when the value is unusable. */
export function normalizeRetentionDays(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_CERTIFICATE_RETENTION_DAYS || parsed > MAX_CERTIFICATE_RETENTION_DAYS) {
    return null;
  }
  return parsed;
}

/** Integer days inside 730..3650, or null when the value is unusable. */
export function normalizeLeaveRetentionDays(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_LEAVE_RETENTION_DAYS || parsed > MAX_LEAVE_RETENTION_DAYS) {
    return null;
  }
  return parsed;
}

/** Row shape -> settings. A missing or malformed row keeps the defaults. */
export function settingsFromRow(row) {
  if (!row) {
    return {
      configured: false,
      certificateRetentionDays: DEFAULT_CERTIFICATE_RETENTION_DAYS,
      leaveRetentionEnabled: DEFAULT_LEAVE_RETENTION_ENABLED,
      leaveRetentionDays: DEFAULT_LEAVE_RETENTION_DAYS,
    };
  }
  const days = normalizeRetentionDays(row.certificate_retention_days);
  const leaveDays = normalizeLeaveRetentionDays(row.leave_retention_days);
  return {
    configured: true,
    certificateRetentionDays: days ?? DEFAULT_CERTIFICATE_RETENTION_DAYS,
    // Only a real boolean turns deletion on; anything else is off.
    leaveRetentionEnabled: row.leave_retention_enabled === true,
    leaveRetentionDays: leaveDays ?? DEFAULT_LEAVE_RETENTION_DAYS,
  };
}

/** Reads the single row; a missing table is reported, not thrown. */
export async function readLeaveSettings(db) {
  try {
    const row = await db.select(SETTINGS_TABLE, {
      columns:
        "id,certificate_retention_days,leave_retention_enabled,leave_retention_days,updated_at,updated_by",
      filters: [["id", "eq", SETTINGS_ROW_ID]],
      single: true,
    });
    return settingsFromRow(row);
  } catch (error) {
    if (isMissingTableError(error)) return settingsFromRow(null);
    throw error;
  }
}
