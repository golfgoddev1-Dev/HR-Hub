// VAPID (RFC 8292): an ES256 JWT in the Authorization header.
//
// Keys come from the environment only (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT). Nothing here reads, logs or prints a key value, and the
// private key never appears in the token: only the public key is sent as `k`.

import { base64UrlToBytes, bytesToBase64Url, utf8 } from "./base64url.js";

export const VAPID_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
export const VAPID_MAX_LIFETIME_SECONDS = 24 * 60 * 60;

function requireP256Public(value) {
  const bytes = base64UrlToBytes(value);
  if (!bytes || bytes.length !== 65 || bytes[0] !== 0x04) throw new Error("invalid vapid public key");
  return bytes;
}

function requireP256Private(value) {
  const bytes = base64UrlToBytes(value);
  if (!bytes || bytes.length !== 32) throw new Error("invalid vapid private key");
  return bytes;
}

/** aud is the push service origin; exp is seconds since the epoch. */
export function vapidClaims({ endpoint, subject, now = new Date(), lifetimeSeconds = VAPID_TOKEN_LIFETIME_SECONDS }) {
  const origin = new URL(endpoint).origin;
  if (!/^https:\/\//i.test(origin)) throw new Error("invalid push endpoint");
  if (typeof subject !== "string" || subject.trim().length === 0) throw new Error("missing vapid subject");

  const lifetime = Math.min(Math.max(lifetimeSeconds, 60), VAPID_MAX_LIFETIME_SECONDS);
  return {
    aud: origin,
    exp: Math.floor(now.getTime() / 1000) + lifetime,
    sub: subject.trim(),
  };
}

/**
 * Builds the Authorization header value: `vapid t=<jwt>, k=<public key>`.
 * The JWT is signed with ECDSA P-256 / SHA-256 via Web Crypto; Web Crypto
 * already returns the raw r||s pair that JWS ES256 expects.
 */
export async function buildVapidAuthorization({
  endpoint,
  subject,
  publicKey,
  privateKey,
  now = new Date(),
}) {
  const publicBytes = requireP256Public(publicKey);
  const privateBytes = requireP256Private(privateKey);
  const claims = vapidClaims({ endpoint, subject, now });

  const header = { typ: "JWT", alg: "ES256" };
  const signingInput = `${bytesToBase64Url(utf8(JSON.stringify(header)))}.${bytesToBase64Url(
    utf8(JSON.stringify(claims))
  )}`;

  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: bytesToBase64Url(privateBytes),
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
  };

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput))
  );

  const token = `${signingInput}.${bytesToBase64Url(signature)}`;
  return {
    authorization: `vapid t=${token}, k=${publicKey}`,
    token,
    claims,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
