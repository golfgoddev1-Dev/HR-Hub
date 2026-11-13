// Static checks for the mandatory PIN change wiring: the route, the guard and
// the page that talks to /api/auth/change-pin.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const ROUTER = readSource(new URL('../src/router.js', import.meta.url))
const PAGE = readSource(new URL('../src/pages/ChangePinPage.vue', import.meta.url))

describe('mandatory PIN change', () => {
  it('declares the change page as an authenticated route', () => {
    expect(ROUTER).toContain("path: '/change-pin'")
    expect(ROUTER).toContain('ChangePinPage')
    expect(ROUTER).toContain("'./pages/ChangePinPage.vue'")
  })

  it('sends a flagged session to the change page before anything else', () => {
    expect(ROUTER).toContain('session.mustChangePin === true')
    expect(ROUTER).toContain("return '/change-pin'")
  })

  it('posts the new PIN without the old one and never stores it', () => {
    expect(PAGE).toContain('/api/auth/change-pin')
    expect(PAGE).toContain('pinConfirm')
    expect(PAGE).not.toContain('nationalId')
    expect(PAGE).not.toContain('localStorage')
    expect(PAGE).not.toContain('sessionStorage')
    expect(PAGE).toContain('window.location.assign')
  })
})
