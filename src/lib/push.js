// Web Push helpers. The browser subscription and the account preference are
// separate things: the switch may be on only when both agree.
//
// Nothing here asks for Notification permission except requestAndSubscribe(),
// which is called from the user's click. autoEnablePush() only acts when the
// browser already reports permission === "granted".

const STATUS_URL = '/api/notifications/status'
const VAPID_URL = '/api/notifications/vapid-public-key'
const SUBSCRIBE_URL = '/api/notifications/subscribe'
const UNSUBSCRIBE_URL = '/api/notifications/unsubscribe'

let autoRun = null

export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof globalThis.PushManager !== 'undefined' &&
    typeof globalThis.Notification !== 'undefined'
  )
}

export function iosNeedsInstall() {
  if (typeof navigator === 'undefined') return false
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    navigator.standalone === true ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  return isIos && !standalone
}

/** The switch is on only when this browser and this account both agree. */
export function notificationSwitchIsOn({ browserSubscribed, serverSubscribed }) {
  return Boolean(browserSubscribed && serverSubscribed)
}

/** Auto-subscribe is allowed only after a prior opt-in and granted permission. */
export function shouldAutoSubscribe({ enabled, permission, hasSubscription }) {
  return enabled === true && permission === 'granted' && hasSubscription !== true
}

function urlBase64ToUint8Array(base64Url) {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

async function pushRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

export async function browserSubscription() {
  if (!pushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    return registration ? await registration.pushManager.getSubscription() : null
  } catch {
    return null
  }
}

export async function fetchNotificationStatus(endpoint = null) {
  const query =
    typeof endpoint === 'string' && endpoint.length > 0
      ? `?endpoint=${encodeURIComponent(endpoint)}`
      : ''
  const response = await fetch(STATUS_URL + query, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) throw new Error('notification status unavailable')
  return {
    enabled: data.enabled === true,
    subscribed: data.subscribed === true,
  }
}

async function fetchVapidKey() {
  const response = await fetch(VAPID_URL, { credentials: 'same-origin' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true || typeof data.publicKey !== 'string') return null
  return data.publicKey
}

async function saveSubscription(subscription) {
  const json = subscription.toJSON()
  const response = await fetch(SUBSCRIBE_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    }),
  })
  const data = await response.json().catch(() => ({}))
  return response.ok && data.ok === true
}

async function subscribeToPush() {
  const existing = await browserSubscription()
  let subscription = existing

  if (!subscription) {
    const publicKey = await fetchVapidKey()
    if (!publicKey) return { ok: false, reason: 'config' }

    const registration = await pushRegistration()
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const saved = await saveSubscription(subscription)
  if (!saved) {
    if (!existing) await subscription.unsubscribe().catch(() => {})
    return { ok: false, reason: 'server' }
  }
  return { ok: true, subscribed: true }
}

/** Called only from a click: this is the one place permission may be requested. */
export async function requestAndSubscribe() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: 'permission' }
  return subscribeToPush()
}

/**
 * Silent re-subscribe after login. It never asks for permission and is a
 * single-flight operation because the login page and the mounted switch can
 * call it at the same moment.
 */
export function autoEnablePush() {
  if (autoRun) return autoRun

  autoRun = (async () => {
    if (!pushSupported() || iosNeedsInstall()) return { ok: false, reason: 'unsupported' }
    if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' }

    const status = await fetchNotificationStatus()
    const subscription = await browserSubscription()
    if (
      !shouldAutoSubscribe({
        enabled: status.enabled,
        permission: Notification.permission,
        hasSubscription: Boolean(subscription),
      })
    ) {
      return { ok: false, reason: 'skipped' }
    }
    return subscribeToPush()
  })()
    .catch(() => ({ ok: false, reason: 'error' }))
    .finally(() => {
      autoRun = null
    })

  return autoRun
}

/** Server first, then the browser: the account preference stays authoritative. */
export async function unsubscribePush() {
  const subscription = await browserSubscription()
  if (!subscription?.endpoint) return { ok: true, unsubscribed: false }

  const response = await fetch(UNSUBSCRIBE_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) return { ok: false, reason: 'server' }

  await subscription.unsubscribe().catch(() => {})
  return { ok: true, unsubscribed: data.unsubscribed === true }
}
