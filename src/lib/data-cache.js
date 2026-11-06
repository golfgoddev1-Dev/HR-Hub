// A dependency-free in-memory cache for API reads. Pages used to fetch session
// and shared lookups again on every navigation, which cost one Worker invocation
// per page visit; this keeps the value until its ttl runs out.
//
// Nothing is persisted on purpose: a reload starts empty, so a new deploy or a
// new login can never read a stale value from localStorage/sessionStorage. The
// one session key that does persist is the notification switch's last-known
// value per account; clearAll() drops it here, so another account never sees it.
import { clearNotificationState } from './notification-toggle.js'

const entries = new Map()
const inflight = new Map()
let generation = 0

// The cached value and when it was stored, without loading anything. Callers use
// it for stale-while-revalidate: paint this now, refresh in the background.
export function peekCached(key) {
  return entries.get(key) ?? null
}

// Returns the cached value when it is younger than ttlMs; otherwise runs the
// loader. Concurrent callers for one key share a single loader call.
export function getCached(key, loader, { ttlMs = 60_000 } = {}) {
  const entry = entries.get(key)
  if (entry && Date.now() - entry.at < ttlMs) return Promise.resolve(entry.value)
  return refreshCached(key, loader)
}

// Always runs the loader, but still only once per key while it is in flight.
// A failure is never cached: the entry is left as it was and the error rethrows.
export function refreshCached(key, loader) {
  const running = inflight.get(key)
  if (running) return running

  const startedAt = generation
  const pending = Promise.resolve()
    .then(loader)
    .then(
      (value) => {
        if (startedAt === generation) entries.set(key, { value, at: Date.now() })
        inflight.delete(key)
        return value
      },
      (error) => {
        inflight.delete(key)
        throw error
      }
    )

  inflight.set(key, pending)
  return pending
}

export function invalidate(key) {
  entries.delete(key)
  inflight.delete(key)
}

// Drops every key that starts with prefix, e.g. 'leave:holidays' also removes
// 'leave:holidays:2026-01-01:2026-12-31'.
export function invalidatePrefix(prefix) {
  for (const key of [...entries.keys()]) {
    if (key.startsWith(prefix)) entries.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

// Used on logout and on any session or role change: a response that arrives
// after this must not be stored, which the generation counter guarantees.
export function clearAll() {
  generation += 1
  entries.clear()
  inflight.clear()
  // Logout and login both pass through here, so the previous account's switch
  // state never paints for the next one.
  clearNotificationState()
}
