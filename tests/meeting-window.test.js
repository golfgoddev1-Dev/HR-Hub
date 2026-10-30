import { describe, expect, it } from 'vitest'
import { buildRegisterUrl, newQrToken, validateWindow } from '../server/meeting-window.js'

describe('validateWindow', () => {
  it('accepts a valid window', () => {
    expect(validateWindow({ openTime: '08:00', cutoffTime: '09:30' })).toEqual({ ok: true })
  })

  it('rejects equal open and cutoff times', () => {
    expect(validateWindow({ openTime: '09:00', cutoffTime: '09:00' })).toEqual({
      ok: false,
      message: 'เวลาเปิดรับต้องก่อนเวลาปิดรับ',
    })
  })

  it('rejects an open time after the cutoff time', () => {
    expect(validateWindow({ openTime: '10:15', cutoffTime: '09:45' })).toEqual({
      ok: false,
      message: 'เวลาเปิดรับต้องก่อนเวลาปิดรับ',
    })
  })

  it('rejects a single-digit hour', () => {
    expect(validateWindow({ openTime: '8:00', cutoffTime: '09:30' })).toEqual({
      ok: false,
      message: 'รูปแบบเวลาไม่ถูกต้อง',
    })
  })

  it('rejects an out-of-range hour', () => {
    expect(validateWindow({ openTime: '08:00', cutoffTime: '24:00' })).toEqual({
      ok: false,
      message: 'รูปแบบเวลาไม่ถูกต้อง',
    })
  })
})

describe('buildRegisterUrl', () => {
  it('encodes the token and drops a trailing slash from the origin', () => {
    expect(buildRegisterUrl('https://hr.example.com/', 'a b+c/=')).toBe(
      'https://hr.example.com/meeting/register?t=a%20b%2Bc%2F%3D',
    )
  })

  it('builds the url without a trailing slash in the origin', () => {
    expect(buildRegisterUrl('https://hr.example.com', 'abc123')).toBe(
      'https://hr.example.com/meeting/register?t=abc123',
    )
  })

  it('throws when the origin is empty', () => {
    expect(() => buildRegisterUrl('', 'abc123')).toThrow()
    expect(() => buildRegisterUrl('   ', 'abc123')).toThrow()
  })
})

describe('newQrToken', () => {
  it('returns 64 lowercase hex characters', () => {
    expect(newQrToken()).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns a different token on each call', () => {
    expect(newQrToken()).not.toBe(newQrToken())
  })
})
