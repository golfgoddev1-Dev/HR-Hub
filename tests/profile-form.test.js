// The profile page's rules without a browser: what the card shows, which
// departments the dropdown may offer, when Save is enabled, and what the PATCH
// body holds. The Worker still validates all of it.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  DEPARTMENT_CHANGE_NOTE,
  EMPTY_EMAIL_HINT,
  PROFILE_MESSAGES,
  activeDepartments,
  departmentOptions,
  formatEmail,
  hasProfileChanges,
  isThaiMobile,
  profilePatch,
  prefixOptions,
  profileToForm,
  readProfile,
  validateProfileForm,
} from '../src/lib/profile-form.js'

const B1_SUBTITLE =
  'แก้ไขคำนำหน้า ชื่อ-นามสกุล อีเมล เบอร์มือถือ และแผนกได้เอง · รหัสพนักงาน เลขบัตรประชาชน และตำแหน่งแก้ไขโดย HR เท่านั้น'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const ROUTE_ACCESS = readFileSync(new URL('../src/lib/route-access.js', import.meta.url), 'utf8')
const NAV_CONFIG = readFileSync(new URL('../src/lib/nav-config.js', import.meta.url), 'utf8')
const PROFILE_PAGE = readFileSync(
  new URL('../src/pages/ProfilePage.vue', import.meta.url),
  'utf8'
)

const ACTIVE_A = '22222222-2222-4222-8222-222222222222'
const ACTIVE_B = '33333333-3333-4333-8333-333333333333'
const INACTIVE = '44444444-4444-4444-8444-444444444444'

const DEPARTMENTS = [
  { id: ACTIVE_A, name: 'ฝ่ายบุคคล', is_active: true },
  { id: ACTIVE_B, name: 'ฝ่ายขาย', is_active: true },
  { id: INACTIVE, name: 'ฝ่ายเก่า', is_active: false },
]

const PROFILE = readProfile({
  profile: {
    id: 'emp-1',
    employeeCode: 'EMP-00001',
    namePrefix: 'นาย',
    fullName: 'สมชาย ทดสอบ',
    email: null,
    phone: null,
    departmentId: ACTIVE_A,
    departmentName: 'ฝ่ายบุคคล',
    departmentActive: true,
    positionName: 'เจ้าหน้าที่',
    isActive: true,
  },
})

describe('profile card', () => {
  it('shows the hint when the employee has no email yet', () => {
    expect(PROFILE.email).toBe('')
    expect(formatEmail(PROFILE)).toBe(EMPTY_EMAIL_HINT)
    expect(formatEmail({ email: '' })).toBe(EMPTY_EMAIL_HINT)
    expect(formatEmail({ email: 'somchai@example.com' })).toBe('somchai@example.com')
  })

  it('keeps the read-only values the page displays', () => {
    expect(PROFILE.employeeCode).toBe('EMP-00001')
    expect(PROFILE.positionName).toBe('เจ้าหน้าที่')
    expect(PROFILE.departmentName).toBe('ฝ่ายบุคคล')
    expect(PROFILE.departmentActive).toBe(true)
    expect('nationalId' in PROFILE).toBe(false)
  })

  it('always explains what a department change means', () => {
    expect(DEPARTMENT_CHANGE_NOTE).toBe('การเปลี่ยนแผนกจะมีผลกับผู้อนุมัติใบลาครั้งถัดไป')
    expect(PROFILE_PAGE).toContain('DEPARTMENT_CHANGE_NOTE')
  })
})

