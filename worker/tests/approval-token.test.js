// Approval-link token rules. The database is a tiny fake that records the row,
// so the test can prove the raw token is never part of it.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  APPROVAL_LINK_TTL_MS,
  APPROVAL_TOKEN_BYTES,
  APPROVAL_TOKEN_PATTERN,
  approvalLinkBase,
  approvalTokenExpiresAt,
  approvalTokenFailureCategory,
  buildApprovalLink,
  decisionReasonProblem,
  hashApprovalToken,
  isApprovalToken,
  normalizeDecisionReason,
  randomApprovalToken,
} from "../src/approval-token.js";
import { createApprovalToken } from "../src/approval-link.js";
import { DECISION_NOTE_MAX_LENGTH } from "../src/leave-rules.js";

const CREATE_TIME = new Date("2026-11-09T03:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const APPROVER_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";

const RAW = "T".repeat(43);
const OTHER_RAW = "U".repeat(43);

function tokenRow(overrides = {}) {
  return {
    id: "token-1",
    leave_request_id: REQUEST_ID,
    approver_employee_id: APPROVER_ID,
    token_hash: "a".repeat(64),
    created_at: CREATE_TIME.toISOString(),
    expires_at: "2026-11-12T03:00:00.000Z",
    used_at: null,
    invalidated_at: null,
    created_by: null,
    ...overrides,
  };
}

function requestRow(overrides = {}) {
  return {
    id: REQUEST_ID,
    employee_id: EMPLOYEE_ID,
    approver_id: APPROVER_ID,
    status: "pending",
    ...overrides,
  };
}

test("a raw token is 32 random bytes in base64url", () => {
  const first = randomApprovalToken();
  const second = randomApprovalToken();

  assert.equal(first.length, 43);
  assert.match(first, APPROVAL_TOKEN_PATTERN);
  assert.equal(Buffer.from(first, "base64url").length, APPROVAL_TOKEN_BYTES);
  assert.notEqual(first, second);
  assert.equal(isApprovalToken(first), true);
  assert.equal(isApprovalToken("short"), false);
  assert.equal(isApprovalToken("T".repeat(44)), false);
  assert.equal(isApprovalToken(null), false);
});

test("only the SHA-256 hash is stored, with a 72-hour expiry", async () => {
  const rows = [];
  const db = {
    insert: async (table, row, options) => {
      rows.push({ table, row, options });
      return { data: { id: "token-1" }, error: null };
    },
  };

  const issued = await createApprovalToken(db, {
    leaveRequestId: REQUEST_ID,
    approverEmployeeId: APPROVER_ID,
    now: CREATE_TIME,
  });

  assert.equal(issued.ok, true);
  assert.match(issued.rawToken, APPROVAL_TOKEN_PATTERN);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].table, "approval_tokens");

  const row = rows[0].row;
  const expected = createHash("sha256").update(issued.rawToken, "utf8").digest("hex");
  assert.equal(row.token_hash, expected);
  assert.equal(await hashApprovalToken(issued.rawToken), expected);
  assert.equal(JSON.stringify(row).includes(issued.rawToken), false);
  assert.equal(row.created_at, CREATE_TIME.toISOString());
  assert.equal(row.expires_at, "2026-11-12T03:00:00.000Z");
  assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 72 * 60 * 60 * 1000);
  assert.equal(row.used_at, null);
  assert.equal(row.invalidated_at, null);
  assert.equal(row.created_by, null);
  assert.equal(APPROVAL_LINK_TTL_MS, 72 * 60 * 60 * 1000);
});

test("a resend records the HR employee as created_by", async () => {
  const rows = [];
  const db = {
    insert: async (table, row) => {
      rows.push(row);
      return { data: { id: "token-2" }, error: null };
    },
  };

  await createApprovalToken(db, {
    leaveRequestId: REQUEST_ID,
    approverEmployeeId: APPROVER_ID,
    createdBy: "44444444-4444-4444-8444-444444444444",
    now: CREATE_TIME,
  });

  assert.equal(rows[0].created_by, "44444444-4444-4444-8444-444444444444");
});

