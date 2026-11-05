// Workers entry: mounts the auth and public registration apps, exports the
// rate limiter Durable Object classes, and dispatches the approved cron
// triggers. The every-minute trigger now belongs to the push queue; auto-absent
// shares that expression but stays behind AUTO_ABSENT_ENABLED until the Express
// job is off. The read-only keep-alive runs three times a day (Phase 4b). Any
// other cron string is a silent no-op.

import app from "./app.js";
import { AUTO_ABSENT_CRON, runAutoAbsentOnce } from "./auto-absent.js";
import { KEEP_ALIVE_CRON, runKeepAlive } from "./keep-alive.js";
import { CERT_CLEANUP_CRON, runCertificateCleanup } from "./leave-retention.js";
import { NOTIFICATION_CRON, runNotificationQueue } from "./push/queue.js";

export {
  ContextRateLimiter,
  SubmitIpRateLimiter,
  SubmitTokenRateLimiter,
} from "./rate-limiter.js";

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    const cron = event?.cron;

    // Auto-absent shares "* * * * *" with the push queue. It is gated by an
    // explicit switch so adding the every-minute trigger for push delivery does
    // not start a second attendance writer while the Express job still runs.
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

    // Medical certificate retention. Separate from auto-absent and keep-alive:
    // it only deletes Storage objects past the configured age, then clears the
    // column, and is safe to re-run.
    if (cron === CERT_CLEANUP_CRON) {
      const now = new Date(event.scheduledTime);
      ctx.waitUntil(
        runCertificateCleanup(env, now).catch((error) => {
          console.error("[cert-cleanup-error]", error?.code ?? error?.name);
        })
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
