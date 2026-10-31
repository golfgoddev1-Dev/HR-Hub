// Workers entry: mounts the auth and public registration apps, exports the
// rate limiter Durable Object classes, and dispatches the two approved cron
// triggers: auto-absent every minute (Phase 4a, cheap idle path in 4c) and the
// read-only keep-alive three times a day (Phase 4b). Any other cron string is a
// silent no-op.

import app from "./app.js";
import { AUTO_ABSENT_CRON, runAutoAbsentOnce } from "./auto-absent.js";
import { KEEP_ALIVE_CRON, runKeepAlive } from "./keep-alive.js";

export {
  ContextRateLimiter,
  SubmitIpRateLimiter,
  SubmitTokenRateLimiter,
} from "./rate-limiter.js";

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    const cron = event?.cron;

    if (cron === AUTO_ABSENT_CRON) {
      const now = new Date(event.scheduledTime);
      const run = runAutoAbsentOnce(env, now).catch((error) => {
        // Code or name only: never a body, URL or environment value.
        console.error("[auto-absent-error]", error?.code ?? error?.name);
      });
      ctx.waitUntil(run);
      return;
    }

    if (cron === KEEP_ALIVE_CRON) {
      ctx.waitUntil(runKeepAlive(env));
    }
  },
};