test("the link is built from the configured public URL only", () => {
  assert.equal(
    buildApprovalLink("https://hr.example.test", RAW),
    `https://hr.example.test/approve/${RAW}`
  );
  assert.equal(
    buildApprovalLink("https://hr.example.test/app/", RAW),
    `https://hr.example.test/app/approve/${RAW}`
  );
  assert.equal(
    buildApprovalLink("  https://hr.example.test  ", RAW),
    `https://hr.example.test/approve/${RAW}`
  );
  assert.equal(approvalLinkBase("https://hr.example.test///"), "https://hr.example.test");

  assert.equal(buildApprovalLink("", RAW), null);
  assert.equal(buildApprovalLink(null, RAW), null);
  assert.equal(buildApprovalLink("javascript:alert(1)", RAW), null);
  assert.equal(buildApprovalLink("https://hr.example.test/?x=1", RAW), null);
  assert.equal(buildApprovalLink("https://user:pass@hr.example.test", RAW), null);
  assert.equal(buildApprovalLink("https://hr.example.test", "short"), null);

  // No request is involved: the service only accepts an explicit base.
  const service = readFileSync(new URL("../src/approval-link.js", import.meta.url), "utf8");
  assert.equal(/req\.header|request\.headers|new URL\(request\b/.test(service), false);
});

test("expiry is exactly 72 hours after creation", () => {
  assert.equal(approvalTokenExpiresAt(CREATE_TIME), "2026-11-12T03:00:00.000Z");
  assert.equal(approvalTokenExpiresAt(CREATE_TIME.toISOString()), "2026-11-12T03:00:00.000Z");
  assert.equal(approvalTokenExpiresAt("not-a-date"), null);
});

test("the reject reason uses the in-app rule: 1 to 500 code points", () => {
  assert.equal(DECISION_NOTE_MAX_LENGTH, 500);

  assert.equal(decisionReasonProblem(undefined), "required");
  assert.equal(decisionReasonProblem(""), "required");
  assert.equal(decisionReasonProblem("   \n "), "required");
  assert.equal(decisionReasonProblem("ไม่สะดวก"), null);
  assert.equal(decisionReasonProblem("  ไม่สะดวก  "), null);
  assert.equal(decisionReasonProblem("ก".repeat(500)), null);
  assert.equal(decisionReasonProblem("ก".repeat(501)), "too_long");

  assert.equal(
    normalizeDecisionReason("  ไม่   สะดวก \n เนื่องจากประชุม "),
    "ไม่ สะดวก เนื่องจากประชุม"
  );
});

test("failure categories are used, expired or invalid, in that order", () => {
  const now = new Date("2026-11-09T04:00:00.000Z");
  const usable = { token: tokenRow(), request: requestRow(), now, approverResponsible: true };
  assert.equal(approvalTokenFailureCategory(usable), null);

  assert.equal(
    approvalTokenFailureCategory({ ...usable, token: tokenRow({ used_at: "2026-11-09T03:30:00.000Z" }) }),
    "used"
  );
  // A used token stays "used" even if it has since expired.
  assert.equal(
    approvalTokenFailureCategory({
      ...usable,
      token: tokenRow({ used_at: "2026-11-09T03:30:00.000Z", expires_at: "2026-11-09T03:45:00.000Z" }),
    }),
    "used"
  );
  assert.equal(
    approvalTokenFailureCategory({
      ...usable,
      token: tokenRow({ invalidated_at: "2026-11-09T03:30:00.000Z" }),
    }),
    "invalid"
  );
  assert.equal(
    approvalTokenFailureCategory({
      ...usable,
      token: tokenRow({ expires_at: now.toISOString() }),
    }),
    "expired"
  );
  assert.equal(
    approvalTokenFailureCategory({ ...usable, request: requestRow({ status: "approved" }) }),
    "invalid"
  );
  assert.equal(
    approvalTokenFailureCategory({ ...usable, request: requestRow({ approver_id: OTHER_RAW }) }),
    "invalid"
  );
  assert.equal(approvalTokenFailureCategory({ ...usable, approverResponsible: false }), "invalid");
  assert.equal(approvalTokenFailureCategory({ token: null }), "invalid");
});
