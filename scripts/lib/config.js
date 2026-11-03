// Node-only helper for the operator scripts (was server/config.js).

export function getRequiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing env: ${name}`)
  }
  return value
}
