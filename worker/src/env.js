// Env helpers. The env object is passed in; process.env is never used.

/** Returns a required env value, or throws when it is missing or blank. */
export function getRequiredEnv(env, name) {
  const value = env ? env[name] : undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("missing env: " + name);
  }
  return value;
}
