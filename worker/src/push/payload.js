// Notification payloads.
//
// Privacy rule: the payload never carries a name, a code, a department, a leave
// type, a reason, a medical note, a date or a free-text URL. It only says that
// something needs attention and which fixed page kind to open.
//
// Routing rule: `route` is one of the two keys below. The service worker maps
// it to its own fixed path; no payload value becomes a URL.

export const NOTIFICATION_KINDS = {
  SUBMITTED: "leave_submitted",
  DECIDED: "leave_decided",
  BACKDATED: "leave_backdated",
  PENDING_SIGNED_OUT: "leave_pending_signed_out",
};

export const NOTIFICATION_ROUTES = Object.freeze({
  APPROVALS: "approvals",
  LEAVE: "leave",
});

const TITLE = "ระบบใบลา";
const APPROVER_REQUEST_BODY = "มีรายการรออนุมัติใหม่ 1 รายการ";
const EMPLOYEE_UPDATE_BODY = "มีการอัปเดตใบลาของคุณ";

/** A push body is capped at 3993 bytes by RFC 8291; stay well below it. */
export const MAX_PAYLOAD_BYTES = 3000;

/**
 * Builds the payload for one queue row. Returns null for an unknown kind, which
 * the queue treats as a cancelled row instead of sending something meaningless.
 *
 * `count` is the recipient's own pending total, added only when the recipient
 * has a queue (an active approver). It is the one extra field, so the service
 * worker can set the icon badge from a push that arrives with the app closed.
 */
export function buildNotificationPayload(kind, { count } = {}) {
  if (kind === NOTIFICATION_KINDS.SUBMITTED) {
    const payload = {
      title: TITLE,
      body: APPROVER_REQUEST_BODY,
      route: NOTIFICATION_ROUTES.APPROVALS,
      tag: "leave-submitted",
      kind,
    };
    if (Number.isInteger(count) && count >= 0) payload.count = count;
    return payload;
  }

  if (kind === NOTIFICATION_KINDS.DECIDED) {
    return {
      title: TITLE,
      body: EMPLOYEE_UPDATE_BODY,
      route: NOTIFICATION_ROUTES.LEAVE,
      tag: "leave-decided",
      kind,
    };
  }

  if (kind === NOTIFICATION_KINDS.BACKDATED) {
    return {
      title: TITLE,
      body: EMPLOYEE_UPDATE_BODY,
      route: NOTIFICATION_ROUTES.LEAVE,
      tag: "leave-backdated",
      kind,
    };
  }

  return null;
}

/**
 * The only notification a signed-out browser may receive: a count of the
 * recipient's own pending approvals. It carries no request id, employee name,
 * code, department, leave type, date or reason, and it routes to the fixed
 * approvals page rather than a payload-supplied URL.
 */
export function buildSignedOutPendingPayload(count) {
  const total = Number.isInteger(count) && count > 0 ? count : 0;
  return {
    title: TITLE,
    body: `คุณมีรายการรออนุมัติ ${total} รายการ`,
    route: NOTIFICATION_ROUTES.APPROVALS,
    tag: "leave-pending-signed-out",
    kind: NOTIFICATION_KINDS.PENDING_SIGNED_OUT,
    // The same pending total, so the service worker can set the icon badge.
    count: total,
  };
}

/** True when the serialised payload still fits a single push record. */
export function payloadFits(payload) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length <= MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}
