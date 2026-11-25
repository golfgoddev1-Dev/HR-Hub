import test from "node:test";
import assert from "node:assert/strict";

import { bytesToBase64Url } from "../src/push/base64url.js";
import { buildVapidAuthorization } from "../src/push/vapid.js";

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: bytesToBase64Url(raw),
    privateKey: jwk.d,
  };
}

test("a VAPID token is reused for the same push origin until it nears expiry", async () => {
  const keys = await vapidKeys();
  const base = { subject: "mailto:test@example.com", ...keys };
  const t0 = new Date("2026-11-05T10:00:00.000Z");

  const first = await buildVapidAuthorization({ ...base, endpoint: "https://push.example/a", now: t0 });
  const second = await buildVapidAuthorization({
    ...base,
    endpoint: "https://push.example/b",
    now: new Date(t0.getTime() + 60 * 1000),
  });
  assert.equal(second.token, first.token);

  const other = await buildVapidAuthorization({ ...base, endpoint: "https://other.example/a", now: t0 });
  assert.notEqual(other.token, first.token);

  const late = await buildVapidAuthorization({
    ...base,
    endpoint: "https://push.example/a",
    now: new Date(t0.getTime() + 11.5 * 60 * 60 * 1000),
  });
  assert.notEqual(late.token, first.token);
});
