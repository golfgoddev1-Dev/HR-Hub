// Server-Timing on every API response: one number per request (total handler
// time in milliseconds) so a slow route can be measured from the browser's
// network panel or a Worker log later. It contains no user data, no PIN and no
// national ID, only the duration.

const HEADER = "Server-Timing";

export async function addServerTiming(c, next) {
  const started = performance.now();
  await next();

  const durationMs = Math.round((performance.now() - started) * 10) / 10;
  c.header(HEADER, `total;dur=${durationMs}`);
}
