// The leave-notification switch: one last-known boolean per account, an
// optimistic flip on tap, and one background sync at a time.
//
// Nothing here touches the network or the browser directly: the caller passes
// the sync function and the two storage helpers take a storage object, so the
// coalescing and rollback rules can be tested without a DOM.

export const NOTIFICATION_STORAGE_PREFIX = 'hrhub.notification.enabled'
export const NOTIFICATION_DEBOUNCE_MS = 400
export const NOTIFICATION_TIMEOUT_MS = 10_000

export const NOTIFICATION_TOGGLE_MESSAGES = Object.freeze({
  updated: 'อัปเดตสถานะการแจ้งเตือนแล้ว',
  denied: 'เบราว์เซอร์บล็อกการแจ้งเตือนไว้ โปรดเปิดในการตั้งค่าเบราว์เซอร์',
  failed: 'บันทึกไม่สำเร็จ ลองอีกครั้ง',
})

/** Only the boolean is kept, under a key that names the account. */
export function notificationStateKey(employeeId) {
  return `${NOTIFICATION_STORAGE_PREFIX}:${employeeId}`
}

function storageOrNull() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

// The last value in this page load, so a remount can paint before the storage
// read. It is keyed by employee id and never reused for another account.
let remembered = null

/** The stored value for THIS employee, or null when there is none. */
export function readNotificationState(employeeId, storage = storageOrNull()) {
  if (typeof employeeId !== 'string' || employeeId.length === 0) return null

  if (remembered && remembered.employeeId === employeeId) return remembered.enabled
  if (!storage) return null

  try {
    const raw = storage.getItem(notificationStateKey(employeeId))
    if (raw === '1') return true
    if (raw === '0') return false
    return null
  } catch {
    return null
  }
}

export function writeNotificationState(employeeId, enabled, storage = storageOrNull()) {
  if (typeof employeeId !== 'string' || employeeId.length === 0) return
  const value = enabled === true

  remembered = { employeeId, enabled: value }
  if (!storage) return

  try {
    storage.setItem(notificationStateKey(employeeId), value ? '1' : '0')
  } catch {
    // A blocked or full storage only costs the next page its head start.
  }
}

/**
 * Forgets every account's value. Called from clearAll(), which both logout and
 * login go through, so another account's switch state can never be shown.
 */
export function clearNotificationState(storage = storageOrNull()) {
  remembered = null
  if (!storage) return

  try {
    const stale = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (typeof key === 'string' && key.startsWith(NOTIFICATION_STORAGE_PREFIX)) stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // Storage may be blocked; the in-memory value is already gone.
  }
}

/**
 * The switch controller.
 *
 * - `request(value)` flips the UI immediately and remembers the intent; the
 *   write is debounced so a burst of taps collapses into one.
 * - `sync` is the caller's background work (browser + server). It runs one at a
 *   time; if the intent moved while it was running, exactly one more pass runs
 *   with the final value.
 * - A failed or timed-out pass rolls back to the last confirmed value and
 *   reports a short Thai message through `onNotice`.
 * - `adopt(value)` applies a server value only when nothing is pending.
 */
export function createNotificationToggle({
  sync,
  onState = () => {},
  onNotice = () => {},
  onConfirm = () => {},
  debounceMs = NOTIFICATION_DEBOUNCE_MS,
  timeoutMs = NOTIFICATION_TIMEOUT_MS,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle),
} = {}) {
  let desired = null
  let confirmed = null
  let sent = null
  let running = false
  let debounce = null

  function publish(value) {
    onState(value === true)
  }

  /** Paints the stored value. A live intent always wins over a late seed. */
  function seed(value) {
    if (value !== true && value !== false) return
    if (desired !== null && desired !== confirmed) return
    confirmed = value
    if (desired === null) desired = value
    sent = desired
    publish(value)
  }

  function confirm(value) {
    confirmed = value
    onConfirm(value)
    if (desired === value) publish(value)
  }

  function rollback(reason) {
    desired = confirmed
    sent = confirmed
    publish(confirmed === true)
    onNotice(reason === 'permission' ? NOTIFICATION_TOGGLE_MESSAGES.denied : NOTIFICATION_TOGGLE_MESSAGES.failed)
  }

  async function syncOnce(target) {
    let timer = null
    const timeout = new Promise((resolve) => {
      timer = schedule(() => resolve({ timedOut: true }), timeoutMs)
    })
    const attempt = Promise.resolve()
      .then(() => sync(target))
      .then((result) => (result && result.ok === true ? { ok: true } : { ok: false, reason: result?.reason ?? 'error' }))
      .catch(() => ({ ok: false, reason: 'error' }))

    // The race means a hung request cannot hold the switch: after the safety
    // timeout the pass ends, so the next tap starts a fresh one.
    const result = await Promise.race([attempt, timeout])
    if (timer !== null) cancel(timer)

    if (result?.timedOut === true) {
      rollback('timeout')
      return false
    }
    if (result.ok === true) {
      confirm(target)
      return true
    }
    rollback(result.reason === 'permission' ? 'permission' : 'error')
    return false
  }

  async function drain() {
    if (running || typeof sync !== 'function') return
    running = true
    try {
      // One pass per settled intent: a tap during the await moves `desired`,
      // and the loop sends exactly one more request for the final value.
      while (desired !== null && desired !== sent) {
        const target = desired
        sent = target
        if (!(await syncOnce(target))) return
      }
    } finally {
      running = false
    }
  }

  function request(value) {
    desired = value === true
    // The flip is synchronous: no await happens before it in the tap handler.
    publish(desired)

    if (debounce !== null) cancel(debounce)
    debounce = schedule(() => {
      debounce = null
      void drain()
    }, debounceMs)
  }

  /** Applies a server value, but never over a pending user intent. */
  function adopt(value) {
    if (running) return false
    if (desired !== null && desired !== confirmed) return false
    const next = value === true
    if (confirmed === next) return false
    confirmed = next
    desired = next
    sent = next
    onConfirm(next)
    publish(next)
    return true
  }

  return {
    seed,
    request,
    adopt,
    drain,
    state: () => ({ desired, confirmed, sent, running }),
  }
}
