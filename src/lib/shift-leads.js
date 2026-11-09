// Department shift leads: at most two per department, each with a label of 1 to
// 30 characters after trimming, unique inside the department (case-insensitive).
// These helpers hold no Vue state, so the rules can be tested without mounting
// the section. The Worker re-checks everything.

export const SHIFT_LEADS_LIMIT = 2
export const SHIFT_LABEL_MAX_LENGTH = 30

export const SHIFT_LABEL_REQUIRED = 'กรุณากรอกชื่อกะ'
export const SHIFT_LABEL_TOO_LONG = `ชื่อกะต้องไม่เกิน ${SHIFT_LABEL_MAX_LENGTH} ตัวอักษร`
export const SHIFT_LABEL_DUPLICATE = 'ชื่อกะซ้ำกันในแผนกนี้'
export const SHIFT_LEAD_EMAIL_WARNING = 'พนักงานคนนี้ไม่มีอีเมล จะไม่ได้รับแจ้งเตือน'
export const SHIFT_LEADS_ADD_LABEL = 'เพิ่มหัวหน้ากะ'
export const SHIFT_LEADS_SAVE_LABEL = 'บันทึกหัวหน้ากะ'

/** Collapse whitespace runs, then trim: what the Worker stores. */
export function normalizeShiftLabel(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Code points, so Thai text is counted the way it reads. */
export function shiftLabelLength(value) {
  return Array.from(normalizeShiftLabel(value)).length
}

/** '' when usable, otherwise the message to show beside the input. */
export function shiftLabelError(value) {
  const label = normalizeShiftLabel(value)
  if (label.length === 0) return SHIFT_LABEL_REQUIRED
  if (Array.from(label).length > SHIFT_LABEL_MAX_LENGTH) return SHIFT_LABEL_TOO_LONG
  return ''
}

/** True when two labels collide after trimming, ignoring case. */
export function hasDuplicateShiftLabels(labels) {
  const list = Array.isArray(labels) ? labels : []
  const seen = new Set()
  for (const value of list) {
    const key = normalizeShiftLabel(value).toLocaleLowerCase('th')
    if (key.length === 0) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function shiftLeadsPath(departmentId) {
  return `/api/hr/departments/${encodeURIComponent(String(departmentId ?? ''))}/shift-leads`
}

/** The PUT body: only the fields the Worker accepts. */
export function shiftLeadPayload(rows) {
  const list = Array.isArray(rows) ? rows : []
  return {
    leads: list.map((row) => ({
      employeeId: row?.employee?.id ?? '',
      shiftLabel: normalizeShiftLabel(row?.shiftLabel),
    })),
  }
}

/** One API row -> the editable row shape this section keeps in memory. */
export function shiftLeadRowFromApi(row) {
  return {
    employee: row?.employeeId
      ? {
          id: row.employeeId,
          employeeCode: row.employeeCode ?? null,
          fullName: row.employeeName ?? null,
          namePrefix: null,
          hasEmail: row.hasEmail !== false,
        }
      : null,
    shiftLabel: typeof row?.shiftLabel === 'string' ? row.shiftLabel : '',
  }
}

/** A chosen person from the directory: the warning needs hasEmail only. */
export function shiftLeadEmployee(person) {
  if (!person || typeof person.id !== 'string') return null
  return {
    id: person.id,
    employeeCode: person.employeeCode ?? null,
    fullName: person.fullName ?? null,
    namePrefix: person.namePrefix ?? null,
    departmentId: person.departmentId ?? null,
    hasEmail: person.hasEmail !== false,
  }
}
