// Workers entry: mounts the auth and public registration apps, exports the
// rate limiter Durable Object classes, and dispatches the approved cron
// triggers. Auto-absent and the push queue share the every-minute expression:
// push always runs there, while auto-absent runs only when the owner sets
// AUTO_ABSENT_ENABLED to exactly "true". The read-only keep-alive runs three
// times a day (Phase 4b). Any other cron string is a silent no-op.

import app from "./app.js";
import { AUTO_ABSENT_CRON, runAutoAbsentOnce } from "./auto-absent.js";
import { KEEP_ALIVE_CRON, runKeepAlive } from "./keep-alive.js";
import { CERT_CLEANUP_CRON, runCertificateCleanup } from "./leave-retention.js";
import {
  CLEANUP_TIMEOUT_MS,
  runDataCleanup,
} from "./maintenance/cleanup.js";
import { NOTIFICATION_CRON, runNotificationQueue } from "./push/queue.js";

/** Runs both daily jobs under waitUntil, or waits a bounded time if absent. */
async function runScheduledMaintenance(ctx, job) {
  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(job);
    return;
  }

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
  });
  await Promise.race([job, timeout]).finally(() => clearTimeout(timer));
}

export {
  ContextRateLimiter,
  SubmitIpRateLimiter,
  SubmitTokenRateLimiter,
} from "./rate-limiter.js";

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    const cron = event?.cron;

    // Auto-absent is opt-in: only the exact string "true" enables it. It shares
    // the every-minute expression with the push queue, so this branch does not
    // return and cannot block the push fallback below.
    if (cron === AUTO_ABSENT_CRON && env.AUTO_ABSENT_ENABLED === "true") {
      const now = new Date(event.scheduledTime);
      const run = runAutoAbsentOnce(env, now).catch((error) => {
        // Code or name only: never a body, URL or environment value.
        console.error("[auto-absent-error]", error?.code ?? error?.name);
      });
      ctx.waitUntil(run);
    }

    if (cron === KEEP_ALIVE_CRON) {
      ctx.waitUntil(runKeepAlive(env));
      return;
    }

    // Daily maintenance. Medical certificate retention and the bounded
    // auth_sessions/audit_logs cleanup share the existing 02:00 trigger: no
    // extra cron is added. Both jobs catch their own failures, so one table
    // never blocks the other or the scheduled run.
    if (cron === CERT_CLEANUP_CRON) {
      const now = new Date(event.scheduledTime);
      await runScheduledMaintenance(
        ctx,
        Promise.all([
          runCertificateCleanup(env, now).catch((error) => {
            console.error("[cert-cleanup-error]", error?.code ?? error?.name);
          }),
          runDataCleanup(env, now).catch((error) => {
            console.error("[data-cleanup-error]", error?.code ?? error?.name);
          }),
        ])
      );
      return;
    }

    // Web Push queue (phase 3). Runs every minute on the shared trigger, but
    // only when its keys are configured, so a bare deployment does not log a
    // configuration error every minute. Safe to re-run: each row is claimed
    // with a conditional update before anything is sent.
    if (
      cron === NOTIFICATION_CRON &&
      env.VAPID_PUBLIC_KEY &&
      env.VAPID_PRIVATE_KEY &&
      env.VAPID_SUBJECT
    ) {
      const now = new Date(event.scheduledTime);
      ctx.waitUntil(
        runNotificationQueue(env, now).catch((error) => {
          console.error("[notification-cron-error]", error?.code ?? error?.name);
        })
      );
    }
  },
};
