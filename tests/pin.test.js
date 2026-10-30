import { describe, expect, it } from 'vitest'
import { validatePin } from '../server/pin.js'

describe('validatePin', () => {
  it('accepts a six-digit PIN that is not a simple sequence', () => {
    expect(validatePin('482915')).toEqual({ ok: true })
  })

  it('rejects a five-digit PIN', () => {
    expect(validatePin('48291')).toEqual({ ok: false, message: 'PIN ต้องเป็นตัวเลข 6 หลัก' })
  })

  it('rejects letters', () => {
    expect(validatePin('12a456')).toEqual({ ok: false, message: 'PIN ต้องเป็นตัวเลข 6 หลัก' })
  })

  it('rejects six repeated digits', () => {
    expect(validatePin('111111')).toEqual({ ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' })
  })

  it('rejects ascending sequential digits', () => {
    expect(validatePin('123456')).toEqual({ ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' })
  })

  it('rejects descending sequential digits', () => {
    expect(validatePin('654321')).toEqual({ ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' })
  })

  it('rejects zero repeated six times', () => {
    expect(validatePin('000000')).toEqual({ ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' })
  })
})
