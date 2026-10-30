export function validatePin(pin) {
  if (!/^\d{6}$/.test(pin)) {
    return { ok: false, message: 'PIN ต้องเป็นตัวเลข 6 หลัก' }
  }
  if (/^(\d)\1{5}$/.test(pin)) {
    return { ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' }
  }
  const ascending = '0123456789'.includes(pin)
  const descending = '9876543210'.includes(pin)
  if (ascending || descending) {
    return { ok: false, message: 'PIN ง่ายเกินไป กรุณาตั้งใหม่' }
  }
  return { ok: true }
}
