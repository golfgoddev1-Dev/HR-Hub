// The login response still wraps an employee landing page in
// /pending?to=… so the client can show a placeholder. The placeholder is no
// longer wanted: unwrap the destination before navigating, and keep the
// fallback path only for genuinely unknown destinations.
const PENDING_PREFIX = '/pending?'

function isInAppPath(path) {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/') || path.startsWith('//')) return false
  if (path.includes('\\') || path.includes('://')) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false
  return path !== '/pending' && !path.startsWith('/pending?') && !path.startsWith('/pending/')
}

/**
 * Returns a safe in-app path from a server redirect. A `/pending?to=…`
 * wrapper is unwrapped; malformed or external paths return null.
 */
export function landingPathFromRedirect(value) {
  if (typeof value !== 'string') return null

  let path = value
  if (path.startsWith(PENDING_PREFIX)) {
    path = new URLSearchParams(path.slice(PENDING_PREFIX.length)).get('to') ?? ''
  }
  return isInAppPath(path) ? path : null
}
