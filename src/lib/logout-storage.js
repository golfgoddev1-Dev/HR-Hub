// Everything this app keeps in the browser, in one place.
//
// It writes no account data to localStorage or sessionStorage today (the only
// persisted state is the Web Push subscription, which the browser owns), so the
// explicit key list is empty. The prefix sweep still removes anything a later
// version adds under 'hrhub.', and Cache Storage is emptied in case an older
// build left an entry behind; the service worker itself caches nothing.

export const APP_STORAGE_PREFIX = 'hrhub.'
export const APP_STORAGE_KEYS = []

function removeKeys(store, keys) {
  if (!store) return

  for (const key of keys) {
    try {
      store.removeItem(key)
    } catch {
      // Storage may be blocked (private mode); the logout still continues.
    }
  }

  let length = 0
  try {
    length = store.length
  } catch {
    return
  }

  for (let index = length - 1; index >= 0; index -= 1) {
    let key = null
    try {
      key = store.key(index)
    } catch {
      key = null
    }
    if (typeof key === 'string' && key.startsWith(APP_STORAGE_PREFIX)) {
      try {
        store.removeItem(key)
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Removes this app's web-storage keys and every Cache Storage entry.
 * The stores are injectable so the cleanup is testable without a browser.
 */
export async function clearClientStorage({
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
  cacheStorage = globalThis.caches,
  keys = APP_STORAGE_KEYS,
} = {}) {
  removeKeys(local, keys)
  removeKeys(session, keys)

  if (!cacheStorage || typeof cacheStorage.keys !== 'function') return
  try {
    for (const name of await cacheStorage.keys()) await cacheStorage.delete(name)
  } catch {
    // A missing or blocked Cache Storage must not stop the logout.
  }
}
