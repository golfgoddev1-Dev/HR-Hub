// Phase 4b: keep the free Supabase project from being paused with one read-only
// request three times a day (worker/reports/phase4-spec-draft.md section 5).
// Exactly one subrequest: a single GET on the smallest table. No writes, no
// audit row, no alerting (owner decision 8), no response body in logs.

import { createDb } from "./db.js";

/** 00:00, 08:00 and 16:00 Asia/Bangkok. */
export const KEEP_ALIVE_CRON = "0 1,9,17 * * *";

const FAILED_MESSAGE = "keep-alive failed";

export async function runKeepAlive(env) {
  try {
    const db = createDb(env);
    await db.select("meeting_types", { columns: "id", limit: 1 });
  } catch (error) {
    // Fixed message plus the HTTP status only: never a body, header or key.
    const status = Number.isInteger(error?.status) ? ` status=${error.status}` : "";
    console.error(`${FAILED_MESSAGE}${status}`);
  }
}
