// The installed icon badge: a number the page paints fire-and-forget, a clear
// at zero, and a service worker path that reads the count from the payload and
// tolerates a browser without the Badging API. Nothing here may prompt.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  badgeValue,
  clearBadge,
  setBadge,
  setBadgeAllowed,
} from '../src/lib/app-badge.js'
import {
  approvalCount,
  clearApprovalCount,
  setApprovalCount,
} from '../src/lib/approval-count.js'
import { applyApprovalDecision } from '../src/lib/shared-data.js'

import { readSource } from './helpers/read-source.js'

const read = (path) => readSource(new URL(`../${path}`, import.meta.url))

const SW = read('public/sw.js')
const BADGE_LIB = read('src/lib/app-badge.js')
const DATA_CACHE = read('src/lib/data-cache.js')
const LOGOUT = read('src/lib/logout.js')
const APP_LAYOUT = read('src/components/AppLayout.vue')
const CONTROLLER_NAV = read('src/components/ControllerNav.vue')

function fakeBadgeApi() {
  const calls = []
  vi.stubGlobal('navigator', {
    setAppBadge(count) {
      calls.push(['set', count])
    },
    clearAppBadge() {
      calls.push(['clear'])
    },
  })
  return calls
}

beforeEach(() => {
  vi.unstubAllGlobals()
  clearApprovalCount()
  setBadgeAllowed(true)
})

describe('the page helper', () => {
  it('does nothing when the API is missing and never throws', () => {
    vi.stubGlobal('navigator', {})
    expect(setBadge(3)).toBe(false)
    expect(clearBadge()).toBe(false)
    expect(badgeValue()).toBe(0)

    vi.stubGlobal('navigator', undefined)
    expect(() => setBadge(3)).not.toThrow()
    expect(() => clearBadge()).not.toThrow()
  })

  it('survives a refusing API', () => {
    vi.stubGlobal('navigator', {
      setAppBadge() {
        throw new Error('blocked')
      },
      clearAppBadge() {
        throw new Error('blocked')
      },
    })

    expect(setBadge(1)).toBe(false)
    expect(clearBadge()).toBe(false)
  })

  it('sets the number, and zero clears it', () => {
    const calls = fakeBadgeApi()

    expect(setBadge(2)).toBe(true)
    expect(calls).toEqual([['set', 2]])
    expect(badgeValue()).toBe(2)

    expect(setBadge(0)).toBe(true)
    expect(calls.at(-1)).toEqual(['clear'])
    expect(badgeValue()).toBe(0)

    expect(clearBadge()).toBe(true)
    expect(calls.filter(([kind]) => kind === 'clear')).toHaveLength(2)
  })

  it('is disabled for a non-approver or an account with notifications off', () => {
    const calls = fakeBadgeApi()
    setApprovalCount(2)

    setBadgeAllowed(false)
    expect(calls.at(-1)).toEqual(['clear'])

    setApprovalCount(5)
    expect(calls.filter(([kind]) => kind === 'set')).toHaveLength(1)
  })
})

describe('a decision', () => {
  it('drops the badge by one and never below zero', () => {
    const calls = fakeBadgeApi()
    clearApprovalCount()
    setApprovalCount(2)

    expect(calls).toEqual([['set', 2]])

    applyApprovalDecision('request-1')
    expect(approvalCount.value).toBe(1)
    expect(calls.at(-1)).toEqual(['set', 1])

    applyApprovalDecision('request-2')
    expect(approvalCount.value).toBe(0)
    expect(calls.at(-1)).toEqual(['clear'])

    applyApprovalDecision('request-3')
    expect(approvalCount.value).toBe(0)
    expect(calls.filter(([kind]) => kind === 'set')).toEqual([
      ['set', 2],
      ['set', 1],
    ])
  })

  it('is not cleared by logout', () => {
    // The badge belongs to the approver's device, so the logout path only drops
    // the in-page number; clearing stays with the next sign-in.
    expect(DATA_CACHE).not.toContain('clearBadge')
    expect(LOGOUT).not.toContain('clearBadge')
    expect(DATA_CACHE).toContain('clearApprovalCount()')
  })
})

describe('the shells', () => {
  it('grant the badge only to an active approver with notifications on', () => {
    for (const source of [APP_LAYOUT, CONTROLLER_NAV]) {
      expect(source).toContain('setBadgeAllowed(false)')
      expect(source).toContain('setBadgeAllowed(await notificationSettingEnabled())')
    }
  })
})

describe('the service worker', () => {
  it('reads count, validates it and wraps the badge call', () => {
    expect(SW).toContain('payload.count')
    expect(SW).toContain('Number.isInteger(value)')
    expect(SW).toContain('value >= 0')
    expect(SW).toContain('setAppBadge(count)')
    expect(SW).toContain('clearAppBadge()')

    const block = SW.slice(SW.indexOf('function applyBadge'), SW.indexOf('self.addEventListener("push"'))
    expect(block.indexOf('try {')).toBeGreaterThan(-1)
    expect(block.indexOf('catch')).toBeGreaterThan(block.indexOf('try {'))
    // count 0 is the clear signal, not a zero badge.
    expect(block).toContain('count === 0')
  })

  it('never adds a permission request', () => {
    for (const source of [SW, BADGE_LIB, APP_LAYOUT, CONTROLLER_NAV]) {
      expect(source).not.toContain('requestPermission')
    }
  })
})