describe('department dropdown', () => {
  it('offers active departments only', () => {
    expect(activeDepartments(DEPARTMENTS).map((row) => row.name)).toEqual([
      'ฝ่ายบุคคล',
      'ฝ่ายขาย',
    ])

    const options = departmentOptions(PROFILE, DEPARTMENTS)
    expect(options.map((row) => row.name)).toEqual(['ฝ่ายบุคคล', 'ฝ่ายขาย'])
    expect(options.some((row) => row.name === 'ฝ่ายเก่า')).toBe(false)
    expect(options.every((row) => row.inactive === false)).toBe(true)
  })

  it('keeps an inactive current department visible but disabled', () => {
    const stale = readProfile({ ...PROFILE, departmentId: INACTIVE, departmentName: 'ฝ่ายเก่า', departmentActive: false })
    const options = departmentOptions(stale, DEPARTMENTS)

    const current = options.find((row) => row.id === INACTIVE)
    expect(current).toBeDefined()
    expect(current.inactive).toBe(true)
    expect(options.filter((row) => !row.inactive).map((row) => row.name)).toEqual([
      'ฝ่ายบุคคล',
      'ฝ่ายขาย',
    ])
  })
})

describe('save gating', () => {
  it('is disabled while nothing changed', () => {
    const form = profileToForm(PROFILE)

    expect(hasProfileChanges(PROFILE, form)).toBe(false)
    expect(profilePatch(PROFILE, form)).toEqual({})
    expect(validateProfileForm(PROFILE, form, DEPARTMENTS).ok).toBe(true)
  })

  it('enables after a real change and sends only that column', () => {
    const form = { ...profileToForm(PROFILE), email: 'somchai@example.com' }

    expect(hasProfileChanges(PROFILE, form)).toBe(true)
    expect(profilePatch(PROFILE, form)).toEqual({ email: 'somchai@example.com' })
  })

  it('sends an empty email or phone as null and stores the phone digits', () => {
    const withContact = readProfile({ ...PROFILE, email: 'a@b.co', phone: '0812345678' })

    expect(profilePatch(withContact, { ...profileToForm(withContact), email: '', phone: '' })).toEqual({
      email: null,
      phone: null,
    })
    expect(profilePatch(PROFILE, { ...profileToForm(PROFILE), phone: '081-234-5678' })).toEqual({
      phone: '0812345678',
    })
  })

  it('maps a department change to department_id only', () => {
    const form = { ...profileToForm(PROFILE), departmentId: ACTIVE_B }

    expect(profilePatch(PROFILE, form)).toEqual({ department_id: ACTIVE_B })
  })
})

describe('field validation', () => {
  it('accepts a Thai mobile with dashes and rejects other numbers', () => {
    expect(isThaiMobile('081-234-5678')).toBe(true)
    expect(isThaiMobile('0812345678')).toBe(true)
    expect(isThaiMobile('123456789')).toBe(false)
    expect(isThaiMobile('08123456789')).toBe(false)
    expect(isThaiMobile('6812345678')).toBe(false)
  })

  it('reports an invalid email in Thai', () => {
    const form = { ...profileToForm(PROFILE), email: 'somchai@' }
    const check = validateProfileForm(PROFILE, form, DEPARTMENTS)

    expect(check.ok).toBe(false)
    expect(check.errors.email).toBe(PROFILE_MESSAGES.emailInvalid)
    expect(PROFILE_MESSAGES.emailInvalid).toBe('อีเมลไม่ถูกต้อง')
  })

  it('reports an invalid phone and an empty name', () => {
    const form = { ...profileToForm(PROFILE), phone: '12345', fullName: '   ' }
    const check = validateProfileForm(PROFILE, form, DEPARTMENTS)

    expect(check.ok).toBe(false)
    expect(check.errors.phone).toBe(PROFILE_MESSAGES.phoneInvalid)
    expect(check.errors.fullName).toBe(PROFILE_MESSAGES.nameRequired)
  })

  it('requires an active department when the current one is inactive', () => {
    const stale = readProfile({
      ...PROFILE,
      departmentId: INACTIVE,
      departmentName: 'ฝ่ายเก่า',
      departmentActive: false,
    })
    const unchanged = validateProfileForm(stale, profileToForm(stale), DEPARTMENTS)
    expect(unchanged.ok).toBe(false)
    expect(unchanged.errors.departmentId).toBe(PROFILE_MESSAGES.departmentInactive)

    const fixed = validateProfileForm(stale, { ...profileToForm(stale), departmentId: ACTIVE_B }, DEPARTMENTS)
    expect(fixed.ok).toBe(true)
  })

  it('rejects a department id that is not in the active list', () => {
    const form = { ...profileToForm(PROFILE), departmentId: INACTIVE }
    const check = validateProfileForm(PROFILE, form, DEPARTMENTS)

    expect(check.ok).toBe(false)
    expect(check.errors.departmentId).toBe(PROFILE_MESSAGES.departmentRequired)
  })
})

