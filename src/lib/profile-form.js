// Client-side rules for the profile page. The Worker is still the authority:
// these helpers only decide whether Save is enabled and what to say under a
// field before the request is sent.

export const EMPTY_EMAIL_HINT = 'ยังไม่ได้ระบุอีเมล'
export const DEPARTMENT_CHANGE_NOTE = 'การเปลี่ยนแผนกจะมีผลกับผู้อนุมัติใบลาครั้งถัดไป'
export const NAME_MAX_LENGTH = 100
export const EMAIL_MAX_LENGTH = 254

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MOBILE_PATTERN = /^0\d{9}$/

export const PROFILE_MESSAGES = {
  nameRequired: 'กรุณากรอกชื่อ-นามสกุล',
  nameTooLong: 'ชื่อ-นามสกุลยาวเกิน 100 ตัวอักษร',
  emailInvalid: 'อีเมลไม่ถูกต้อง',
  emailTooLong: 'อีเมลยาวเกิน 254 ตัวอักษร',
  phoneInvalid: 'เบอร์มือถือไม่ถูกต้อง (ต้องเป็นตัวเลข 10 หลัก เริ่มด้วย 0)',
  prefixInvalid: 'ไม่พบคำนำหน้าที่เลือก',
  departmentRequired: 'กรุณาเลือกแผนกที่ใช้งานอยู่',
  departmentInactive: 'แผนกปัจจุบันปิดใช้งาน กรุณาเลือกแผนกที่ใช้งานอยู่',
}

function text(value) {
  return typeof value === 'string' ? value : ''
}

/** Normalises whatever the API sent into the keys the page works with. */
export function readProfile(payload) {
  const source =
    payload && typeof payload.profile === 'object' && payload.profile !== null
      ? payload.profile
      : payload
  const row = source && typeof source === 'object' ? source : {}

  return {
    id: text(row.id),
    employeeCode: text(row.employeeCode),
    namePrefix: text(row.namePrefix),
    fullName: text(row.fullName),
    email: text(row.email),
    phone: text(row.phone),
    departmentId: text(row.departmentId),
    departmentName: text(row.departmentName),
    departmentActive:
      row.departmentActive === false ? false : row.departmentActive === true ? true : null,
    positionName: text(row.positionName),
    isActive: row.isActive === true,
    notifyPendingOnLogout: row.notifyPendingOnLogout !== false,
  }
}

/** The email as shown in view mode, or the "not set yet" hint. */
export function formatEmail(profile) {
  const email = text(profile?.email).trim()
  return email.length > 0 ? email : EMPTY_EMAIL_HINT
}

/** Digits of a Thai mobile number; dashes and spaces are separators. */
export function mobileDigits(value) {
  return String(value ?? '').replace(/[\s-]/g, '')
}

export function isThaiMobile(value) {
  return MOBILE_PATTERN.test(mobileDigits(value))
}

/** Prefix dropdown values: the lookup names, trimmed, without duplicates. */
export function prefixOptions(prefixes) {
  const seen = new Set()
  const options = []
  for (const value of Array.isArray(prefixes) ? prefixes : []) {
    const name = text(value).replace(/\s+/g, ' ').trim()
    if (name.length === 0 || seen.has(name)) continue
    seen.add(name)
    options.push(name)
  }
  return options
}

export function profileToForm(profile) {
  const source = readProfile(profile)
  return {
    namePrefix: source.namePrefix,
    fullName: source.fullName,
    email: source.email,
    phone: source.phone,
    departmentId: source.departmentId,
  }
}

/** Departments the dropdown may offer: active rows with an id and a name. */
export function activeDepartments(departments) {
  return (Array.isArray(departments) ? departments : [])
    .filter(
      (row) =>
        row && typeof row.id === 'string' && row.id.length > 0 && row.is_active !== false
    )
    .map((row) => ({ id: row.id, name: text(row.name) }))
}

/**
 * Dropdown entries: active departments only, plus the current department when it
 * is inactive, kept as a disabled entry so the field can show what it holds.
 */
