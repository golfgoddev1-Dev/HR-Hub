// VAPID (RFC 8292): the JWT must be ES256, scoped to the push service origin,
// short-lived, signed by the configured private key, and never carry that key.
import { describe, expect, it } from 'vitest'

import { base64UrlToBytes, bytesToBase64Url, utf8 } from '../worker/src/push/base64url.js'
import {
  VAPID_MAX_LIFETIME_SECONDS,
  VAPID_TOKEN_LIFETIME_SECONDS,
  buildVapidAuthorization,
  vapidClaims,
} from '../worker/src/push/vapid.js'

if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto')
  globalThis.crypto = webcrypto
}

// A published P-256 test pair from RFC 8291 Appendix A, used here only as a
// stand-in VAPID key. Not a real credential.
const PUBLIC_KEY = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'
const PRIVATE_KEY = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
const SUBJECT = 'mailto:hr@example.test'
const ENDPOINT = 'https://push.example.net/send/abc'
const NOW = new Date('2026-11-03T00:00:00.000Z')

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)))
}

async function verify(token) {
  const [headerPart, payloadPart, signaturePart] = token.split('.')
  const publicBytes = base64UrlToBytes(PUBLIC_KEY)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64UrlToBytes(signaturePart),
    utf8(`${headerPart}.${payloadPart}`)
  )
}

describe('vapidClaims', () => {
  it('uses the push service origin as aud and stays inside 24 hours', () => {
    const claims = vapidClaims({ endpoint: ENDPOINT, subject: SUBJECT, now: NOW })
    expect(claims.aud).toBe('https://push.example.net')
    expect(claims.sub).toBe(SUBJECT)
    expect(claims.exp).toBe(Math.floor(NOW.getTime() / 1000) + VAPID_TOKEN_LIFETIME_SECONDS)

    const capped = vapidClaims({
      endpoint: ENDPOINT,
      subject: SUBJECT,
      now: NOW,
      lifetimeSeconds: 60 * 60 * 48,
    })
    expect(capped.exp - Math.floor(NOW.getTime() / 1000)).toBe(VAPID_MAX_LIFETIME_SECONDS)
  })

  it('refuses a non-https endpoint or an empty subject', () => {
    expect(() => vapidClaims({ endpoint: 'http://push.example.net/x', subject: SUBJECT, now: NOW })).toThrow()
    expect(() => vapidClaims({ endpoint: ENDPOINT, subject: '  ', now: NOW })).toThrow()
  })
})

describe('buildVapidAuthorization', () => {
  it('builds an ES256 JWT with the public key as k and a valid signature', async () => {
    const result = await buildVapidAuthorization({
      endpoint: ENDPOINT,
      subject: SUBJECT,
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      now: NOW,
    })

    expect(result.authorization.startsWith('vapid t=')).toBe(true)
    expect(result.authorization.endsWith(`k=${PUBLIC_KEY}`)).toBe(true)
    expect(result.authorization.includes(PRIVATE_KEY)).toBe(false)

    const [headerPart, payloadPart] = result.token.split('.')
    expect(decodePart(headerPart)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decodePart(payloadPart)).toEqual({
      aud: 'https://push.example.net',
      exp: Math.floor(NOW.getTime() / 1000) + VAPID_TOKEN_LIFETIME_SECONDS,
      sub: SUBJECT,
    })

    expect(await verify(result.token)).toBe(true)
  })

  it('rejects malformed keys without echoing them', async () => {
    await expect(
      buildVapidAuthorization({
        endpoint: ENDPOINT,
        subject: SUBJECT,
        publicKey: 'not-a-key',
        privateKey: PRIVATE_KEY,
        now: NOW,
      })
    ).rejects.toThrow('invalid vapid public key')

    await expect(
      buildVapidAuthorization({
        endpoint: ENDPOINT,
        subject: SUBJECT,
        publicKey: PUBLIC_KEY,
        privateKey: 'short',
        now: NOW,
      })
    ).rejects.toThrow('invalid vapid private key')
  })
})
