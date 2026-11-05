// The logout choreography without a browser: the feedback callbacks, the one
// POST per click, and the rule that navigation waits for both the minimum delay
// and the request, with a hard cap for a request that never settles.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOGOUT_FALLBACK_MS,
  LOGOUT_MIN_MS,
  createLogoutFlow,
  ripplePlacement,
} from '../src/lib/logout-flow.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const pendingForever = () => new Promise(() => {})

const RECT = { left: 100, top: 20, width: 72, height: 60 }

describe('ripple placement', () => {
  it('sizes the ripple to the button’s larger side and centres it on the click', () => {
    expect(ripplePlacement(RECT, { x: 120, y: 30 })).toEqual({ size: 72, x: -16, y: -26 })
  })

  it('falls back to the button centre for a keyboard activation', () => {
    expect(ripplePlacement(RECT, null)).toEqual({ size: 72, x: 0, y: -6 })
  })
})

describe('logout flow', () => {
  it('runs the pending state, ripple and flash immediately, before the request', () => {
    const request = vi.fn(() => Promise.resolve())
    const onStart = vi.fn()
    const onRipple = vi.fn()
    const onFlash = vi.fn()
    const navigate = vi.fn()

    const logout = createLogoutFlow({
      request,
      navigate,
      onStart,
      onRipple,
      onFlash,
    })
    logout({ clientX: 10, clientY: 10 })

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onRipple).toHaveBeenCalledTimes(1)
    expect(onFlash).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not navigate before the minimum delay when the POST resolves at once', async () => {
    const navigate = vi.fn()
    const logout = createLogoutFlow({ request: () => Promise.resolve(), navigate })

    logout()
    await vi.advanceTimersByTimeAsync(LOGOUT_MIN_MS - 1)
    expect(navigate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('still navigates after the minimum delay when the POST fails', async () => {
    const navigate = vi.fn()
    const logout = createLogoutFlow({
      request: () => Promise.reject(new Error('offline')),
      navigate,
    })

    logout()
    await vi.advanceTimersByTimeAsync(LOGOUT_MIN_MS - 1)
    expect(navigate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('navigates at the 4-second cap when the POST never settles', async () => {
    const navigate = vi.fn()
    const logout = createLogoutFlow({ request: pendingForever, navigate })

    logout()
    await vi.advanceTimersByTimeAsync(LOGOUT_FALLBACK_MS - 1)
    expect(navigate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('sends only one POST when clicked again while pending', async () => {
    const request = vi.fn(pendingForever)
    const navigate = vi.fn()
    const logout = createLogoutFlow({ request, navigate })

    logout()
    const second = logout()
    const third = logout()

    expect(second).toBeNull()
    expect(third).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(LOGOUT_FALLBACK_MS)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('skips the ripple and flash under reduced motion but keeps the delay', async () => {
    const onStart = vi.fn()
    const onRipple = vi.fn()
    const onFlash = vi.fn()
    const navigate = vi.fn()

    const logout = createLogoutFlow({
      request: () => Promise.resolve(),
      navigate,
      isReducedMotion: () => true,
      onStart,
      onRipple,
      onFlash,
    })
    logout({ clientX: 10, clientY: 10 })

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onRipple).not.toHaveBeenCalled()
    expect(onFlash).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(LOGOUT_MIN_MS - 1)
    expect(navigate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
