// The one way out of the app. The server request has already settled by the
// time this runs, so it drops every browser-side copy of the account and
// replaces the protected page in history instead of adding to it.
import { clearAll } from './data-cache.js'
import { clearClientStorage } from './logout-storage.js'

/** This browser's push endpoint, or null when push is unavailable. */
async function currentPushEndpoint() {
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.('/')
    const subscription = await registration?.pushManager?.getSubscription?.()
    return typeof subscription?.endpoint === 'string' ? subscription.endpoint : null
  } catch {
    return null
  }
}

/**
 * Options for POST /api/auth/logout. Naming the endpoint lets the Worker delete
 * exactly this browser's subscription, so the next account here starts clean.
 */
export async function logoutRequestOptions() {
  const endpoint = await currentPushEndpoint()
  if (!endpoint) return { method: 'POST', credentials: 'same-origin' }
  return {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }
}

/** Drops the browser's own push subscription after the server row is deleted. */
async function forgetBrowserPush() {
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.('/')
    const subscription = await registration?.pushManager?.getSubscription?.()
    await subscription?.unsubscribe?.()
  } catch {
    // A missing registration or a blocked push API must not stop logout.
  }
}

export async function completeLogout() {
  // 1. the in-memory API cache, 2. web storage and Cache Storage, 3. push.
  clearAll()
  await clearClientStorage()
  await forgetBrowserPush()
  // replace(), not assign(): Back must not return to the protected page.
  window.location.replace('/login')
}
