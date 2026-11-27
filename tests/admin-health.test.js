import { describe, expect, it } from 'vitest'

import {
  HEALTH_FIGURES,
  HEALTH_LEVELS,
  HEALTH_QUEUES,
  queueLevel,
  readHealth,
} from '../src/lib/admin-health.js'
import { readSource } from './helpers/read-source.js'

const queue = (over = {}) => ({ pending: 0, sending: 0, overdue: 0, failed24h: 0, lastSentAt: null, ...over })
const reply = (push = queue(), email = queue()) => ({
  ok: true,
  checkedAt: '2026-11-27T05:00:00.000Z',
  queues: { push, email },
})

describe('queue level', () => {
  it('is ok with nothing late or failed', () => {
    expect(queueLevel(queue({ pending: 5, sending: 2 }))).toBe('ok')
  })

  it('is late when something is overdue, and failed beats late', () => {
    expect(queueLevel(queue({ overdue: 1 }))).toBe('late')
    expect(queueLevel(queue({ overdue: 4, failed24h: 1 }))).toBe('failed')
    expect(queueLevel(null)).toBeNull()
  })

  it('has wording and an icon for every level', () => {
    for (const level of ['ok', 'late', 'failed']) {
      expect(HEALTH_LEVELS[level].label.length).toBeGreaterThan(0)
      expect(HEALTH_LEVELS[level].icon.length).toBeGreaterThan(0)
    }
  })
})

describe('reading a reply', () => {
  it('reads both queues', () => {
    const health = readHealth(reply(queue({ pending: 3 }), queue({ lastSentAt: '2026-11-27T04:00:00Z' })))
    expect(health.queues.push.pending).toBe(3)
    expect(health.queues.email.lastSentAt).toBe('2026-11-27T04:00:00Z')
    expect(Object.keys(health.queues)).toEqual(HEALTH_QUEUES.map((meta) => meta.key))
  })

  it('returns null rather than zeros for a bad reply', () => {
    expect(readHealth(null)).toBeNull()
    expect(readHealth({ ok: false })).toBeNull()
    expect(readHealth({ ...reply(), queues: { push: queue() } })).toBeNull()
    expect(readHealth(reply(queue({ pending: -1 })))).toBeNull()
    expect(readHealth(reply(queue({ overdue: '2' })))).toBeNull()
  })

  it('shows four figures per queue', () => {
    expect(HEALTH_FIGURES.map((figure) => figure.key)).toEqual(['pending', 'sending', 'overdue', 'failed24h'])
  })
})

describe('health page source', () => {
  const PAGE = readSource('src/pages/AdminHealthPage.vue')
  const STYLE = PAGE.slice(PAGE.indexOf('<style'))
  const channel = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  it('keeps the status pairs at the documented fills and AA', () => {
    for (const [fill, ink] of [['#e6f4ec', '#1c6b3f'], ['#fff2df', '#8a4b06'], ['#fdecec', '#a01b1b']]) {
      expect(STYLE).toContain(fill)
      expect(STYLE).toContain(ink)
      expect(ratio(ink, fill), ink).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio('#475569', '#ffffff')).toBeCloseTo(7.58, 1)
  })

  it('follows the touch, hover and motion rules', () => {
    expect(STYLE.indexOf(':hover')).toBeGreaterThan(STYLE.indexOf('@media (hover: hover) and (pointer: fine)'))
    expect(STYLE).toContain('min-height: var(--tap-target)')
    expect(STYLE).toContain('@media (prefers-reduced-motion: reduce)')
    expect(STYLE).not.toMatch(/transition:[^;]*(width|height|top|left|margin|padding)/)
  })

  it('shows state with an icon and words, not colour alone', () => {
    expect(PAGE).toContain('HEALTH_LEVELS[queueLevel(')
    expect(PAGE).toContain('status-icon')
  })
})
