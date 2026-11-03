import { describe, expect, it } from 'vitest'
import { shouldStartRun } from '../server/auto-absent-job.js'

const WINDOW_MS = 10 * 60 * 1000

describe('shouldStartRun', () => {
  it('does not start a run within 10 minutes of the last start', () => {
    const lastStartedAt = 1_000_000

    expect(shouldStartRun({ now: lastStartedAt + 1, lastStartedAt, running: false })).toBe(false)
    expect(
      shouldStartRun({ now: lastStartedAt + 5 * 60 * 1000, lastStartedAt, running: false }),
    ).toBe(false)
    expect(
      shouldStartRun({ now: lastStartedAt + WINDOW_MS - 1, lastStartedAt, running: false }),
    ).toBe(false)
  })

  it('starts a run after 10 minutes have passed', () => {
    const lastStartedAt = 1_000_000

    expect(
      shouldStartRun({ now: lastStartedAt + WINDOW_MS, lastStartedAt, running: false }),
    ).toBe(true)
    expect(
      shouldStartRun({ now: lastStartedAt + WINDOW_MS + 1, lastStartedAt, running: false }),
    ).toBe(true)
  })

  it('does not start another run while one is in progress', () => {
    const lastStartedAt = 1_000_000

    expect(shouldStartRun({ now: lastStartedAt, lastStartedAt, running: true })).toBe(false)
    expect(
      shouldStartRun({ now: lastStartedAt + WINDOW_MS * 3, lastStartedAt, running: true }),
    ).toBe(false)
  })

  it('starts the first run when nothing has been started yet', () => {
    expect(shouldStartRun({ now: 1_000_000, lastStartedAt: 0, running: false })).toBe(true)
  })
})
