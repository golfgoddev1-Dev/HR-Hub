import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextRateLimiter,
  SubmitIpRateLimiter,
  SubmitTokenRateLimiter,
  applyFixedWindow,
} from "../src/rate-limiter.js";

function cursor(rows = []) {
  return { toArray: () => rows };
}

class FakeSql {
  constructor() {
    this.row = null;
  }

  exec(query, ...params) {
    const sql = query.replace(/\s+/g, " ").trim().toUpperCase();

    if (sql.startsWith("CREATE TABLE")) return cursor();

    if (sql.startsWith("SELECT COUNT, WINDOW_START")) {
      return cursor(this.row ? [{ ...this.row }] : []);
    }

    if (sql.startsWith("INSERT INTO RATE_LIMIT")) {
      this.row = { count: Number(params[0]), window_start: Number(params[1]) };
      return cursor();
    }

    if (sql.startsWith("UPDATE RATE_LIMIT")) {
      this.row = { ...this.row, count: Number(params[0]) };
      return cursor();
    }

    throw new Error(`unexpected SQL: ${query}`);
  }
}

function storage() {
  const sql = new FakeSql();
  return { ctx: { storage: { sql } }, sql };
}

async function call(limiter) {
  const response = await limiter.fetch(
    new Request("https://rate-limit.internal/check", { method: "POST" })
  );
  return (await response.json()).success;
}

test("applyFixedWindow counts up, blocks over the limit and resets after 60s", () => {
  const sql = new FakeSql();

  assert.deepEqual(applyFixedWindow(sql, 2, 1_000), { success: true, count: 1 });
  assert.deepEqual(applyFixedWindow(sql, 2, 1_001), { success: true, count: 2 });
  assert.deepEqual(applyFixedWindow(sql, 2, 1_002), { success: false, count: 3 });
  assert.deepEqual(applyFixedWindow(sql, 2, 60_999), { success: false, count: 4 });
  assert.deepEqual(applyFixedWindow(sql, 2, 61_000), { success: true, count: 1 });
});

test("ContextRateLimiter allows 100 requests per window", async () => {
  const { ctx } = storage();
  let now = 1_000;
  const limiter = new ContextRateLimiter(ctx, {}, () => now);

  for (let i = 0; i < 100; i += 1) {
    assert.equal(await call(limiter), true, `request ${i + 1}`);
  }
  assert.equal(await call(limiter), false);

  now += 60_000;
  assert.equal(await call(limiter), true);
});

test("SubmitIpRateLimiter allows 30 requests per window", async () => {
  const { ctx } = storage();
  const limiter = new SubmitIpRateLimiter(ctx, {}, () => 1_000);

  for (let i = 0; i < 30; i += 1) {
    assert.equal(await call(limiter), true, `request ${i + 1}`);
  }
  assert.equal(await call(limiter), false);
});

test("SubmitTokenRateLimiter allows 60 requests per window", async () => {
  const { ctx } = storage();
  const limiter = new SubmitTokenRateLimiter(ctx, {}, () => 1_000);

  for (let i = 0; i < 60; i += 1) {
    assert.equal(await call(limiter), true, `request ${i + 1}`);
  }
  assert.equal(await call(limiter), false);
});

test("the limiter object rejects non-POST checks without touching storage", async () => {
  const { ctx, sql } = storage();
  const limiter = new ContextRateLimiter(ctx, {}, () => 1_000);

  const response = await limiter.fetch(new Request("https://rate-limit.internal/check"));
  assert.equal(response.status, 405);
  assert.equal(sql.row, null);
});
