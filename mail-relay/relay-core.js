// Pure relay logic, used by the Apps Script web app (Code.gs) and by the Node
// tests. No Apps Script service is referenced here, so the file behaves the same
// in both places.
//
// Apps Script has no module system: a pasted file must declare a plain global.
// This file therefore publishes one global, `RelayCore`, and the Node test
// imports it for that side effect. One copy is deliberate — a second copy for
// Node would drift from the code that actually runs.
//
// Limits are kept in step with the Worker client (worker/src/email/relay.js):
// subject <= 120 characters, text <= 4000 characters.

(function (scope) {
  "use strict";

  var MAX_SUBJECT_LENGTH = 120;
  var MAX_TEXT_LENGTH = 4000;
  var MAX_RECIPIENT_LENGTH = 254;
  var ALLOWED_KEYS = ["to", "subject", "text"];
  // One bare address: no display name, no list, no whitespace.
  var EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  // A subject is a mail header: CR, LF and NUL would let a caller add headers.
  var SUBJECT_CONTROL = /[\u0000\r\n]/;

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isSingleEmail(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_RECIPIENT_LENGTH &&
      EMAIL_PATTERN.test(value)
    );
  }

  /**
   * Accepts exactly { to, subject, text }. Extra keys (including `html`) are
   * refused rather than ignored, so a caller cannot add a field this relay does
   * not expect. Returns { ok: true } or { ok: false, code: "bad_request" };
   * never says which field was wrong.
   */
  function validatePayload(body) {
    var bad = { ok: false, code: "bad_request" };
    if (!isPlainObject(body)) return bad;

    var keys = Object.keys(body);
    if (keys.length !== ALLOWED_KEYS.length) return bad;
    for (var index = 0; index < keys.length; index += 1) {
      if (ALLOWED_KEYS.indexOf(keys[index]) === -1) return bad;
    }

    var to = body.to;
    var subject = body.subject;
    var text = body.text;

    if (!isSingleEmail(to)) return bad;

    if (
      typeof subject !== "string" ||
      subject.length < 1 ||
      subject.length > MAX_SUBJECT_LENGTH ||
      subject.trim().length === 0 ||
      SUBJECT_CONTROL.test(subject)
    ) {
      return bad;
    }

    if (
      typeof text !== "string" ||
      text.length < 1 ||
      text.length > MAX_TEXT_LENGTH ||
      text.trim().length === 0
    ) {
      return bad;
    }

    return { ok: true };
  }

  /**
   * Constant-time token comparison. The loop always walks the whole value, so
   * the time taken does not depend on how many characters matched. A missing or
   * empty expected value never matches, and different lengths answer false
   * without comparing (the length of a shared secret is not sensitive here).
   */
  function checkToken(provided, expected) {
    if (typeof provided !== "string" || typeof expected !== "string") return false;
    if (expected.length === 0 || provided.length !== expected.length) return false;

    var difference = 0;
    for (var index = 0; index < expected.length; index += 1) {
      difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return difference === 0;
  }

  /**
   * The send decision for today. A safety margin is kept back so the account is
   * never pushed to exactly zero (other Workspace mail may still need to go
   * out). Strictly more than the margin is required.
   */
  function decideQuota(remainingDaily, safetyMargin) {
    var margin = typeof safetyMargin === "number" ? safetyMargin : 100;
    var remaining = typeof remainingDaily === "number" ? remainingDaily : 0;
    return remaining > margin ? "send" : "refuse";
  }

  /**
   * YYYY-MM-DD for an instant in the given zone. Used as the daily counter key,
   * so the counter rolls over at Bangkok midnight and not at UTC midnight.
   */
  function sameDayKey(date, timeZone) {
    var zone = typeof timeZone === "string" && timeZone.length > 0 ? timeZone : "Asia/Bangkok";
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    var year = "";
    var month = "";
    var day = "";
    for (var index = 0; index < parts.length; index += 1) {
      if (parts[index].type === "year") year = parts[index].value;
      else if (parts[index].type === "month") month = parts[index].value;
      else if (parts[index].type === "day") day = parts[index].value;
    }
    return year + "-" + month + "-" + day;
  }

  scope.RelayCore = {
    MAX_SUBJECT_LENGTH: MAX_SUBJECT_LENGTH,
    MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
    validatePayload: validatePayload,
    checkToken: checkToken,
    decideQuota: decideQuota,
    sameDayKey: sameDayKey,
  };
})(typeof globalThis === "object" && globalThis !== null ? globalThis : this);
