export function normalizeSearchQuery(q) {
  if (typeof q !== 'string') return ''
  return q.trim().replace(/\s+/g, ' ')
}

export function isValidSearchQuery(q) {
  return normalizeSearchQuery(q).length >= 2
}
