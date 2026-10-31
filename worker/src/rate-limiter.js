// SQLite-backed fixed-window rate limiters for Workers Free.
//
// Each key gets its own Durable Object, so the counter is authoritative across
// Cloudflare locations. The object stores one row: the count and the start of
// the current 60-second window. No stable identifiers are stored in the row.
//
// The classes are intentionally plain (not extending DurableObject) so the
// window logic can be exercised with a fake SQLite storage in Node tests.

const WINDOW_MS = 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )
`;

/**
 * Increments the fixed-window counter and reports whether this request is
 * allowed. Reads and writes are synchronous, and a Durable Object handles one
 * event at a time, so the read-modify-write pair cannot interleave.
 */
export function applyFixedWindow(sql, limit, nowMs = Date.now(), windowMs = WINDOW_MS) {
  const rows = sql.exec("SELECT count, window_start FROM rate_limit WHERE id = 1").toArray();
  const current = rows[0];

  let count;
  if (!current || nowMs - Number(current.window_start) >= windowMs) {
    count = 1;
    sql.exec(
      "INSERT INTO rate_limit (id, count, window_start) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET count = excluded.count, window_start = excluded.window_start",
      count,
      nowMs
    );
  } else {
    count = Number(current.count) + 1;
    sql.exec("UPDATE rate_limit SET count = ? WHERE id = 1", count);
  }

  return { success: count <= limit, count };
}

class SqliteFixedWindowLimiter {
  constructor(ctx, env, limit, now) {
    this.ctx = ctx;
    this.env = env;
    this.limit = limit;
    this.now = now;
    ctx.storage.sql.exec(SCHEMA).toArray();
  }

  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const result = applyFixedWindow(this.ctx.storage.sql, this.limit, this.now());
    return Response.json({ success: result.success });
  }
}

export class ContextRateLimiter extends SqliteFixedWindowLimiter {
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 100, now);
  }
}

export class SubmitIpRateLimiter extends SqliteFixedWindowLimiter {
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 30, now);
  }
}

export class SubmitTokenRateLimiter extends SqliteFixedWindowLimiter {
  constructor(ctx, env, now = () => Date.now()) {
    super(ctx, env, 60, now);
  }
}
