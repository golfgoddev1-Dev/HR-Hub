// Notification payloads.
//
// Privacy rule: the payload never carries a leave type, a reason, a medical
// note or a date. It only says that something needs attention and where to
// look, so a push service (and a lock screen) cannot learn why someone is away.

export const NOTIFICATION_KINDS = {
  SUBMITTED: "leave_submitted",
  DECIDED: "leave_decided",
  BACKDATED: "leave_backdated",
};

/** A push body is capped at 3993 bytes by RFC 8291; stay well below it. */
export const MAX_PAYLOAD_BYTES = 3000;

function focusQuery(requestId) {
  const id = typeof requestId === "string" ? requestId.trim() : "";
  return id.length > 0 ? `?focus=${encodeURIComponent(id)}` : "";
}

/**
 * Builds the payload for one queue row. Returns null for an unknown kind, which
 * the queue treats as a cancelled row instead of sending something meaningless.
 */
export function buildNotificationPayload(kind, { requestId = null, status = null } = {}) {
  const focus = focusQuery(requestId);

  if (kind === NOTIFICATION_KINDS.SUBMITTED) {
    return {
      title: "มีใบลารออนุมัติ",
      body: "มีใบลาใหม่รอการอนุมัติ",
      url: `/leave/approvals${focus}`,
      tag: "leave-submitted",
      kind,
    };
  }

  if (kind === NOTIFICATION_KINDS.DECIDED) {
    return {
      title: "ใบลาของคุณได้รับการพิจารณา",
      body: status === "approved" ? "สถานะใบลา: อนุมัติแล้ว" : "สถานะใบลา: ไม่อนุมัติ",
      url: `/leave${focus}`,
      tag: "leave-decided",
      kind,
    };
  }

  if (kind === NOTIFICATION_KINDS.BACKDATED) {
    return {
      title: "มีใบลาที่ HR บันทึกให้",
      body: "เปิดหน้าใบลาของฉันเพื่อดูรายละเอียด",
      url: `/leave${focus}`,
      tag: "leave-backdated",
      kind,
    };
  }

  return null;
}

/** True when the serialised payload still fits a single push record. */
export function payloadFits(payload) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}
