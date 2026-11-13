// Notification route keys and the login `to` allowlist. Payloads never carry a
// path or URL; these two values are the complete set of accepted destinations.

import { describe, expect, it } from 'vitest'

import {
  loginTargetForPath,
  pathForNotificationRoute,
  safeLoginTarget,
} from '../src/lib/notification-routes.js'

import { readSource } from './helpers/read-source.js'

const SW = readSource(new URL('../public/sw.js', import.meta.url))
const ROUTER = readSource(new URL('../src/router.js', import.meta.url))
const LOGIN = readSource(new URL('../src/pages/LoginPage.vue', import.meta.url))

describe('notification route keys', () => {
  it('maps the two allowed keys and sends everything else to the root', () => {
    expect(pathForNotificationRoute('approvals')).toBe('/leave/approvals')
    expect(pathForNotificationRoute('leave')).toBe('/leave')
    expect(pathForNotificationRoute('admin')).toBe('/')
    expect(pathForNotificationRoute('/leave/approvals')).toBe('/')
    expect(pathForNotificationRoute(undefined)).toBe('/')
  })

  it('keeps the service-worker map identical to the frontend map', () => {
    expect(SW).toContain('approvals: "/leave/approvals"')
    expect(SW).toContain('leave: "/leave"')
    expect(SW).toContain('payload.route')
    expect(SW).not.toContain('payload.url')
    expect(SW).not.toContain('safeUrl')
    expect(SW).not.toMatch(/data:\s*\{\s*url/)
  })
})

describe('login to validation', () => {
  it('accepts only the allowlisted same-site paths', () => {
    expect(safeLoginTarget('/leave/approvals')).toBe('/leave/approvals')
    expect(safeLoginTarget('/leave')).toBe('/leave')
    expect(safeLoginTarget('/leave/approvals?focus=x')).toBe(null)
  })

  it('rejects protocol-relative, absolute and non-allowlisted paths', () => {
    expect(safeLoginTarget('//evil')).toBe(null)
    expect(safeLoginTarget('https://evil')).toBe(null)
    expect(safeLoginTarget('/hr')).toBe(null)
    expect(safeLoginTarget('/leave/../admin')).toBe(null)
    expect(safeLoginTarget('/leave\\evil')).toBe(null)
  })

  it('wires the guard and login page to the same allowlist', () => {
    expect(ROUTER).toContain('loginTargetForPath')
    expect(ROUTER).toContain("path: '/login', query: { to: target }")
    expect(LOGIN).toContain('safeLoginTarget(route.query.to)')
    expect(LOGIN).toContain('const destination')
    expect(LOGIN).toContain('data.mustChangePin === true')
    expect(loginTargetForPath('/leave/approvals')).toBe('/leave/approvals')
    expect(loginTargetForPath('/hr')).toBe(null)
  })
})