export function departmentOptions(profile, departments) {
  const options = activeDepartments(departments).map((row) => ({ ...row, inactive: false }))
  const current = readProfile(profile)

  if (current.departmentId) {
    const exists = options.some((option) => option.id === current.departmentId)
    if (!exists) {
      // Shown so the field is never blank. An inactive current department is
      // disabled, which forces a real choice before a save can happen.
      options.push({
        id: current.departmentId,
        name: current.departmentName || 'แผนกปัจจุบัน',
        inactive: current.departmentActive === false,
      })
    }
  }

  return options
}

/**
 * The PATCH body: only changed columns, in the Worker's field names. An empty
 * email or phone becomes null, and a phone is stored as its ten digits.
 */
export function profilePatch(profile, form) {
  const current = readProfile(profile)
  const values = form && typeof form === 'object' ? form : {}
  const patch = {}

  const namePrefix = text(values.namePrefix).replace(/\s+/g, ' ').trim()
  if (namePrefix !== current.namePrefix) patch.name_prefix = namePrefix

  const fullName = text(values.fullName).replace(/\s+/g, ' ').trim()
  if (fullName !== current.fullName) patch.full_name = fullName

  const email = text(values.email).trim()
  const emailTarget = email.length > 0 ? email : null
  if (emailTarget !== (current.email || null)) patch.email = emailTarget

  const phone = mobileDigits(text(values.phone))
  const phoneTarget = phone.length > 0 ? phone : null
  if (phoneTarget !== (mobileDigits(current.phone) || null)) patch.phone = phoneTarget

  const departmentId = text(values.departmentId)
  if (departmentId.length > 0 && departmentId !== current.departmentId) {
    patch.department_id = departmentId
  }

  return patch
}

/** Save is offered only when something really changed. */
export function hasProfileChanges(profile, form) {
  return Object.keys(profilePatch(profile, form)).length > 0
}

/**
 * Field-level checks before the request. A department only has to be in the
 * active list when it is being changed, so a failed department fetch cannot
 * block an email edit; an unchanged inactive department is an error, because
 * the Worker refuses to save it.
 */
export function validateProfileForm(profile, form, departments = [], prefixes = []) {
  const current = readProfile(profile)
  const values = form && typeof form === 'object' ? form : {}
  const errors = {}

  // Empty is allowed: an employee without a prefix is not forced to add one,
  // and an unchanged value is never sent. A typed value must be a lookup value.
  const namePrefix = text(values.namePrefix).replace(/\s+/g, ' ').trim()
  const availablePrefixes = prefixOptions(prefixes)
  if (namePrefix.length > 0 && availablePrefixes.length > 0 && !availablePrefixes.includes(namePrefix)) {
    errors.namePrefix = PROFILE_MESSAGES.prefixInvalid
  }

  const fullName = text(values.fullName).replace(/\s+/g, ' ').trim()
  if (fullName.length === 0) errors.fullName = PROFILE_MESSAGES.nameRequired
  else if (Array.from(fullName).length > NAME_MAX_LENGTH) {
    errors.fullName = PROFILE_MESSAGES.nameTooLong
  }

  const email = text(values.email).trim()
  if (email.length > 0) {
    if (email.length > EMAIL_MAX_LENGTH) errors.email = PROFILE_MESSAGES.emailTooLong
    else if (!EMAIL_PATTERN.test(email)) errors.email = PROFILE_MESSAGES.emailInvalid
  }

  const phone = text(values.phone).trim()
  if (phone.length > 0 && !isThaiMobile(phone)) errors.phone = PROFILE_MESSAGES.phoneInvalid

  const departmentId = text(values.departmentId)
  const activeIds = new Set(activeDepartments(departments).map((row) => row.id))
  if (departmentId.length === 0) {
    errors.departmentId = PROFILE_MESSAGES.departmentRequired
  } else if (departmentId === current.departmentId) {
    if (current.departmentActive === false) {
      errors.departmentId = PROFILE_MESSAGES.departmentInactive
    }
  } else if (!activeIds.has(departmentId)) {
    errors.departmentId = PROFILE_MESSAGES.departmentRequired
  }

  return { ok: Object.keys(errors).length === 0, errors }
}
