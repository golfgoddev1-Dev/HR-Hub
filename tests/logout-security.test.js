// Logout must leave nothing behind in the browser: the API cache, web storage,
// Cache Storage and the history entry. These checks pin the client half and the
// back/forward-cache re-check without a browser.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearAll, getCached } from '../src/lib/data-cache.js'
import { completeLogout, logoutRequestOptions } from '../src/lib/logout.js'
import { APP_STORAGE_KEYS, clearClientStorage } from '../src/lib/logout-storage.js'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const read = (path) => readFileSync(join(SRC, path), 'utf8')

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(js|vue)$/.test(entry) ? [full] : []
  })
}

const ALL_SOURCES = sourceFiles(SRC).map((file) => ({
  file: file.slice(SRC.length + 1),
  source: readFileSync(file, 'utf8'),
}))

function fakeStorage(initial) {
  const data = new Map(Object.entries(initial ?? {}))
  return {
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    has: (key) => data.has(key),
  }
}

function fakeCaches(names) {
  const store = new Set(names)
  return {
    store,
    keys: async () => [...store],
    delete: async (name) => store.delete(name),
  }
}

afterEach(() => {
  clearAll()
})

describe('clearClientStorage', () => {
  it('removes the listed keys and every app-prefixed key, and nothing else', async () => {
    const local = fakeStorage({
      'hrhub.legacy': 'x',
      'hrhub.push': 'y',
      'unrelated.key': 'keep',
    })
    const session = fakeStorage({ 'hrhub.tab': 'z', other: 'keep too' })

    await clearClientStorage({
      local,
      session,
      cacheStorage: fakeCaches([]),
      keys: [...APP_STORAGE_KEYS, 'hrhub.legacy'],
    })

    expect(local.has('hrhub.legacy')).toBe(false)
    expect(local.has('hrhub.push')).toBe(false)
    expect(local.has('unrelated.key')).toBe(true)
    expect(session.has('hrhub.tab')).toBe(false)
    expect(session.has('other')).toBe(true)
  })

  it('empties every Cache Storage entry the origin owns', async () => {
    const cacheStorage = fakeCaches(['workbox-precache', 'old-build'])

    await clearClientStorage({
      local: fakeStorage({}),
      session: fakeStorage({}),
      cacheStorage,
    })

    expect(cacheStorage.store.size).toBe(0)
  })

  it('keeps going when storage is unavailable', async () => {
    const blocked = {
      get length() {
        throw new Error('blocked')
      },
      key: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    await expect(
      clearClientStorage({ local: blocked, session: blocked, cacheStorage: null })
    ).resolves.toBeUndefined()
  })
})

describe('logout completion', () => {
  it('clears the API cache, then storage, then replaces the page', () => {
    const source = read('lib/logout.js')

    const cache = source.indexOf('clearAll()')
    const storage = source.indexOf('await clearClientStorage()')
    const navigate = source.indexOf("window.location.replace('/login')")

    expect(cache).toBeGreaterThan(-1)
    expect(storage).toBeGreaterThan(cache)
    expect(navigate).toBeGreaterThan(storage)
    expect(source).not.toContain('window.location.assign')
  })

  it('keeps the browser subscription when the server kept the row', async () => {
    const unsubscribe = vi.fn(async () => true)
    const replace = vi.fn()
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({ endpoint: 'https://push.example/kept', unsubscribe }),
          },
        }),
      },
    })
    vi.stubGlobal('window', { location: { replace } })

    try {
      await completeLogout({ keepPushSubscription: true })
      expect(unsubscribe).not.toHaveBeenCalled()
      expect(replace).toHaveBeenCalledWith('/login')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('unsubscribes the browser when the server deleted the row', async () => {
    const unsubscribe = vi.fn(async () => true)
    const replace = vi.fn()
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({ endpoint: 'https://push.example/dropped', unsubscribe }),
          },
        }),
      },
    })
    vi.stubGlobal('window', { location: { replace } })

    try {
      await completeLogout()
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith('/login')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('is used by every shell, never a direct navigation', () => {
    for (const file of ['components/AppDock.vue', 'components/AdminNav.vue', 'components/ControllerNav.vue']) {
      const source = read(file)
      expect(source, file).toContain('completeLogout')
      expect(source, file).not.toContain('window.location.assign')
    }

    // The controller used to stay inside the SPA, which kept history behind.
    expect(read('components/ControllerNav.vue')).not.toContain("router.replace('/login')")
  })

  it('names this browser push endpoint in the logout request', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({ endpoint: 'https://push.example/abc' }),
          },
        }),
      },
    })

    const options = await logoutRequestOptions()

    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('same-origin')
    expect(JSON.parse(options.body)).toEqual({ endpoint: 'https://push.example/abc' })

    vi.unstubAllGlobals()
  })

  it('has no logout path anywhere that uses assign', () => {
    const LOGOUT_SOURCES = new Set([
      'components/AppDock.vue',
      'components/AdminNav.vue',
      'components/ControllerNav.vue',
      'lib/logout.js',
      'main.js',
      'api.js',
      'router.js',
    ])

    for (const { file, source } of ALL_SOURCES) {
      if (!LOGOUT_SOURCES.has(file)) continue
      expect(source, file).not.toMatch(/location\.assign\(/)
    }
  })
})

describe('back/forward cache and guard', () => {
  it('re-checks the session when a page is restored from the bfcache', () => {
    const main = read('main.js')

    expect(main).toContain("addEventListener('pageshow'")
    expect(main).toContain('event.persisted')
    expect(main).toContain('verifySession()')
    expect(main).toContain("window.location.replace('/login')")
    expect(main).not.toContain('window.location.assign')
  })

  it('drops the browser push subscription before replacing the page', () => {
    const source = read('lib/logout.js')

    expect(source).toContain('subscription?.unsubscribe?.()')
    expect(source.indexOf('await forgetBrowserPush()')).toBeLessThan(
      source.indexOf("window.location.replace('/login')")
    )
    // The shells no longer post an empty logout body; the endpoint rides along.
    for (const file of ['components/AppDock.vue', 'components/AdminNav.vue']) {
      expect(read(file), file).toContain('await logoutRequestOptions()')
    }
    expect(read('api.js')).toContain('await logoutRequestOptions()')
  })

  it('checks the session without using the cache when restoring', () => {
    const api = read('api.js')
    const start = api.indexOf('export async function verifySession')

    expect(start).toBeGreaterThan(-1)
    const body = api.slice(start, api.indexOf('export async function postLogout'))
    expect(body).toContain("cache: 'no-store'")
    expect(body).toContain('clearAll()')
    expect(body).toContain('response.status === 401')
  })

  it('keeps no second session cache beside the shared one', () => {
    const router = read('router.js')

    expect(router).not.toContain('SESSION_CACHE_MS')
    expect(router).not.toContain('cachedSession')
    expect(router).toContain('const session = await getSession()')
  })

  it('does not reuse a cache entry after clearAll', async () => {
    const loader = vi.fn(async () => ({ ok: true }))

    await getCached('session', loader, { ttlMs: 60_000 })
    await getCached('session', loader, { ttlMs: 60_000 })
    expect(loader).toHaveBeenCalledTimes(1)

    clearAll()
    await getCached('session', loader, { ttlMs: 60_000 })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
