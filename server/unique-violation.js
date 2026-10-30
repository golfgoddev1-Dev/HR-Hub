export function isUniqueViolation(err) {
  return err?.code === '23505'
}
