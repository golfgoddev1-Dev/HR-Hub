import { describe, expect, it } from 'vitest'
import { resolveScanState } from '../server/register-window.js'

const SUP_DEFAULTS = { weekday: 2, openTime: '09:00', cutoffTime: '10:00' }
const TUESDAY_0800 = new Date('2026-10-27T01:00:00Z')
const TUESDAY_0930 = new Date('2026-10-27T02:30:00Z')
const TUESDAY_1000 = new Date('2026-10-27T03:00:00Z')
const WEDNESDAY_0930 = new Date('2026-10-28T02:30:00Z')
const FRIDAY_0930 = new Date('2026-10-30T02:30:00Z')

describe('resolveScanState for the supervisor meeting', () => {
  it('returns no_session when today is not the meeting weekday', () => {
    expect(resolveScanState({
      now: WEDNESDAY_0930,
      typeCode: 'sup',
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    })).toEqual({
      state: 'no_session',
      message: 'ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล',
    })
  })

  it('returns before when now is earlier than the open time', () => {
    expect(resolveScanState({
      now: TUESDAY_0800,
      typeCode: 'sup',
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    })).toEqual({
      state: 'before',
      openTime: '09:00',
      cutoffTime: '10:00',
      message: 'ยังไม่ถึงเวลาลงทะเบียนเข้าประชุม',
    })
  })

  it('returns open with the session while inside the window', () => {
    expect(resolveScanState({
      now: TUESDAY_0930,
      typeCode: 'sup',
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    })).toEqual({
      state: 'open',
      session: { sessionDate: '2026-10-27', openTime: '09:00', cutoffTime: '10:00' },
    })
  })

  it('returns after when now equals the cutoff time', () => {
    expect(resolveScanState({
      now: TUESDAY_1000,
      typeCode: 'sup',
      meetingDefaults: SUP_DEFAULTS,
      sessions: [],
    })).toEqual({
      state: 'after',
      message: 'หมดเวลาการลงทะเบียนเข้าประชุมแล้ว',
    })
  })
})

describe('resolveScanState for the monthly meeting', () => {
  it('returns no_session when there is no session today', () => {
    expect(resolveScanState({
      now: FRIDAY_0930,
      typeCode: 'monthly',
      meetingDefaults: null,
      sessions: [
        { sessionDate: '2026-10-29', openTime: '09:00', cutoffTime: '10:00' },
      ],
    })).toEqual({
      state: 'no_session',
      message: 'ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล',
    })
  })

  it('returns open for a session today inside the window', () => {
    expect(resolveScanState({
      now: FRIDAY_0930,
      typeCode: 'monthly',
      meetingDefaults: null,
      sessions: [
        { sessionDate: '2026-10-30', openTime: '09:00', cutoffTime: '10:00' },
      ],
    })).toEqual({
      state: 'open',
      session: { sessionDate: '2026-10-30', openTime: '09:00', cutoffTime: '10:00' },
    })
  })

  it('returns no_session when the session times are null', () => {
    expect(resolveScanState({
      now: FRIDAY_0930,
      typeCode: 'monthly',
      meetingDefaults: null,
      sessions: [
        { sessionDate: '2026-10-30', openTime: null, cutoffTime: null },
      ],
    })).toEqual({
      state: 'no_session',
      message: 'ยังไม่ได้กำหนดรอบประชุม กรุณาแจ้งผู้ดูแล',
    })
  })
})
