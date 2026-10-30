export const STATUS_CODE_BY_LABEL = {
  'เข้าร่วมประชุม': 'attended',
  'ไม่เข้าร่วม': 'not_attended',
  'ติดงานด่วน': 'urgent_busy',
  'ลาประชุม': 'leave',
}

export function statusCodeFromLabel(label) {
  if (typeof label !== 'string') return null
  return STATUS_CODE_BY_LABEL[label] ?? null
}
