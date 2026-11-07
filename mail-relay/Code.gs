// HR Hub mail relay — Google Apps Script web app.
//
// Paste this file and relay-core.js into one Apps Script project (see README.md).
// The Worker calls this deployment with a JSON POST; MailApp sends the message
// from the company Workspace account, so the sender is that account and no DNS
// record has to change.
//
// Order of checks: kill switch, body size/type, payload shape, token, recipient
// allowlist, per-minute cap, per-day cap, Google's remaining quota, send.
//
// Token: the Worker sends X-Relay-Token, but Apps Script's web-app event object
// does not expose inbound request headers, so the token is read from the `token`
// query parameter. If a header is ever exposed it must match as well.
//
// Nothing is logged: no recipient, subject, body, token, URL or property value
// reaches Logger, console or any other sink. Responses carry only
// { ok: true } or { ok: false, code } from RelayCore.ALLOWED_CODES.

var TOKEN_PROPERTY = "RELAY_TOKEN";
var ENABLED_PROPERTY = "RELAY_ENABLED";
var DOMAINS_PROPERTY = "ALLOWED_RECIPIENT_DOMAINS";
var MAX_PER_MINUTE_PROPERTY = "RELAY_MAX_PER_MINUTE";
var MAX_PER_DAY_PROPERTY = "RELAY_MAX_PER_DAY";

var COUNTER_PREFIX = "sent:";
var MINUTE_PREFIX = "min:";
var QUOTA_SAFETY_MARGIN = 100;
var LOCK_WAIT_MS = 10000;
var MINUTE_CACHE_SECONDS = 120;
var SENDER_NAME = "HR Hub";

function doPost(e) {
  try {
    var properties = PropertiesService.getScriptProperties();

    // Kill switch first: the owner stops the relay by setting RELAY_ENABLED to
    // anything other than "true". No redeploy, no URL change.
    if (!RelayCore.relayEnabled(properties.getProperty(ENABLED_PROPERTY))) {
      return respond(RelayCore.failure("disabled"));
    }

    var parsed = readJsonBody(e);
    if (!parsed.ok) return respond(parsed);

    var validation = RelayCore.validatePayload(parsed.payload);
    if (!validation.ok) return respond(validation);

    var token = RelayCore.verifyRequestToken({
      queryString: e ? e.queryString : null,
      headers: e ? e.headers : null,
      expected: properties.getProperty(TOKEN_PROPERTY),
    });
    if (!token.ok) return respond(token);

    // Fail closed: no allowlist configured means no send at all.
    var recipient = RelayCore.checkRecipientDomain(
      parsed.payload.to,
      properties.getProperty(DOMAINS_PROPERTY)
    );
    if (!recipient.ok) return respond(recipient);

    return respond(sendWithinCaps(parsed.payload, properties));
  } catch (error) {
    // Never echo an exception message: it can contain the recipient or body.
    return respond(RelayCore.failure("send_failed"));
  }
}

/** Body size and content type first, then JSON parsing. */
function readJsonBody(e) {
  var postData = e && e.postData ? e.postData : null;
  var contents = postData ? postData.contents : null;
  var declared = postData && typeof postData.length === "number" ? postData.length : null;

  if (RelayCore.bodyTooLarge(contents, declared)) {
    return RelayCore.failure("bad_request");
  }
  if (!RelayCore.isJsonContentType(postData ? postData.type : null)) {
    return RelayCore.failure("bad_request");
  }
  if (typeof contents !== "string" || contents.length === 0) {
    return RelayCore.failure("bad_request");
  }

  var body;
  try {
    body = JSON.parse(contents);
  } catch (error) {
    return RelayCore.failure("bad_request");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return RelayCore.failure("bad_request");
  }
  return { ok: true, payload: body };
}

/**
 * Both caps are enforced under one script lock, so two overlapping calls cannot
 * slip past the same allowance. The attempt is counted before MailApp is
 * called, so a send that throws still consumes the allowance.
 *
 * The per-minute counter lives in the script cache (a short-lived counter), the
 * daily counter in Script Properties (it must survive eviction). Neither is
 * added to MailApp.getRemainingDailyQuota(), which the mail service already
 * decrements, so nothing is counted twice.
 */
function sendWithinCaps(payload, properties) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
  } catch (error) {
    // Another send is running: refuse rather than race the counters.
    return RelayCore.failure("quota");
  }

  try {
    var now = new Date();
    var cache = CacheService.getScriptCache();
    var minuteKey = MINUTE_PREFIX + RelayCore.sameMinuteKey(now);
    var dayKey = COUNTER_PREFIX + RelayCore.sameDayKey(now);

    var counters = {
      minuteCount: Number(cache.get(minuteKey)) || 0,
      dayCount: Number(properties.getProperty(dayKey)) || 0,
    };

    var caps = RelayCore.checkCaps({
      minuteCount: counters.minuteCount,
      dayCount: counters.dayCount,
      maxPerMinute: RelayCore.limitOrDefault(
        properties.getProperty(MAX_PER_MINUTE_PROPERTY),
        RelayCore.DEFAULT_MAX_PER_MINUTE
      ),
      maxPerDay: RelayCore.limitOrDefault(
        properties.getProperty(MAX_PER_DAY_PROPERTY),
        RelayCore.DEFAULT_MAX_PER_DAY
      ),
      remainingDaily: MailApp.getRemainingDailyQuota(),
      safetyMargin: QUOTA_SAFETY_MARGIN,
    });
    if (!caps.ok) return caps;

    var next = RelayCore.recordAttempt(counters);
    cache.put(minuteKey, String(next.minuteCount), MINUTE_CACHE_SECONDS);
    properties.setProperty(dayKey, String(next.dayCount));

    try {
      MailApp.sendEmail({
        to: payload.to,
        subject: payload.subject,
        body: payload.text,
        name: SENDER_NAME,
      });
    } catch (error) {
      return RelayCore.failure("send_failed");
    }

    return { ok: true };
  } catch (error) {
    return RelayCore.failure("send_failed");
  } finally {
    lock.releaseLock();
  }
}

function respond(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
