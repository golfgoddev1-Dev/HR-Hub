// HR Hub mail relay: one server-to-server endpoint, POST /send.
//
// Contract (the API Worker is the only intended caller):
//   Authorization: Bearer <MAIL_RELAY_SECRET>
//   Content-Type: application/json
//   { "to": "<one address>", "subject": "<text>", "text": "<plain text>" }
//
// The relay holds the provider API key, so the API Worker never sees it. Every
// answer is JSON with a short code, and no answer or log line carries the
// recipient, subject, body, provider response or the shared secret.

import {
  MAX_BODY_BYTES,
  byteLength,
  validateRelayMessage,
} from "./message.js";
import { buildProviderRequest, classifyProviderStatus } from "./provider.js";
import { bearerToken, secretsMatch } from "./secret.js";

export const SEND_PATH = "/send";

const COMMON_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function fail(status, code, extraHeaders = {}) {
  return json({ ok: false, code }, status, extraHeaders);
}

function methodNotAllowed() {
  return fail(405, "method_not_allowed", { Allow: "POST" });
}

function configured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Reads and parses the JSON body, bounded by MAX_BODY_BYTES. */
async function readMessageBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "too_large" };
  }

  const raw = await request.text();
  if (byteLength(raw) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "too_large" };
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, code: "invalid_message" };
  }

  const validated = validateRelayMessage(body);
  if (!validated.ok) {
    return { ok: false, status: 400, code: "invalid_message" };
  }
  return { ok: true, message: validated.message };
}

export async function handleRequest(request, env = {}) {
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return fail(400, "invalid_request");
  }

  if (pathname !== SEND_PATH) return fail(404, "not_found");
  if (request.method !== "POST") return methodNotAllowed();

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return fail(415, "unsupported_media_type");
  }

  // Fail closed: a relay without its shared secret never accepts a message.
  if (!configured(env.MAIL_RELAY_SECRET)) return fail(503, "not_configured");

  const provided = bearerToken(request.headers.get("Authorization"));
  if (!(await secretsMatch(provided, env.MAIL_RELAY_SECRET))) {
    return fail(401, "unauthorized");
  }

  // Checked after authentication so an anonymous caller cannot tell whether
  // the provider is configured.
  if (!configured(env.RESEND_API_KEY) || !configured(env.MAIL_FROM)) {
    return fail(503, "not_configured");
  }

  const body = await readMessageBody(request);
  if (!body.ok) return fail(body.status, body.code);

  const { url, init } = buildProviderRequest({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    message: body.message,
  });

  let response;
  try {
    response = await fetch(url, init);
  } catch {
    // No provider detail, no recipient: only the transport failure.
    console.error("[mail-relay-send]", { code: "fetch_failed" });
    return fail(503, "upstream_busy");
  }

  const outcome = classifyProviderStatus(response.status);
  if (outcome.ok) return json({ ok: true }, 202);

  console.error("[mail-relay-send]", { status: outcome.status });
  return outcome.retryable ? fail(503, "upstream_busy") : fail(502, "send_failed");
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env ?? {});
    } catch (error) {
      console.error("[mail-relay-error]", { name: error?.name, code: error?.code });
      return fail(500, "internal_error");
    }
  },
};
