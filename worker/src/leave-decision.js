// One leave decision, used by both approval paths.
//
// The in-app route (/api/leave/requests/:id/approve|reject) and the email-link
// route call this same function, so status, decided_at and decision_note are
// written identically. The update is conditional on the request still being
// pending and still assigned to this approver, which is the existing rule that
// makes two simultaneous decisions produce exactly one winner.

export const LEAVE_REQUESTS_TABLE = "leave_requests";
export const LEAVE_DECISION_STATUSES = Object.freeze(["approved", "rejected"]);
export const LEAVE_DECISION_COLUMNS = "id,status,decided_at";

/** The exact patch an in-app or emailed decision writes. */
export function leaveDecisionPatch({ status, note = null, nowIso }) {
  return {
    status,
    decided_at: nowIso,
    decision_note: note,
    updated_at: nowIso,
  };
}

/**
 * Applies the decision. Returns:
 *   { ok: true, decidedAt, request }        — this call won
 *   { ok: false, code: "already_decided" }  — zero rows matched, nothing changed
 *   { ok: false, code, error: true }        — the database write failed
 */
export async function applyLeaveDecision(
  db,
  { requestId, approverId, status, note = null, nowIso = new Date().toISOString() } = {}
) {
  if (!LEAVE_DECISION_STATUSES.includes(status)) {
    return { ok: false, code: "invalid_status" };
  }

  const updated = await db.update(
    LEAVE_REQUESTS_TABLE,
    leaveDecisionPatch({ status, note, nowIso }),
    [
      ["id", "eq", requestId],
      ["status", "eq", "pending"],
      ["approver_id", "eq", approverId],
    ],
    { returning: true, columns: LEAVE_DECISION_COLUMNS }
  );

  if (updated.error) {
    return { ok: false, code: updated.error.code ?? "update_failed", error: true };
  }
  if (!Array.isArray(updated.data) || updated.data.length === 0) {
    return { ok: false, code: "already_decided" };
  }

  return { ok: true, decidedAt: nowIso, request: updated.data[0] };
}
