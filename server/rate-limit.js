const DEFAULT_MAX_ENTRIES = 10000

function dropOldest(buckets, maxEntries) {
  while (buckets.size >= maxEntries) {
    const oldest = buckets.keys().next()
    if (oldest.done) return
    buckets.delete(oldest.value)
  }
}

export function createFixedWindowLimiter({
  limit,
  windowMs,
  now = () => Date.now(),
  maxEntries = DEFAULT_MAX_ENTRIES,
}) {
  const buckets = new Map()
  const max = typeof limit === 'number' && limit > 0 ? limit : 0
  const window = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 0
  const capacity =
    typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES

  function prune(currentTime) {
    for (const [key, entry] of buckets) {
      if (currentTime - entry.windowStart >= window) buckets.delete(key)
    }
  }

  return function isAllowed(key) {
    const currentTime = Number(now())
    prune(currentTime)

    const entry = buckets.get(key)
    if (!entry || currentTime - entry.windowStart >= window) {
      if (buckets.size >= capacity) dropOldest(buckets, capacity)
      buckets.set(key, { count: 1, windowStart: currentTime })
      return max > 0
    }

    if (entry.count >= max) return false
    entry.count += 1
    return true
  }
}
