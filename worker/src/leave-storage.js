// Supabase Storage REST calls for medical certificates.
//
// No dependency: the Storage API is three endpoints, and the Worker already has
// SUPABASE_URL and the service role key. Only the object path is ever stored or
// returned; a signed URL is created on demand and expires after 60 seconds.

import { getRequiredEnv } from "./env.js";
import { CERTIFICATE_BUCKET, SIGNED_URL_EXPIRES_IN } from "./leave-attachment.js";

function storageBaseUrl(env) {
  return getRequiredEnv(env, "SUPABASE_URL").trim().replace(/\/+$/, "");
}

function authHeaders(env) {
  const apiKey = getRequiredEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: apiKey, Authorization: `Bearer ${apiKey}` };
}

/** Encodes each path segment and never lets an empty segment through. */
function encodeObjectPath(path) {
  return path
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function objectUrl(env, path) {
  return `${storageBaseUrl(env)}/storage/v1/object/${encodeURIComponent(CERTIFICATE_BUCKET)}/${encodeObjectPath(path)}`;
}

/** Uploads bytes to the bucket. Returns { ok, status }. */
export async function uploadCertificate(env, path, bytes, contentType) {
  const response = await fetch(objectUrl(env, path), {
    method: "POST",
    headers: {
      ...authHeaders(env),
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: bytes,
  });
  return { ok: response.ok, status: response.status };
}

/** Deletes one object. A missing object counts as success. */
export async function deleteCertificate(env, path) {
  const response = await fetch(objectUrl(env, path), {
    method: "DELETE",
    headers: authHeaders(env),
  });
  return { ok: response.ok || response.status === 404, status: response.status };
}

/** Short-lived signed URL; never the public object URL. */
export async function createCertificateSignedUrl(env, path, expiresIn = SIGNED_URL_EXPIRES_IN) {
  const response = await fetch(
    `${storageBaseUrl(env)}/storage/v1/object/sign/${encodeURIComponent(CERTIFICATE_BUCKET)}/${encodeObjectPath(path)}`,
    {
      method: "POST",
      headers: { ...authHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    }
  );

  if (!response.ok) return { ok: false, status: response.status };

  const data = await response.json().catch(() => null);
  const signed =
    typeof data?.signedURL === "string"
      ? data.signedURL
      : typeof data?.signedUrl === "string"
        ? data.signedUrl
        : null;
  if (!signed || signed.includes("token=") === false) return { ok: false, status: response.status };

  const url = /^https?:\/\//i.test(signed)
    ? signed
    : `${storageBaseUrl(env)}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;

  return { ok: true, url, expiresIn };
}
