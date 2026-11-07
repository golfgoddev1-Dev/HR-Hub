// HR Hub mail relay — Google Apps Script web app.
//
// Paste this file and relay-core.js into one Apps Script project (see README.md).
// The Worker calls this deployment with a JSON POST; MailApp sends the message
// from the company Workspace account, so the sender is that account and no DNS
// record has to change.
//
// Token: the Worker sends X-Relay-Token, but Apps Script's web-app event object
// does not expose inbound request headers, so the token is also accepted from
// the `token` query parameter on the deployment URL (the Worker appends it).
//
// Nothing is ever logged: no recipient, subject, body, token or URL reaches
// Logger or console. Responses carry only { ok: true } or { ok: false, code }.
// No response echoes any part of the message.

var TOKEN_PROPERTY = "RELAY_TOKEN";
var COUNTER_PREFIX = "sent:";
var QUOTA_SAFETY_MARGIN = 100;
var LOCK_WAIT_MS = 10000;
var SENDER_NAME = "HR Hub";

function doPost(e) {
  try {
    // a. Parse the JSON body.
    var parsed = parseBody(e);
    if (!parsed.ok) return respond(parsed);

    var payload = parsed.payload;

    // b. Shape and limits.
    var validation = RelayCore.validatePayload(payload);
    if (!validation.ok) return respond(validation);

    // c. Shared token. A missing token and a wrong token answer the same code.
    var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY);
    if (!RelayCore.checkToken(tokenFromEvent(e), expected)) {
      return respond({ ok: false, code: "unauthorized" });
    }

    return respond(sendWithinQuota(payload));
  } catch (error) {
    // Unexpected failure (properties, mail service, formatting): never echo it.
    return respond({ ok: false, code: "send_failed" });
  }
}

function parseBody(e) {
  var contents = e && e.postData ? e.postData.contents : null;
  if (typeof contents !== "string" || contents.length === 0) {
    return { ok: false, code: "bad_request" };
  }

  var body;
  try {
    body = JSON.parse(contents);
  } catch (error) {
    return { ok: false, code: "bad_request" };
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "bad_request" };
  }
  return { ok: true, payload: body };
}

/**
 * Header first (used if Apps Script ever exposes headers), then the query
 * parameter, which is what a real web-app deployment can read.
 */
function tokenFromEvent(e) {
  if (e && e.headers) {
    var header = e.headers["X-Relay-Token"] || e.headers["x-relay-token"];
    if (typeof header === "string" && header.length > 0) return header;
  }
  if (e && e.parameter && typeof e.parameter.token === "string") {
    return e.parameter.token;
  }
  return null;
}

/**
 * d/e/f/g. One send at a time (script lock), a daily counter keyed by the
 * Bangkok date, the quota decision, the send, then the counter increment.
 *
 * The counter is this script's own record of what it sent today; the quota
 * decision itself comes from MailApp.getRemainingDailyQuota(), which the mail
 * service already decrements. The two are not added together, so a send is
 * never counted twice.
 */
function sendWithinQuota(payload) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_WAIT_MS);
  } catch (error) {
    // Another send is in flight: refuse rather than risk two sends racing the
    // counter or the daily quota.
    return { ok: false, code: "quota" };
  }

  try {
    var properties = PropertiesService.getScriptProperties();
    var counterKey = COUNTER_PREFIX + RelayCore.sameDayKey(new Date());

    var sentToday = Number(properties.getProperty(counterKey));
    if (!isFinite(sentToday) || sentToday < 0) sentToday = 0;

    var decision = RelayCore.decideQuota(
      MailApp.getRemainingDailyQuota(),
      QUOTA_SAFETY_MARGIN
    );
    if (decision !== "send") return { ok: false, code: "quota" };

    try {
      MailApp.sendEmail({
        to: payload.to,
        subject: payload.subject,
        body: payload.text,
        name: SENDER_NAME,
      });
    } catch (error) {
      return { ok: false, code: "send_failed" };
    }

    properties.setProperty(counterKey, String(sentToday + 1));
    return { ok: true };
  } catch (error) {
    return { ok: false, code: "send_failed" };
  } finally {
    lock.releaseLock();
  }
}

function respond(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
