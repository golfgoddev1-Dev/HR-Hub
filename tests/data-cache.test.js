// The in-memory read cache: one loader call per ttl, one shared promise for
// concurrent readers, failures never cached, and the logout/login invalidation
// that the source checks below pin.
import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearAll,
  getCached,
  invalidate,
  invalidatePrefix,
  peekCached,
} from '../src/lib/data-cache.js'
import { DATA_KEYS, loadShared } from '../src/lib/shared-data.js'

const NOW = 1_700_000_000_000

beforeEach(() => {
  clearAll()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  clearAll()
  vi.useRealTimers()
})

function counterLoader(value = 'value') {
  const loader = vi.fn(async () => value)
  return loader
}

describe('getCached', () => {
  it('does not call the loader again within the ttl', async () => {
    const loader = counterLoader()

    await getCached('key', loader, { ttlMs: 1000 })
    vi.setSystemTime(NOW + 999)
    const second = await getCached('key', loader, { ttlMs: 1000 })

    expect(second).toBe('value')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('calls the loader again once the ttl has passed', async () => {
    const loader = vi.fn(async () => {
      return 'value'
    })

    await getCached('key', loader, { ttlMs: 1000 })
    vi.setSystemTime(NOW + 1000)
    await getCached('key', loader, { ttlMs: 1000 })

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent calls for one key', async () => {
    let resolve
    const loader = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )

    const first = getCached('key', loader, { ttlMs: 1000 })
    const second = getCached('key', loader, { ttlMs: 1000 })
    const third = getCached('key', loader, { ttlMs: 1000 })

    await Promise.resolve()
    resolve('shared')

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      'shared',
      'shared',
      'shared',
    ])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure and rethrows it', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('recovered')

    await expect(getCached('key', loader, { ttlMs: 1000 })).rejects.toThrow('offline')
    expect(peekCached('key')).toBeNull()

    await expect(getCached('key', loader, { ttlMs: 1000 })).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous value when a refresh fails', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce('old')
      .mockRejectedValueOnce(new Error('offline'))

    await getCached('key', loader, { ttlMs: 1000 })
    vi.setSystemTime(NOW + 1000)
    await expect(getCached('key', loader, { ttlMs: 1000 })).rejects.toThrow('offline')

    // The stale value is still there for the next paint.
    expect(peekCached('key')?.value).toBe('old')
  })
})

describe('invalidation', () => {
  it('invalidate drops one key', async () => {
    const loader = counterLoader()
    await getCached('a', loader, { ttlMs: 10_000 })
    await getCached('b', loader, { ttlMs: 10_000 })

    invalidate('a')

    expect(peekCached('a')).toBeNull()
    expect(peekCached('b')).not.toBeNull()
  })

  it('invalidatePrefix drops every key that starts with it', async () => {
    const loader = counterLoader()
    await getCached('leave:holidays', loader, { ttlMs: 10_000 })
    await getCached('leave:holidays:2026-01-01:2026-12-31', loader, { ttlMs: 10_000 })
    await getCached('leave:requests:mine', loader, { ttlMs: 10_000 })

    invalidatePrefix('leave:holidays')

    expect(peekCached('leave:holidays')).toBeNull()
    expect(peekCached('leave:holidays:2026-01-01:2026-12-31')).toBeNull()
    expect(peekCached('leave:requests:mine')).not.toBeNull()
  })

  it('clearAll drops everything, including a response that arrives afterwards', async () => {
    const loader = counterLoader()
    await getCached(DATA_KEYS.session, loader, { ttlMs: 10_000 })

    let resolveLate
    const late = getCached('late', () => new Promise((done) => (resolveLate = done)), {
      ttlMs: 10_000,
    })
    await Promise.resolve()

    clearAll()
    resolveLate('after-logout')
    await late

    expect(peekCached(DATA_KEYS.session)).toBeNull()
    expect(peekCached('late')).toBeNull()
  })
})

describe('loadShared across a route change', () => {
  it('loads a shared key once for two pages', async () => {
    const loader = counterLoader({ departments: [] })
    const pageA = []
    const pageB = []

    await loadShared('directory:catalog:/api/hr/directory', loader, {
      ttlMs: 30 * 60_000,
      onData: (data) => pageA.push(data),
    })
    // The user navigates: a different page reads the same key.
    await loadShared('directory:catalog:/api/hr/directory', loader, {
      ttlMs: 30 * 60_000,
      onData: (data) => pageB.push(data),
    })

    expect(loader).toHaveBeenCalledTimes(1)
    expect(pageA).toHaveLength(1)
    expect(pageB).toHaveLength(1)
  })

  it('paints a cached value immediately and refreshes only once stale', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ value: 'first' })
      .mockResolvedValueOnce({ value: 'second' })

    const painted = []
    await loadShared('page', loader, { ttlMs: 60_000, onData: (data) => painted.push(data) })

    const fresh = await loadShared('page', loader, {
      ttlMs: 60_000,
      onData: (data) => painted.push(data),
    })
    expect(fresh.cached).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)

    vi.setSystemTime(NOW + 60_000)
    const stale = await loadShared('page', loader, {
      ttlMs: 60_000,
      onData: (data) => painted.push(data),
    })
    // The cached value is what was returned; the refresh happens in the background.
    expect(stale.cached).toBe(true)
    expect(painted.map((entry) => entry.value)).toEqual(['first', 'first', 'first'])

    // The refresh runs behind the paint; flush its promise chain.
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
    expect(loader).toHaveBeenCalledTimes(2)
    expect(painted.at(-1).value).toBe('second')
  })
})

// --- source checks -----------------------------------------------------------

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('source checks', () => {
  it('AppLayout reads the session and approvals once, not per route change', () => {
    const layout = read('src/components/AppLayout.vue')

    expect(layout).toContain('getSession()')
    expect(layout).toContain('loadShared(DATA_KEYS.approvals')
    // No watcher and no direct approvals fetch: navigation cannot re-trigger it.
    expect(layout).not.toContain('watch(')
    expect(layout).not.toContain("fetch('/api/leave/approvals'")
  })

  it('the employee dock clears the cache before leaving for /login', () => {
    const dock = read('src/components/AppDock.vue')
    expect(dock).toContain("import { completeLogout } from '../lib/logout.js'")
    expect(dock).toContain('navigate: () => completeLogout()')
    expect(dock).not.toContain('window.location.assign')
  })

  it('the admin nav clears the cache before leaving for /login', () => {
    const nav = read('src/components/AdminNav.vue')
    expect(nav).toContain("import { completeLogout } from '../lib/logout.js'")
    expect(nav).toContain('await completeLogout()')
    expect(nav).not.toContain('window.location.assign')
  })

  it('a successful login starts from an empty cache', () => {
    const login = read('src/pages/LoginPage.vue')
    expect(login).toMatch(/clearAll\(\)\s*\n\s*await router\.replace\(data\.redirectTo\)/)
  })
})
