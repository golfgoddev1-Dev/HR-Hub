// The focus contract for a modal dialog, as plain functions so it is tested
// without a browser: focus moves in when the dialog opens, Tab and Shift+Tab
// stay inside it, and focus goes back to the control that opened it.
//
// Nothing here changes what the page asks the API for.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** The controls a Tab press can reach inside `root`, in DOM order. */
export function focusableIn(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return []
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((element) => {
    if (element.disabled === true) return false
    if (element.hidden === true) return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    if (typeof element.tabIndex === 'number' && element.tabIndex < 0) return false
    return true
  })
}

/**
 * Move focus into the panel, preferring `preferred` (the close button).
 * Returns the element that now holds focus, or null when nothing could take it.
 */
export function focusPanel(panel, preferred = null) {
  if (!panel) return null
  const target = preferred ?? focusableIn(panel)[0] ?? panel
  if (!target || typeof target.focus !== 'function') return null
  target.focus()
  return target
}

/**
 * Keep Tab inside the panel: at the last control Tab wraps to the first, at the
 * first Shift+Tab wraps to the last, and a focus that escaped the panel is
 * pulled back in from either end. Returns true when the event was handled.
 */
export function trapTabKey(event, panel) {
  if (!event || event.key !== 'Tab' || !panel) return false
  const items = focusableIn(panel)
  if (items.length === 0) {
    event.preventDefault()
    return true
  }

  const first = items[0]
  const last = items[items.length - 1]
  const active = panel.ownerDocument?.activeElement ?? null
  const outside = !active || active === panel.ownerDocument?.body || !panel.contains(active)

  if (event.shiftKey) {
    if (outside || active === first) {
      event.preventDefault()
      last.focus()
      return true
    }
    return false
  }

  if (outside || active === last) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

/**
 * Put focus back on the opener. A row that has left the page (a new filter was
 * applied while the dialog was open) is not a place to send focus, so this does
 * nothing then.
 */
export function restoreFocus(opener) {
  if (!opener || typeof opener.focus !== 'function') return false
  if (opener.isConnected === false) return false
  opener.focus()
  return opener.ownerDocument?.activeElement === opener
}
