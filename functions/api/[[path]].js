// Pages Function: proxies /api/* to the API Worker over the WORKER service
// binding, so the browser sees one origin (the Pages host) and the
// SameSite=Strict hr_session cookie is sent with every /api request.
//
// The Worker routes on pathname + query string only; it reads no Host and no
// Origin header (APP_ORIGIN is a Worker variable used to build register links,
// never derived from the request). The request URL is therefore forwarded
// unchanged, which also keeps relative redirect targets meaningful.
//
// The Worker's response is returned as-is: status, body and every header,
// including every Set-Cookie, are never rebuilt. Nothing here adds, drops or
// rewrites a cookie.

const BINDING_NAME = "WORKER";

// RFC 9110 hop-by-hop headers: they describe one connection, not the message.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Fixed body for binding failures: the reason never reaches the client.
const UNAVAILABLE_BODY = JSON.stringify({ ok: false, message: "service unavailable" });

function unavailable() {
  return new Response(UNAVAILABLE_BODY, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

/** Copies request headers, dropping hop-by-hop ones. */
function forwardedHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    headers.append(name, value);
  }
  return headers;
}

export async function onRequest(context) {
  const worker = context.env ? context.env[BINDING_NAME] : undefined;
  if (!worker || typeof worker.fetch !== "function") return unavailable();

  const { request } = context;
  // GET and HEAD must not carry a body.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: forwardedHeaders(request),
      body: hasBody ? request.body : undefined,
      // A redirect from the Worker is part of its response and must reach the
      // browser unchanged, not be followed here.
      redirect: "manual",
    });

    return await worker.fetch(forwarded);
  } catch {
    return unavailable();
  }
}