describe('name prefix dropdown', () => {
  it('offers lookup values only, trimmed and without duplicates', () => {
    expect(prefixOptions(['นาย', 'นาง', ' นาย ', '', null])).toEqual(['นาย', 'นาง'])
    expect(prefixOptions(null)).toEqual([])
  })

  it('is part of the form and sent as name_prefix only when it changes', () => {
    const form = profileToForm(PROFILE)
    expect(form.namePrefix).toBe('นาย')
    expect(hasProfileChanges(PROFILE, form)).toBe(false)

    expect(profilePatch(PROFILE, { ...form, namePrefix: 'นาง' })).toEqual({
      name_prefix: 'นาง',
    })
  })

  it('reports a value outside the lookup in Thai', () => {
    const form = { ...profileToForm(PROFILE), namePrefix: 'ดร.' }
    const check = validateProfileForm(PROFILE, form, DEPARTMENTS, ['นาย', 'นาง'])

    expect(check.ok).toBe(false)
    expect(check.errors.namePrefix).toBe(PROFILE_MESSAGES.prefixInvalid)
    expect(PROFILE_MESSAGES.prefixInvalid).toBe('ไม่พบคำนำหน้าที่เลือก')
  })

  it('leaves an empty prefix alone: nothing is sent and no error is raised', () => {
    const noPrefix = readProfile({ ...PROFILE, namePrefix: null })
    const form = profileToForm(noPrefix)

    expect(form.namePrefix).toBe('')
    expect(profilePatch(noPrefix, form)).toEqual({})
    expect(validateProfileForm(noPrefix, form, DEPARTMENTS, ['นาย', 'นาง']).ok).toBe(true)
  })
})

describe('position row', () => {
  it('is hidden when the employee has no position', () => {
    const withoutPosition = readProfile({ ...PROFILE, positionName: null })
    expect(withoutPosition.positionName).toBe('')
    expect(PROFILE_PAGE).toContain('v-if="profile.positionName"')
    expect(PROFILE_PAGE).not.toContain("profile.positionName || '—'")
  })
})

describe('page wiring', () => {
  it('describes the real edit rules in the subtitle', () => {
    expect(PROFILE_PAGE).toContain(B1_SUBTITLE)
    expect(PROFILE_PAGE).toContain('/api/profile/name-prefixes')
    expect(PROFILE_PAGE).toContain('เลือกคำนำหน้า')
  })

  it('is reachable for the employee role and linked from the leave menu', () => {
    expect(ROUTER).toContain("path: '/profile'")
    expect(ROUTER).toContain('ProfilePage')
    expect(ROUTE_ACCESS).toContain("'/profile'")
    expect(NAV_CONFIG).toContain("to: '/profile'")
    expect(NAV_CONFIG).toContain('ข้อมูลส่วนตัว')
  })

  it('is content only, with the leave dock supplied by the layout route', () => {
    expect(PROFILE_PAGE).not.toContain('LeaveLayout')
    expect(PROFILE_PAGE).not.toContain('<AppDock')
    expect(PROFILE_PAGE).toContain('hasProfileChanges')
    expect(PROFILE_PAGE).toContain('onBeforeRouteLeave')
    expect(PROFILE_PAGE).not.toContain('localStorage')
    expect(PROFILE_PAGE).not.toContain('sessionStorage')
  })
})
