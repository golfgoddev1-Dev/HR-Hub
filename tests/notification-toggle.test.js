// The switch's coalescing, rollback and storage rules. The helper takes its
// timers and storage as arguments, so the 400ms debounce and the 10 second
// safety timeout are tested without a browser.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_DEBOUNCE_MS,
  NOTIFICATION_TIMEOUT_MS,
  NOTIFICATION_TOGGLE_MESSAGES,
  clearNotificationState,
  createNotificationToggle,
  notificationStateKey,
  readNotificationState,
  writeNotificationState,
} from '../src/lib/notification-toggle.js'

const TOGGLE = readFileSync(
  new URL('../src/components/PushToggle.vue', import.meta.url),
  'utf8'
)
const LIB = readFileSync(
  new URL('../src/lib/notification-toggle.js', import.meta.url),
  'utf8'
)
const DATA_CACHE = readFileSync(new URL('../src/lib/data-cache.js', import.meta.url), 'utf8')
const LOGOUT = readFileSync(new URL('../src/lib/logout.js', import.meta.url), 'utf8')

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key(index) {
      return [...map.keys()][index] ?? null
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

/** A manual clock: nothing runs until the test advances it. */
function clock() {
  let now = 0
  let nextId = 0
  const jobs = []

  function due() {
    return jobs.filter((job) => job.at <= now).sort((left, right) => left.at - right.at)
  }

  return {
    schedule(callback, delay) {
      jobs.push({ id: (nextId += 1), at: now + Math.max(0, delay), callback })
      return nextId
    },
    cancel(handle) {
      const index = jobs.findIndex((job) => job.id === handle)
      if (index !== -1) jobs.splice(index, 1)
    },
    advance(ms) {
      now += ms
      let ready = due()
      while (ready.length > 0) {
        const job = ready[0]
        jobs.splice(jobs.indexOf(job), 1)
        job.callback()
        ready = due()
      }
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function build(sync, timers, extra = {}) {
  const states = []
  const notices = []
  const confirmed = []
  const toggle = createNotificationToggle({
    sync,
    onState: (value) => states.push(value),
    onNotice: (text) => notices.push(text),
    onConfirm: (value) => confirmed.push(value),
    schedule: timers.schedule,
    cancel: timers.cancel,
    ...extra,
  })
  return { toggle, states, notices, confirmed }
}

describe('optimistic toggle', () => {
  it('flips before the debounce and sends exactly one sync for one tap', async () => {
    const timers = clock()
    const calls = []
    const { toggle, states } = build(async (value) => {
      calls.push(value)
      return { ok: true }
    }, timers)

    toggle.seed(false)
    toggle.request(true)

    expect(states.at(-1)).toBe(true)
    expect(calls).toEqual([])

    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()

    expect(calls).toEqual([true])
    expect(states.at(-1)).toBe(true)
  })

  it('sends at most one more sync for taps during a sync, with the final value', async () => {
    const timers = clock()
    const calls = []
    let release = null
    const { toggle, states } = build((value) => {
      calls.push(value)
      if (value === true) return new Promise((resolve) => { release = resolve })
      return Promise.resolve({ ok: true })
    }, timers)

    toggle.seed(false)
    toggle.request(true)
    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()
    expect(calls).toEqual([true])

    // A burst while the first request is still open.
    toggle.request(false)
    toggle.request(true)
    toggle.request(false)
    expect(states.at(-1)).toBe(false)

    release({ ok: true })
    await flush()
    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()

    expect(calls).toEqual([true, false])
    expect(states.at(-1)).toBe(false)
  })

  it('stores the value only once the server accepted it', async () => {
    const timers = clock()
    const { toggle, confirmed } = build(async () => ({ ok: true }), timers)

    toggle.seed(false)
    toggle.request(true)
    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()

    expect(confirmed).toEqual([true])
  })
})

describe('failure and timeout', () => {
  it('rolls back to the last confirmed value when the sync fails', async () => {
    const timers = clock()
    const { toggle, states, notices } = build(async () => ({ ok: false, reason: 'server' }), timers)

    toggle.seed(true)
    toggle.request(false)
    expect(states.at(-1)).toBe(false)

    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()

    expect(states.at(-1)).toBe(true)
    expect(notices).toEqual([NOTIFICATION_TOGGLE_MESSAGES.failed])
  })

  it('returns to OFF with the browser message when permission is denied', async () => {
    const timers = clock()
    const { toggle, states, notices } = build(async () => ({ ok: false, reason: 'permission' }), timers)

    toggle.seed(false)
    toggle.request(true)
    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()

    expect(states.at(-1)).toBe(false)
    expect(notices).toEqual([NOTIFICATION_TOGGLE_MESSAGES.denied])
  })

  it('rolls back after the 10 second safety timeout', async () => {
    const timers = clock()
    const { toggle, states, notices } = build(() => new Promise(() => {}), timers)

    toggle.seed(false)
    toggle.request(true)
    timers.advance(NOTIFICATION_DEBOUNCE_MS)
    await flush()
    expect(states.at(-1)).toBe(true)

    timers.advance(NOTIFICATION_TIMEOUT_MS)
    await flush()

    expect(states.at(-1)).toBe(false)
    expect(notices).toEqual([NOTIFICATION_TOGGLE_MESSAGES.failed])
  })
})

describe('server verification', () => {
  it('adopts a server value only when nothing is pending', async () => {
    const timers = clock()
    const { toggle, confirmed } = build(() => new Promise(() => {}), timers)

    toggle.seed(false)
    // Idle: the server value wins, and an identical one changes nothing.
    expect(toggle.adopt(true)).toBe(true)
    expect(toggle.adopt(true)).toBe(false)

    // A pending intent is never overwritten by a late server read.
    toggle.request(false)
    expect(toggle.adopt(true)).toBe(false)
    expect(confirmed).toEqual([true])
  })
})

describe('stored state', () => {
  it('keys the value by employee and ignores another account', () => {
    const store = memoryStorage({ [notificationStateKey('emp-a')]: '1' })

    expect(notificationStateKey('emp-a')).toContain('emp-a')
    expect(readNotificationState('emp-b', store)).toBeNull()
    expect(readNotificationState('emp-a', store)).toBe(true)
    expect(readNotificationState('', store)).toBeNull()
  })

  it('keeps only a boolean and clears every account on logout', () => {
    const store = memoryStorage()

    writeNotificationState('emp-a', true, store)
    writeNotificationState('emp-b', false, store)
    expect(store.getItem(notificationStateKey('emp-a'))).toBe('1')
    expect(store.getItem(notificationStateKey('emp-b'))).toBe('0')

    clearNotificationState(store)
    expect(readNotificationState('emp-a', store)).toBeNull()
    expect(readNotificationState('emp-b', store)).toBeNull()
  })
})

describe('switch component', () => {
  it('flips the switch before any await in the tap handler', () => {
    const start = TOGGLE.indexOf('function togglePush()')
    const end = TOGGLE.indexOf('async function accountId()')
    const block = TOGGLE.slice(start, end)

    expect(block).not.toContain('await')
    expect(block.indexOf('toggle.request(next)')).toBeGreaterThan(-1)
    expect(block.indexOf('toggle.request(next)')).toBeLessThan(
      block.indexOf('permissionTask = requestPermissionNow()')
    )
  })

  it('requests permission inside the tap handler only', () => {
    expect((TOGGLE.match(/Notification\.requestPermission/g) ?? []).length).toBe(1)

    const start = TOGGLE.indexOf('function requestPermissionNow()')
    const end = TOGGLE.indexOf('function togglePush()')
    expect(TOGGLE.slice(start, end)).toContain('Notification.requestPermission()')
    expect(TOGGLE.slice(end)).toContain('permissionTask = requestPermissionNow()')
  })

  it('wraps every storage access in try/catch', () => {
    expect(LIB).toContain('storage.getItem(')
    expect(LIB).toContain('storage.setItem(')
    expect((LIB.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(TOGGLE).not.toContain('sessionStorage')
    expect(TOGGLE).not.toContain('localStorage')
  })

  it('clears the stored key through the logout and login path', () => {
    expect(DATA_CACHE).toContain("from './notification-toggle.js'")
    expect(DATA_CACHE).toContain('clearNotificationState()')
    expect(LOGOUT).toContain('clearAll()')
  })

  it('paints the last known value and confirms it in the background', () => {
    expect(TOGGLE).toContain('readNotificationState(employeeId)')
    expect(TOGGLE).toContain('toggle.seed(')
    expect(TOGGLE).toContain('void verify()')
    expect(TOGGLE).toContain('const STATUS_TTL_MS = 60_000')
    expect(TOGGLE).toContain('getCached(DATA_KEYS.notificationStatus, loaders.notificationStatus')
    expect(TOGGLE).toContain('NOTIFICATION_TOGGLE_MESSAGES.updated')
  })

  it('never blocks the tap on a spinner', () => {
    expect(TOGGLE).not.toContain('busy')
    expect(TOGGLE).toContain(':disabled="!supported || iosNeedsInstall"')
  })
})
