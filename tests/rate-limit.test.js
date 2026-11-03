import { describe, expect, it } from 'vitest'
import { createFixedWindowLimiter } from '../server/rate-limit.js'

function makeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    advance: (ms) => {
      time += ms
    },
  }
}

describe('createFixedWindowLimiter', () => {
  it('allows requests up to the limit', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({ limit: 3, windowMs: 1000, now: clock.now })

    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(true)
  })

  it('blocks the request after the limit', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({ limit: 3, windowMs: 1000, now: clock.now })

    allow('a')
    allow('a')
    allow('a')

    expect(allow('a')).toBe(false)
    expect(allow('a')).toBe(false)
  })

  it('resets the count in a new window', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({ limit: 2, windowMs: 1000, now: clock.now })

    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(false)

    clock.advance(1000)

    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(false)
  })

  it('keeps separate keys independent', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({ limit: 1, windowMs: 1000, now: clock.now })

    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(false)
    expect(allow('b')).toBe(true)
    expect(allow('b')).toBe(false)
  })

  it('caps the number of stored entries by dropping the oldest', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({
      limit: 1,
      windowMs: 60000,
      now: clock.now,
      maxEntries: 2,
    })

    expect(allow('k1')).toBe(true)
    expect(allow('k1')).toBe(false)
    expect(allow('k2')).toBe(true)
    expect(allow('k3')).toBe(true)

    // k1 was evicted when k3 was added, so its window starts over.
    expect(allow('k1')).toBe(true)
  })

  it('allows the submit limit of 300 requests and blocks the 301st', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({
      limit: 300,
      windowMs: 10 * 60 * 1000,
      now: clock.now,
    })

    for (let index = 0; index < 300; index += 1) {
      expect(allow('submit|ip')).toBe(true)
    }

    expect(allow('submit|ip')).toBe(false)
  })

  it('stays bounded when many distinct keys arrive', () => {
    const clock = makeClock()
    const allow = createFixedWindowLimiter({
      limit: 2,
      windowMs: 60000,
      now: clock.now,
      maxEntries: 5,
    })

    for (let index = 0; index < 500; index += 1) {
      clock.advance(1)
      expect(allow(`ip-${index}`)).toBe(true)
    }

    expect(allow('ip-499')).toBe(true)
    expect(allow('ip-499')).toBe(false)
  })
})
