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
// subject <= 120 characters, text <= 4000 characters, body <= 16 KiB, and a
// relay token of at least 32 characters.

(function (scope) {
  "use strict";

  var MAX_SUBJECT_LENGTH = 120;
  var MAX_TEXT_LENGTH = 4000;
  var MAX_RECIPIENT_LENGTH = 254;
  var MAX_BODY_BYTES = 16384;
  var MIN_TOKEN_LENGTH = 32;
  var DEFAULT_MAX_PER_MINUTE = 30;
  var DEFAULT_MAX_PER_DAY = 300;
  var DEFAULT_QUOTA_MARGIN = 100;
  var TOKEN_PARAM = "token";

  var ALLOWED_KEYS = ["to", "subject", "text"];

  // The only codes a response may carry.
  var ALLOWED_CODES = [
    "bad_request",
    "unauthorized",
    "disabled",
    "config",
    "recipient_not_allowed",
    "rate_limited",
    "quota",
    "send_failed",
  ];

  // One bare address: no display name, no list, no whitespace.
  var EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  // A subject is a mail header: CR, LF and NUL would let a caller add headers.
  var SUBJECT_CONTROL = /[\u0000\r\n]/;
  // No control character anywhere in an address.
  var ADDRESS_CONTROL = /[\u0000-\u001f\u007f]/;

  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isSingleEmail(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_RECIPIENT_LENGTH &&
      !ADDRESS_CONTROL.test(value) &&
      EMAIL_PATTERN.test(value)
    );
  }

  /** UTF-8 byte length, so a Thai body is measured in bytes, not characters. */
  function utf8ByteLength(text) {
    if (typeof text !== "string") return 0;
    var bytes = 0;
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        var next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  /** True when a body must be refused before it is parsed. */
  function bodyTooLarge(contents, declaredLength) {
    if (
      typeof declaredLength === "number" &&
      isFinite(declaredLength) &&
      declaredLength > MAX_BODY_BYTES
    ) {
      return true;
    }
    return utf8ByteLength(typeof contents === "string" ? contents : "") > MAX_BODY_BYTES;
  }

  /** A POST body must be JSON; a charset suffix is fine, anything else is not. */
  function isJsonContentType(value) {
    if (typeof value !== "string") return false;
    var base = value.split(";")[0].trim().toLowerCase();
    return base === "application/json";
  }

  /**
   * Accepts exactly { to, subject, text }. Extra keys (including `html` and a
   * token in the body) are refused rather than ignored. Returns { ok: true } or
   * { ok: false, code: "bad_request" }; never says which field was wrong.
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

  /** The kill switch is the exact string "true"; everything else is off. */
  function relayEnabled(value) {
    return value === "true";
  }

  /**
   * A numeric cap from Script Properties: a non-negative integer, or the
   * fallback when the property is missing, blank or unusable.
   */
  function limitOrDefault(value, fallback) {
    if (typeof value === "number") {
      return isFinite(value) && value >= 0 && Math.floor(value) === value ? value : fallback;
    }
    if (typeof value !== "string") return fallback;

    var trimmed = value.trim();
    if (trimmed.length === 0) return fallback;

    var parsed = Number(trimmed);
    if (!isFinite(parsed) || Math.floor(parsed) !== parsed || parsed < 0) return fallback;
    return parsed;
  }

  /**
   * The send decision for today. A safety margin is kept back so the account is
   * never pushed to exactly zero. Strictly more than the margin is required.
   */
  function decideQuota(remainingDaily, safetyMargin) {
    var margin = typeof safetyMargin === "number" ? safetyMargin : DEFAULT_QUOTA_MARGIN;
    var remaining = typeof remainingDaily === "number" ? remainingDaily : 0;
    return remaining > margin ? "send" : "refuse";
  }

  /**
   * Per-minute cap first (a burst), then the daily cap, then Google's own
   * remaining allowance. Every limit fails closed.
   */
  function checkCaps(options) {
    var settings = isPlainObject(options) ? options : {};
    var minuteCount = typeof settings.minuteCount === "number" ? settings.minuteCount : 0;
    var dayCount = typeof settings.dayCount === "number" ? settings.dayCount : 0;

    var maxPerMinute = limitOrDefault(settings.maxPerMinute, DEFAULT_MAX_PER_MINUTE);
    var maxPerDay = limitOrDefault(settings.maxPerDay, DEFAULT_MAX_PER_DAY);
    var margin = limitOrDefault(settings.safetyMargin, DEFAULT_QUOTA_MARGIN);

    if (minuteCount >= maxPerMinute) return { ok: false, code: "rate_limited" };
    if (dayCount >= maxPerDay) return { ok: false, code: "quota" };
    if (decideQuota(settings.remainingDaily, margin) !== "send") {
      return { ok: false, code: "quota" };
    }
    return { ok: true };
  }

  /**
   * Counters after one accepted attempt. The caller records this *before*
   * calling MailApp, so a send that throws still consumes the allowance and a
   * failing loop cannot run past the caps.
   */
  function recordAttempt(counters) {
    var current = isPlainObject(counters) ? counters : {};
    var minuteCount =
      typeof current.minuteCount === "number" && current.minuteCount >= 0
        ? current.minuteCount
        : 0;
    var dayCount =
      typeof current.dayCount === "number" && current.dayCount >= 0 ? current.dayCount : 0;

    return { minuteCount: minuteCount + 1, dayCount: dayCount + 1 };
  }

  /** The configured allowlist as lowercase, de-duplicated domains. */
  function allowedDomains(value) {
    if (typeof value !== "string") return [];
    var parts = value.split(",");
    var domains = [];
    for (var index = 0; index < parts.length; index += 1) {
      var domain = parts[index].trim().toLowerCase();
      if (domain.length > 0 && domains.indexOf(domain) === -1) domains.push(domain);
    }
    return domains;
  }

  /** The lowercased domain of one bare address, or null when it is not one. */
  function domainOf(address) {
    if (!isSingleEmail(address)) return null;
    var at = address.lastIndexOf("@");
    if (at <= 0) return null;
    return address.slice(at + 1).trim().toLowerCase();
  }

  /**
   * Fail closed: no configured allowlist means no send at all. A domain matches
   * only exactly, so "evil.company.co.th" is not "company.co.th". The refusal
   * never contains the address.
   */
  function checkRecipientDomain(to, allowed) {
    var domains = allowedDomains(allowed);
    if (domains.length === 0) return { ok: false, code: "config" };

    var domain = domainOf(to);
    if (domain === null) return { ok: false, code: "recipient_not_allowed" };
    if (domains.indexOf(domain) === -1) return { ok: false, code: "recipient_not_allowed" };
    return { ok: true };
  }

  function decodeComponent(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, " "));
    } catch (error) {
      return null;
    }
  }

  /**
   * The token from the raw query string. Exactly one `token` parameter is
   * allowed: none is unauthorized, more than one is a malformed request, and any
   * other parameter is refused. The body is never a token source.
   */
  function tokenFromQuery(queryString) {
    if (typeof queryString !== "string" || queryString.trim().length === 0) {
      return { ok: false, code: "unauthorized" };
    }

    var segments = queryString.split("&");
    var values = [];
    for (var index = 0; index < segments.length; index += 1) {
      if (segments[index].length === 0) continue;

      var separator = segments[index].indexOf("=");
      var key = decodeComponent(
        separator === -1 ? segments[index] : segments[index].slice(0, separator)
      );
      var value = decodeComponent(
        separator === -1 ? "" : segments[index].slice(separator + 1)
      );
      if (key === null || value === null) return { ok: false, code: "bad_request" };
      if (key !== TOKEN_PARAM) return { ok: false, code: "bad_request" };
      values.push(value);
    }

    if (values.length === 0) return { ok: false, code: "unauthorized" };
    if (values.length > 1) return { ok: false, code: "bad_request" };
    return { ok: true, token: values[0] };
  }

  /**
   * A header token, if the runtime exposes one at all. Apps Script does not, so
   * `present` is normally false; when a header is present it must also match.
   */
  function headerToken(headers) {
    if (!headers || typeof headers !== "object") return { present: false, value: null };

    var keys = Object.keys(headers);
    for (var index = 0; index < keys.length; index += 1) {
      if (keys[index].toLowerCase() === "x-relay-token") {
        var value = headers[keys[index]];
        return { present: true, value: typeof value === "string" ? value : null };
      }
    }
    return { present: false, value: null };
  }

  /**
   * Full token check. A configured token shorter than 32 characters refuses
   * every request, so a weak property value cannot be used at all. A present
   * header must match the query token; the query token must match the expected
   * value.
   */
  function verifyRequestToken(options) {
    var settings = isPlainObject(options) ? options : {};
    var expected = settings.expected;

    if (typeof expected !== "string" || expected.length < MIN_TOKEN_LENGTH) {
      return { ok: false, code: "unauthorized" };
    }

    var parsed = tokenFromQuery(settings.queryString);
    if (!parsed.ok) return parsed;

    var header = headerToken(settings.headers);
    if (header.present && (header.value === null || !checkToken(header.value, parsed.token))) {
      return { ok: false, code: "unauthorized" };
    }

    if (!checkToken(parsed.token, expected)) return { ok: false, code: "unauthorized" };
    return { ok: true };
  }

  /** { ok:false, code } with a code from the allowed set (anything else is bad_request). */
  function failure(code) {
    return {
      ok: false,
      code: ALLOWED_CODES.indexOf(code) === -1 ? "bad_request" : code,
    };
  }

  /**
   * YYYY-MM-DD for an instant in the given zone. Used as the daily counter key,
   * so the counter rolls over at Bangkok midnight and not at UTC midnight.
   */
  function sameDayKey(date, timeZone) {
    var parts = zoneParts(date, timeZone, false);
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  /** YYYY-MM-DDTHH:mm for an instant in the given zone, used for the burst cap. */
  function sameMinuteKey(date, timeZone) {
    var parts = zoneParts(date, timeZone, true);
    return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
  }

  function zoneParts(date, timeZone, withTime) {
    var zone = typeof timeZone === "string" && timeZone.length > 0 ? timeZone : "Asia/Bangkok";
    var options = {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    if (withTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
    }

    var parts = new Intl.DateTimeFormat("en-US", options).formatToParts(date);
    var collected = { year: "", month: "", day: "", hour: "00", minute: "00" };
    for (var index = 0; index < parts.length; index += 1) {
      var type = parts[index].type;
      if (type === "year") collected.year = parts[index].value;
      else if (type === "month") collected.month = parts[index].value;
      else if (type === "day") collected.day = parts[index].value;
      else if (type === "hour") collected.hour = parts[index].value;
      else if (type === "minute") collected.minute = parts[index].value;
    }
    // Some ICU builds report midnight as 24 under hour12=false.
    if (collected.hour === "24") collected.hour = "00";
    return collected;
  }

  scope.RelayCore = {
    MAX_SUBJECT_LENGTH: MAX_SUBJECT_LENGTH,
    MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
    MAX_BODY_BYTES: MAX_BODY_BYTES,
    MIN_TOKEN_LENGTH: MIN_TOKEN_LENGTH,
    DEFAULT_MAX_PER_MINUTE: DEFAULT_MAX_PER_MINUTE,
    DEFAULT_MAX_PER_DAY: DEFAULT_MAX_PER_DAY,
    DEFAULT_QUOTA_MARGIN: DEFAULT_QUOTA_MARGIN,
    ALLOWED_CODES: ALLOWED_CODES,
    utf8ByteLength: utf8ByteLength,
    bodyTooLarge: bodyTooLarge,
    isJsonContentType: isJsonContentType,
    isSingleEmail: isSingleEmail,
    validatePayload: validatePayload,
    checkToken: checkToken,
    relayEnabled: relayEnabled,
    limitOrDefault: limitOrDefault,
    decideQuota: decideQuota,
    checkCaps: checkCaps,
    recordAttempt: recordAttempt,
    allowedDomains: allowedDomains,
    checkRecipientDomain: checkRecipientDomain,
    tokenFromQuery: tokenFromQuery,
    headerToken: headerToken,
    verifyRequestToken: verifyRequestToken,
    failure: failure,
    sameDayKey: sameDayKey,
    sameMinuteKey: sameMinuteKey,
  };
})(typeof globalThis === "object" && globalThis !== null ? globalThis : this);
