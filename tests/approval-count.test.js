// The pending-approval badge: the decision path lowers the shared number, the
// other tabs of this browser hear it over a BroadcastChannel, and a light ETag
// read picks up new requests. These tests cover the pure rules and the wiring.
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  APPROVAL_POLL_MS,
  approvalCount,
  clearApprovalCount,
  createApprovalChannel,
  createApprovalPoll,
  decrementApprovalCount,
  normalizeApprovalCount,
  retainApprovalCountSync,
  setApprovalCount,
} from '../src/lib/approval-count.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const COUNT_LIB = read('src/lib/approval-count.js')
const APPROVALS_PAGE = read('src/pages/LeaveApprovalsPage.vue')
const APP_LAYOUT = read('src/components/AppLayout.vue')
const CONTROLLER_NAV = read('src/components/ControllerNav.vue')
const LEAVE_HOME = read('src/pages/LeaveHomePage.vue')
const SHARED_DATA = read('src/lib/shared-data.js')
const DATA_CACHE = read('src/lib/data-cache.js')

/** A BroadcastChannel stand-in that records and can deliver messages. */
function fakeChannels() {
  const created = []
  class Channel {
    constructor(name) {
      this.name = name
      this.posted = []
      this.onmessage = null
      this.closed = false
      created.push(this)
    }

    postMessage(message) {
      this.posted.push(message)
    }

    deliver(message) {
      this.onmessage?.({ data: message })
    }

    close() {
      this.closed = true
    }
  }
  return { Channel, created }
}

function fakePage(state = 'visible') {
  const listeners = { doc: {}, win: {} }
  const page = {
    state,
    doc: {
      get visibilityState() {
        return page.state
      },
      addEventListener(type, handler) {
        ;(listeners.doc[type] ??= []).push(handler)
      },
      removeEventListener(type, handler) {
        listeners.doc[type] = (listeners.doc[type] ?? []).filter((item) => item !== handler)
      },
    },
    win: {
      addEventListener(type, handler) {
        ;(listeners.win[type] ??= []).push(handler)
      },
      removeEventListener(type, handler) {
        listeners.win[type] = (listeners.win[type] ?? []).filter((item) => item !== handler)
      },
    },
    set(next) {
      page.state = next
      for (const handler of listeners.doc.visibilitychange ?? []) handler()
    },
    focus() {
      for (const handler of listeners.win.focus ?? []) handler()
    },
    listenerCount(type) {
      return (listeners.doc[type] ?? []).length + (listeners.win[type] ?? []).length
    },
  }
  return page
}

