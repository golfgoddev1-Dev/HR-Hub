// The only two destinations a notification may name. The service worker has
// its own copy because it is served as a classic script; keep them in step.
export const NOTIFICATION_ROUTE_PATHS = Object.freeze({
  approvals: '/leave/approvals',
  leave: '/leave',
})

const LOGIN_TARGETS = Object.freeze(Object.values(NOTIFICATION_ROUTE_PATHS))

/** Maps a notification route key to its page, or the app root when unknown. */
export function pathForNotificationRoute(routeKey) {
  if (typeof routeKey !== 'string' || !Object.hasOwn(NOTIFICATION_ROUTE_PATHS, routeKey)) {
    return '/'
  }
  return NOTIFICATION_ROUTE_PATHS[routeKey]
}

/**
 * The login page may only forward to the fixed notification destinations. It
 * rejects protocol-relative URLs, absolute URLs and any path outside the list.
 */
export function safeLoginTarget(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\') || value.includes('://')) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null
  return LOGIN_TARGETS.includes(value) ? value : null
}

/** Keeps the current path as `?to=` only when it is one of those destinations. */
export function loginTargetForPath(path) {
  return typeof path === 'string' && LOGIN_TARGETS.includes(path) ? path : null
}
