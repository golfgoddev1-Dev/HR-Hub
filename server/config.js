export function getRequiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing env: ${name}`)
  }
  return value
}
