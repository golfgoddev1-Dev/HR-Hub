import { clearAll, getCached } from './lib/data-cache.js'
import { logoutRequestOptions } from './lib/logout.js'
import { DATA_KEYS, SESSION_TTL_MS } from './lib/shared-data.js'

// A 401 means "not signed in", not a value worth remembering: it is thrown so
// the cache keeps no entry, and a later login sees a real session at once.
class NoSessionError extends Error {}

async function loadSession() {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'same-origin',
  })
  if (response.status === 401) throw new NoSessionError()
  if (!response.ok) throw new Error('session unavailable')
  return response.json()
}

// Read by the router guard, the layout and the admin landing page; the cache
// makes those one request for five minutes, and every mutation that can change
// the role or approval rights invalidates it.
export async function getSession() {
  try {
    return await getCached(DATA_KEYS.session, loadSession, { ttlMs: SESSION_TTL_MS })
  } catch {
    return null
  }
}

// A forced session read that never uses the cache. Used when a page is restored
// from the back/forward cache, where the normal cache could still hold the
// signed-in value from before a logout in this or another tab.
export async function verifySession() {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (response.status === 401) {
      clearAll()
      return null
    }
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

export async function postLogout() {
  try {
    // Includes this browser's push endpoint, when it has one.
    const response = await fetch('/api/auth/logout', await logoutRequestOptions())
    return response.ok
  } catch {
    return false
  }
}

export async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { status: response.status, data }
}
