import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

describe('public/_headers', () => {
  it('sends the baseline security headers on every path', () => {
    for (const name of [
      'X-Content-Type-Options: nosniff',
      'X-Frame-Options: DENY',
      'Strict-Transport-Security:',
      'Referrer-Policy:',
      'Permissions-Policy:',
    ]) {
      expect(headers).toContain(name)
    }
  })

  it('has a CSP with no inline or eval script and no framing', () => {
    const csp = headers.match(/Content-Security-Policy: (.+)/)[1]
    expect(csp).toMatch(/script-src 'self';/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('caches fingerprinted assets for a year and never the service worker', () => {
    expect(headers).toMatch(/\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/)
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/)
  })
})
