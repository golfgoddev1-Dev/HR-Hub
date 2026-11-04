// RFC 8291 encryption. The Appendix A vector is reproduced byte for byte, so a
// broken HKDF step, header layout or record size cannot pass unnoticed.
import { describe, expect, it } from 'vitest'

import {
  base64UrlToBytes,
  bytesToBase64Url,
  utf8,
} from '../worker/src/push/base64url.js'
import {
  deriveContentKeys,
  ecdhSecret,
  encryptWebPush,
} from '../worker/src/push/encrypt.js'

// Node exposes Web Crypto as `crypto`; older runtimes need the node:crypto one.
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto')
  globalThis.crypto = webcrypto
}

// RFC 8291 Appendix A. Not real credentials: the RFC's published test vector.
const VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  sharedSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

async function vectorEphemeralKeys() {
  const publicKey = base64UrlToBytes(VECTOR.asPublic)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: VECTOR.asPrivate,
    x: bytesToBase64Url(publicKey.slice(1, 33)),
    y: bytesToBase64Url(publicKey.slice(33, 65)),
  }
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  )
  return { privateKey, publicKey }
}

async function ephemeralPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
}

async function decryptBody(body, uaPrivateKey, uaPublicKey, authSecret) {
  const salt = body.slice(0, 16)
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false)
  const idLength = body[20]
  const asPublicKey = body.slice(21, 21 + idLength)
  const ciphertext = body.slice(21 + idLength)

  const shared = await ecdhSecret(uaPrivateKey, asPublicKey)
  const { cek, nonce } = await deriveContentKeys({
    sharedSecret: shared,
    authSecret,
    uaPublicKey,
    asPublicKey,
    salt,
  })

  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext)
  )

  // The last octet is the padding delimiter (0x02 for a single record).
  return {
    recordSize,
    idLength,
    delimiter: plain[plain.length - 1],
    text: new TextDecoder().decode(plain.slice(0, plain.length - 1)),
  }
}

describe('RFC 8291 Appendix A vector', () => {
  it('derives the published ECDH secret, PRK, CEK and nonce', async () => {
    const ephemeral = await vectorEphemeralKeys()
    const uaPublic = base64UrlToBytes(VECTOR.uaPublic)
    const salt = base64UrlToBytes(VECTOR.salt)
    const authSecret = base64UrlToBytes(VECTOR.authSecret)

    const shared = await ecdhSecret(ephemeral.privateKey, uaPublic)
    expect(bytesToBase64Url(shared)).toBe(VECTOR.sharedSecret)

    const keys = await deriveContentKeys({
      sharedSecret: shared,
      authSecret,
      uaPublicKey: uaPublic,
      asPublicKey: ephemeral.publicKey,
      salt,
    })
    expect(bytesToBase64Url(keys.prk)).toBe(VECTOR.prk)
    expect(bytesToBase64Url(keys.cek)).toBe(VECTOR.cek)
    expect(bytesToBase64Url(keys.nonce)).toBe(VECTOR.nonce)
  })

  it('produces the published ciphertext and body byte for byte', async () => {
    const ephemeral = await vectorEphemeralKeys()

    const result = await encryptWebPush({
      payload: VECTOR.plaintext,
      uaPublicKey: base64UrlToBytes(VECTOR.uaPublic),
      authSecret: base64UrlToBytes(VECTOR.authSecret),
      salt: base64UrlToBytes(VECTOR.salt),
      ephemeralKeys: ephemeral,
    })

    expect(bytesToBase64Url(result.ciphertext)).toBe(VECTOR.ciphertext)
    expect(bytesToBase64Url(result.body)).toBe(VECTOR.body)

    // salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
    expect(result.body[16 + 4]).toBe(65)
    expect(new DataView(result.body.buffer).getUint32(16, false)).toBe(4096)
  })
})

describe('round trip', () => {
  it('decrypts back to the payload the sender queued', async () => {
    const uaPair = await ephemeralPair()
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaPair.publicKey))
    const authSecret = crypto.getRandomValues(new Uint8Array(16))
    const payload = JSON.stringify({ title: 'มีใบลารออนุมัติ', body: 'มีใบลาใหม่รอการอนุมัติ' })

    const { body } = await encryptWebPush({
      payload,
      uaPublicKey: uaPublic,
      authSecret,
    })

    expect(body.length).toBe(16 + 4 + 1 + 65 + utf8(payload).length + 1 + 16)

    const opened = await decryptBody(body, uaPair.privateKey, uaPublic, authSecret)
    expect(opened.text).toBe(payload)
    expect(opened.delimiter).toBe(0x02)
    expect(opened.idLength).toBe(65)
    expect(opened.recordSize).toBe(4096)
  })

  it('rejects a bad user agent key or auth secret', async () => {
    const uaPair = await ephemeralPair()
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaPair.publicKey))

    await expect(
      encryptWebPush({ payload: 'x', uaPublicKey: uaPublic.slice(0, 64), authSecret: new Uint8Array(16) })
    ).rejects.toThrow()
    await expect(
      encryptWebPush({ payload: 'x', uaPublicKey: uaPublic, authSecret: new Uint8Array(15) })
    ).rejects.toThrow()
  })
})
