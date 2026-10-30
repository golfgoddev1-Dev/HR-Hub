import { describe, expect, it } from 'vitest'
import {
  isDueSession,
  isSkipDate,
  missingEmployees,
  shouldEnsureSupSession,
} from '../server/auto-absent.js'

describe('isDueSession', () => {
  it('is not due before the cutoff', () => {
    expect(
      isDueSession({
        now: new Date('2026-10-27T03:00:00Z'),
        cutoffTime: '10:30',
        sessionDate: '2026-10-27',
        todayKey: '2026-10-27',
      }),
    ).toBe(false)
  })

  it('is due at the cutoff', () => {
    expect(
      isDueSession({
        now: new Date('2026-10-27T03:30:00Z'),
        cutoffTime: '10:30',
        sessionDate: '2026-10-27',
        todayKey: '2026-10-27',
      }),
    ).toBe(true)
  })

  it('is due after the cutoff on the same day', () => {
    expect(
      isDueSession({
        now: new Date('2026-10-27T06:00:00Z'),
        cutoffTime: '10:30',
        sessionDate: '2026-10-27',
        todayKey: '2026-10-27',
      }),
    ).toBe(true)
  })

  it('is not due when the cutoff was more than 48 hours ago', () => {
    expect(
      isDueSession({
        now: new Date('2026-10-27T03:30:00Z'),
        cutoffTime: '10:30',
        sessionDate: '2026-10-24',
        todayKey: '2026-10-27',
      }),
    ).toBe(false)
  })

  it('is not due for an invalid cutoff time', () => {
    expect(
      isDueSession({
        now: new Date('2026-10-27T06:00:00Z'),
        cutoffTime: '-',
        sessionDate: '2026-10-27',
        todayKey: '2026-10-27',
      }),
    ).toBe(false)
  })
})

describe('missingEmployees', () => {
  it('keeps roster order and drops attended employees', () => {
    expect(missingEmployees(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['b', 'd'])
  })

  it('returns an empty list when everyone attended', () => {
    expect(missingEmployees(['a'], ['a'])).toEqual([])
  })

  it('handles an empty roster', () => {
    expect(missingEmployees([], ['a'])).toEqual([])
  })
})

describe('isSkipDate', () => {
  it('is true only for a listed date', () => {
    const skipDates = new Set(['2026-10-27'])
    expect(isSkipDate('2026-10-27', skipDates)).toBe(true)
    expect(isSkipDate('2026-10-20', skipDates)).toBe(false)
    expect(isSkipDate('2026-10-27', [])).toBe(false)
  })
})

describe('shouldEnsureSupSession', () => {
  it('is true on the sup weekday at or after the default cutoff', () => {
    expect(
      shouldEnsureSupSession({
        now: new Date('2026-10-27T03:30:00Z'),
        weekday: 2,
        cutoffTime: '10:30',
        todayKey: '2026-10-27',
        skipDateSet: new Set(),
      }),
    ).toBe(true)
  })

  it('is false before the default cutoff', () => {
    expect(
      shouldEnsureSupSession({
        now: new Date('2026-10-27T03:00:00Z'),
        weekday: 2,
        cutoffTime: '10:30',
        todayKey: '2026-10-27',
        skipDateSet: new Set(),
      }),
    ).toBe(false)
  })

  it('is false on a skip date', () => {
    expect(
      shouldEnsureSupSession({
        now: new Date('2026-10-27T03:30:00Z'),
        weekday: 2,
        cutoffTime: '10:30',
        todayKey: '2026-10-27',
        skipDateSet: new Set(['2026-10-27']),
      }),
    ).toBe(false)
  })

  it('is false on a day that is not the sup weekday', () => {
    expect(
      shouldEnsureSupSession({
        now: new Date('2026-10-26T03:30:00Z'),
        weekday: 2,
        cutoffTime: '10:30',
        todayKey: '2026-10-26',
        skipDateSet: new Set(),
      }),
    ).toBe(false)
  })
})
