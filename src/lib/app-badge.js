// The installed app icon badge: one number, never a name or a request.
//
// The badge is a notification surface too, so it is offered, never demanded:
// setAppBadge/clearAppBadge may be missing (a browser that does not support the
// Badging API, or a page that is not installed), may reject, or may need a
// permission this module never asks for. Every call is fire-and-forget and
// wrapped, and the last value is kept in memory only.

// The last number handed to the browser, 0 after a clear. Nothing is stored.
let lastValue = 0
// An active approver whose notification setting is on may show a number.
let allowed = true

function badgeNavigator() {
  try {
    return globalThis.navigator ?? null
  } catch {
    return null
  }
}

// setAppBadge returns a promise in some browsers; a refusal is not an error.
function settle(result) {
  if (result && typeof result.catch === 'function') result.catch(() => {})
}

/** The value last handed to the browser, or 0 when there is no badge. */
export function badgeValue() {
  return lastValue
}

/**
 * Who may paint a badge on this device: an active approver whose notification
 * setting is on. Anything else clears whatever the icon shows, so a different
 * account never inherits the previous number and an account with notifications
 * off is cleared at its next sign-in.
 */
export function setBadgeAllowed(value) {
  allowed = value === true
  if (!allowed) clearBadge()
  return allowed
}

/** Sets the icon badge; returns whether the browser took the call. */
export function setBadge(count) {
  const value = Number(count)
  // Zero is the clear signal, not a badge with no number.
  if (!Number.isFinite(value) || value <= 0) return clearBadge()
  if (!allowed) return false

  const total = Math.floor(value)
  const nav = badgeNavigator()
  try {
    if (typeof nav?.setAppBadge !== 'function') return false
    settle(nav.setAppBadge(total))
    lastValue = total
    return true
  } catch {
    return false
  }
}

/** Clears the icon badge; returns whether the browser took the call. */
export function clearBadge() {
  const nav = badgeNavigator()
  try {
    if (typeof nav?.clearAppBadge !== 'function') return false
    settle(nav.clearAppBadge())
    lastValue = 0
    return true
  } catch {
    return false
  }
}
