// The pending-approval count is one number shared by the dock badge, the
// controller sidebar and the leave-home summary.
//
// Two things keep it honest without a socket and without polling while the tab
// is hidden:
// - a decision lowers it here at once and tells the other tabs of this browser
//   over a BroadcastChannel (messages carry the number only);
// - a tiny ETag read on focus / on becoming visible / every two minutes picks up
//   requests that other people submitted. A 304 changes nothing.
import { ref } from 'vue'
import { setBadge } from './app-badge.js'

export const APPROVALS_CHANNEL = 'hrhub-approvals'
export const APPROVAL_POLL_MS = 120_000
export const APPROVAL_COUNT_URL = '/api/leave/approvals/count'

/** The one number every reader paints. */
export const approvalCount = ref(0)

/** Only a whole number at or above zero is usable; anything else is 0. */
export function normalizeApprovalCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.floor(count)
}

/** One decision removes one request: never below zero. */
export function decrementApprovalCount(value) {
  return Math.max(0, normalizeApprovalCount(value) - 1)
}

export function setApprovalCount(value) {
  const next = normalizeApprovalCount(value)
  if (approvalCount.value !== next) approvalCount.value = next
  // The installed icon carries the same number. Fire-and-forget: the browser
  // may not support a badge, and that must never slow the paint.
  setBadge(next)
  return next
}

// The last tag this page saw, so a check can ask "anything new?".
let lastEtag = null

export function clearApprovalCount() {
  approvalCount.value = 0
  lastEtag = null
}

function tabIdentifier() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch {
    // Fall through to the random suffix.
  }
  return `tab-${Math.random().toString(36).slice(2)}`
}

const TAB_ID = tabIdentifier()

/**
 * The cross-tab channel, or a no-op when BroadcastChannel is missing or blocked.
 * A message is `{ tabId, count }` only: no request ids, no names.
 */
export function createApprovalChannel({
  Channel = globalThis.BroadcastChannel,
  tabId = TAB_ID,
  onMessage = () => {},
} = {}) {
  if (typeof Channel !== 'function') return { supported: false, publish() {}, close() {} }

  let channel
  try {
    channel = new Channel(APPROVALS_CHANNEL)
    // Keeps a non-browser runtime from holding the process open.
    channel.unref?.()
  } catch {
    return { supported: false, publish() {}, close() {} }
  }

  channel.onmessage = (event) => {
    const message = event?.data
    if (!message || typeof message !== 'object') return
    // Our own decision already painted here; other tabs' ids are strings.
    if (message.tabId === tabId) return
    if (typeof message.count !== 'number' || !Number.isFinite(message.count)) return
    onMessage(normalizeApprovalCount(message.count))
  }

  return {
    supported: true,
    publish(value) {
      try {
        channel.postMessage({ tabId, count: normalizeApprovalCount(value) })
      } catch {
        // A closed channel must never break the decision that succeeded.
      }
    },
    close() {
      try {
        channel.close()
      } catch {
        // Nothing to do.
      }
    },
  }
}

let sharedChannel = null

export function openApprovalCountChannel() {
  if (!sharedChannel) {
    sharedChannel = createApprovalChannel({ onMessage: (count) => setApprovalCount(count) })
  }
  return sharedChannel
}

export function publishApprovalCount(value) {
  openApprovalCountChannel().publish(value)
}

/**
 * The shared visibility/focus timer. Starts a check at once when the tab is
 * visible, keeps one interval while it stays visible, and stops the interval on
 * hide or stop(). Repeated start() calls do nothing.
 */
export function createApprovalPoll({
  check,
  doc = globalThis.document,
  win = globalThis.window,
  intervalMs = APPROVAL_POLL_MS,
  schedule = (callback, delay) => setInterval(callback, delay),
  cancel = (handle) => clearInterval(handle),
} = {}) {
  let timer = null
  let started = false
  let running = false

  const visible = () => doc?.visibilityState === 'visible'

  async function run() {
    if (running) return
    running = true
    try {
      await check()
    } catch {
      // A failed check keeps the current number; the next tick tries again.
    } finally {
      running = false
    }
  }

  function startTimer() {
    if (!started || timer !== null) return
    timer = schedule(() => {
      if (visible()) void run()
    }, intervalMs)
  }

  function stopTimer() {
    if (timer === null) return
    cancel(timer)
    timer = null
  }

  function onVisibilityChange() {
    if (!started) return
    if (!visible()) {
      stopTimer()
      return
    }
    void run()
    startTimer()
  }

  function onFocus() {
    if (started && visible()) void run()
  }

  function start() {
    if (started) return
    started = true
    doc?.addEventListener?.('visibilitychange', onVisibilityChange)
    win?.addEventListener?.('focus', onFocus)
    if (!visible()) return
    void run()
    startTimer()
  }

  function stop() {
    if (!started) return
    started = false
    doc?.removeEventListener?.('visibilitychange', onVisibilityChange)
    win?.removeEventListener?.('focus', onFocus)
    stopTimer()
  }

  return { start, stop, scheduled: () => timer !== null }
}

/**
 * One cheap read: the Worker answers 304 when this approver's queue has not
 * changed. Never throws, and a 304 is a no-op.
 */
export async function checkApprovalCount() {
  let response
  try {
    response = await fetch(APPROVAL_COUNT_URL, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: lastEtag ? { 'If-None-Match': lastEtag } : {},
    })
  } catch {
    return
  }
  if (response.status === 304 || !response.ok) return

  lastEtag = response.headers.get('ETag') || lastEtag
  const data = await response.json().catch(() => null)
  if (!data || typeof data.count !== 'number') return
  setApprovalCount(data.count)
}

let owners = 0
let sharedPoll = null

const defaultPoll = () => createApprovalPoll({ check: checkApprovalCount })

/**
 * Starts the page's single check: one channel and one timer, however many
 * components ask. Returns the release for that component.
 */
export function retainApprovalCountSync(createPoll = defaultPoll) {
  owners += 1
  if (!sharedPoll) sharedPoll = createPoll()
  if (owners === 1) {
    openApprovalCountChannel()
    sharedPoll.start()
  }

  let released = false
  return () => {
    if (released) return
    released = true
    owners -= 1
    if (owners === 0 && sharedPoll) {
      sharedPoll.stop()
      sharedPoll = null
    }
  }
}