function fakeTimer() {
  const jobs = new Map()
  let nextId = 0
  return {
    schedule(callback) {
      jobs.set((nextId += 1), callback)
      return nextId
    },
    cancel(handle) {
      jobs.delete(handle)
    },
    get size() {
      return jobs.size
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the shared number', () => {
  it('drops by one per decision, never below zero', () => {
    expect(decrementApprovalCount(3)).toBe(2)
    expect(decrementApprovalCount(1)).toBe(0)
    expect(decrementApprovalCount(0)).toBe(0)
    expect(decrementApprovalCount(-4)).toBe(0)
    expect(decrementApprovalCount('2')).toBe(1)
  })

  it('treats anything unusable as zero', () => {
    expect(normalizeApprovalCount(undefined)).toBe(0)
    expect(normalizeApprovalCount(null)).toBe(0)
    expect(normalizeApprovalCount('abc')).toBe(0)
    expect(normalizeApprovalCount(2.9)).toBe(2)
    expect(normalizeApprovalCount('4')).toBe(4)
  })

  it('is one value every reader sees, and is cleared on logout', () => {
    clearApprovalCount()
    setApprovalCount(5)
    expect(approvalCount.value).toBe(5)
    setApprovalCount(-1)
    expect(approvalCount.value).toBe(0)

    expect(DATA_CACHE).toContain('clearApprovalCount()')
    expect(DATA_CACHE).toContain("from './approval-count.js'")
  })
})

describe('a decision', () => {
  it('lowers the shared count once and tells the other tabs', () => {
    const { Channel, created } = fakeChannels()
    clearApprovalCount()
    setApprovalCount(4)

    // The real page prints the shared value and broadcasts it; the wiring below
    // is what the source check pins down.
    expect(SHARED_DATA).toContain('export function applyApprovalDecision(requestId)')
    expect(SHARED_DATA).toContain('decrementApprovalCount(approvalCount.value)')
    expect(SHARED_DATA).toContain('publishApprovalCount(next)')
    expect(SHARED_DATA).toContain('patchCached(DATA_KEYS.approvals')

    const channel = createApprovalChannel({ Channel, tabId: 'tab-a' })
    channel.publish(decrementApprovalCount(approvalCount.value))
    expect(created.at(-1).posted).toEqual([{ tabId: 'tab-a', count: 3 }])
  })

  it('never touches the count on a failed decision', () => {
    // The page returns on any non-2xx before the local update: the shared
    // number and the cache stay exactly as they were.
    const block = APPROVALS_PAGE.slice(
      APPROVALS_PAGE.indexOf('async function decide('),
      APPROVALS_PAGE.indexOf('onMounted(load)')
    )
    const failure = block.indexOf('actionError.value = typeof data.message')
    const localUpdate = block.indexOf('applyApprovalDecision(item.id)')

    expect(failure).toBeGreaterThan(-1)
    expect(localUpdate).toBeGreaterThan(failure)
    expect(block).toContain('applyApprovalDecision(item.id)')
    expect(block).toContain('invalidateDecidedLeave()')
    expect(block).not.toContain('invalidateLeaveRequests()')
  })
})

describe('the cross-tab channel', () => {
  it('applies another tab and ignores its own id', () => {
    const { Channel, created } = fakeChannels()
    const seen = []
    createApprovalChannel({ Channel, tabId: 'tab-a', onMessage: (count) => seen.push(count) })
    const instance = created.at(-1)

    instance.deliver({ tabId: 'tab-b', count: 2 })
    instance.deliver({ tabId: 'tab-a', count: 0 })
    instance.deliver({ tabId: 'tab-b', count: 'nope' })
    instance.deliver({ tabId: 'tab-b', count: -3 })
    instance.deliver(null)

    expect(seen).toEqual([2, 0])
  })

  it('sends numbers and a tab id only', () => {
    const { Channel, created } = fakeChannels()
    const channel = createApprovalChannel({ Channel, tabId: 'tab-a' })

    channel.publish(7)

    const message = created.at(-1).posted.at(-1)
    expect(Object.keys(message).sort()).toEqual(['count', 'tabId'])
    expect(typeof message.count).toBe('number')
    expect(JSON.stringify(message)).not.toContain('request')
  })

  it('degrades to a no-op without BroadcastChannel', () => {
    const channel = createApprovalChannel({ Channel: null })

    expect(channel.supported).toBe(false)
    expect(() => channel.publish(1)).not.toThrow()
    expect(() => channel.close()).not.toThrow()
  })
})

describe('the incoming-request check', () => {
  it('starts only while visible and stops when hidden', async () => {
    const page = fakePage('visible')
    const timer = fakeTimer()
    const checks = []
    const poll = createApprovalPoll({
      check: () => checks.push('check'),
      doc: page.doc,
      win: page.win,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    poll.start()
    await flush()
    expect(checks).toHaveLength(1)
    expect(timer.size).toBe(1)

    page.set('hidden')
    expect(timer.size).toBe(0)
    expect(checks).toHaveLength(1)

    page.set('visible')
    await flush()
    expect(checks).toHaveLength(2)
    expect(timer.size).toBe(1)

    poll.stop()
    expect(timer.size).toBe(0)
    expect(page.listenerCount('visibilitychange')).toBe(0)
    expect(page.listenerCount('focus')).toBe(0)
  })

  it('checks on focus, and belongs to the page, not a component', async () => {
    const page = fakePage('visible')
    const timer = fakeTimer()
    const checks = []
    const poll = createApprovalPoll({
      check: () => checks.push('check'),
      doc: page.doc,
      win: page.win,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    poll.start()
    await flush()
    checks.length = 0
    page.focus()
    expect(checks).toHaveLength(1)
    poll.stop()

    // The shells retain the same page-level check.
    expect(APP_LAYOUT).toContain('retainApprovalCountSync()')
    expect(CONTROLLER_NAV).toContain('retainApprovalCountSync()')
    expect(LEAVE_HOME).not.toContain('setInterval')
    expect(COUNT_LIB).toContain('APPROVAL_POLL_MS = 120_000')
  })

  it('keeps a single shared timer for every component that asks', () => {
    const first = { start: vi.fn(), stop: vi.fn() }
    const second = { start: vi.fn(), stop: vi.fn() }
    const factories = [() => first, () => second]

    const releaseA = retainApprovalCountSync(factories[0])
    const releaseB = retainApprovalCountSync(factories[1])

    expect(first.start).toHaveBeenCalledTimes(1)
    expect(second.start).not.toHaveBeenCalled()

    releaseA()
    expect(first.stop).not.toHaveBeenCalled()
    releaseB()
    expect(first.stop).toHaveBeenCalledTimes(1)
  })

  it('reads the count endpoint with the last ETag and ignores a 304', async () => {
    expect(COUNT_LIB).toContain("APPROVAL_COUNT_URL = '/api/leave/approvals/count'")
    expect(COUNT_LIB).toContain("'If-None-Match': lastEtag")
    expect(COUNT_LIB).toContain('if (response.status === 304')
    await flush()
  })
})

describe('source checks', () => {
  const sources = {
    'approval-count': COUNT_LIB,
    'approvals page': APPROVALS_PAGE,
    'app layout': APP_LAYOUT,
    'controller nav': CONTROLLER_NAV,
    'leave home': LEAVE_HOME,
    'shared data': SHARED_DATA,
    'data cache': DATA_CACHE,
  }

  it('uses no socket and no server-sent events', () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source.includes('WebSocket'), name).toBe(false)
      expect(source.includes('EventSource'), name).toBe(false)
    }
  })

  it('guards BroadcastChannel with a typeof check', () => {
    expect(COUNT_LIB).toContain("if (typeof Channel !== 'function')")
    expect(COUNT_LIB).toContain('BroadcastChannel')
  })

  it('only one place creates the interval', () => {
    const timers = [COUNT_LIB, APPROVALS_PAGE, APP_LAYOUT, CONTROLLER_NAV, LEAVE_HOME].filter(
      (source) => source.includes('setInterval(')
    )
    expect(timers).toHaveLength(1)
    expect(timers[0]).toBe(COUNT_LIB)
    expect(APPROVAL_POLL_MS).toBe(120_000)
  })
})
