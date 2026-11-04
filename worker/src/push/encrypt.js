// RFC 8291 (Message Encryption for Web Push) with Web Crypto only.
//
// No Node crypto, no npm library: Workers expose ECDH, HMAC-SHA-256 and
// AES-128-GCM through crypto.subtle, which is everything the scheme needs.
// The RFC's Appendix A vector is reproduced byte for byte in
// tests/push-encrypt.test.js, and the ephemeral key pair plus salt can be
// injected so that test is deterministic.

import { concatBytes, utf8 } from "./base64url.js";

const RECORD_SIZE = 4096;
const DELIMITER = 0x02;
const KEY_INFO_PREFIX = utf8("WebPush: info\x00");
const CEK_INFO = utf8("Content-Encoding: aes128gcm\x00");
const NONCE_INFO = utf8("Content-Encoding: nonce\x00");

const P256_PUBLIC_BYTES = 65;
const SALT_BYTES = 16;
const AUTH_SECRET_BYTES = 16;

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

/** HKDF-Extract: HMAC(salt, ikm). */
export function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

/** HKDF-Expand with SHA-256, one or more blocks. */
export async function hkdfExpand(prk, info, length) {
  const blocks = [];
  let previous = new Uint8Array(0);
  let total = 0;
  let counter = 1;

  while (total < length) {
    const block = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])));
    blocks.push(block);
    previous = block;
    total += block.length;
    counter += 1;
  }

  return concatBytes(...blocks).slice(0, length);
}

/**
 * ECDH shared secret between the application server private key and the user
 * agent public key (uncompressed P-256 point, 65 bytes).
 */
export async function ecdhSecret(privateKey, publicKeyBytes) {
  const publicKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );
  return new Uint8Array(bits);
}

/**
 * The full RFC 8291 key schedule for one subscription.
 * Returns { ikm, prk, cek, nonce } as byte arrays.
 */
export async function deriveContentKeys({
  sharedSecret,
  authSecret,
  uaPublicKey,
  asPublicKey,
  salt,
}) {
  const prkKey = await hkdfExtract(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prkKey, concatBytes(KEY_INFO_PREFIX, uaPublicKey, asPublicKey), 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, CEK_INFO, 16);
  const nonce = await hkdfExpand(prk, NONCE_INFO, 12);
  return { ikm, prk, cek, nonce };
}

function assertBytes(name, value, expected) {
  if (!(value instanceof Uint8Array) || value.length !== expected) {
    throw new Error(`invalid ${name}`);
  }
}

/** A fresh ephemeral P-256 key pair, with the raw public point exported. */
export async function generateEphemeralKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey };
}

/**
 * Encrypts one push payload.
 *
 * body = salt(16) || rs(4, big-endian) || idlen(1) || as_public(65) || ciphertext
 * which is exactly the aes128gcm header RFC 8188 expects.
 */
export async function encryptWebPush({
  payload,
  uaPublicKey,
  authSecret,
  salt,
  ephemeralKeys,
}) {
  assertBytes("uaPublicKey", uaPublicKey, P256_PUBLIC_BYTES);
  assertBytes("authSecret", authSecret, AUTH_SECRET_BYTES);

  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  assertBytes("salt", saltBytes, SALT_BYTES);

  const ephemeral = ephemeralKeys ?? (await generateEphemeralKeys());
  assertBytes("ephemeral public key", ephemeral.publicKey, P256_PUBLIC_BYTES);

  const sharedSecret = await ecdhSecret(ephemeral.privateKey, uaPublicKey);
  const { cek, nonce } = await deriveContentKeys({
    sharedSecret,
    authSecret,
    uaPublicKey,
    asPublicKey: ephemeral.publicKey,
    salt: saltBytes,
  });

  const plaintext = concatBytes(utf8(payload), new Uint8Array([DELIMITER]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext)
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false);

  const body = concatBytes(
    saltBytes,
    recordSize,
    new Uint8Array([ephemeral.publicKey.length]),
    ephemeral.publicKey,
    ciphertext
  );

  return { body, ciphertext, salt: saltBytes, asPublicKey: ephemeral.publicKey, cek, nonce };
}
