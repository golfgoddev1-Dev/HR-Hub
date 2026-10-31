import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AUTO_ABSENT_CRON } from "../src/auto-absent.js";

// The deployed trigger list is a cutover decision, not an implementation detail:
// the every-minute auto-absent trigger must not reach production while the
// Express job still runs. Reading the real file keeps an accidental edit from
// passing unnoticed, and the test never touches the network or wrangler.
const CONFIG_PATH = fileURLToPath(new URL("../wrangler.toml", import.meta.url));

function cronsInConfig() {
  const text = readFileSync(CONFIG_PATH, "utf8");
  const assignment = /^\s*crons\s*=\s*\[([^\]]*)\]\s*$/m.exec(text);
  assert.notEqual(assignment, null, "wrangler.toml must assign triggers.crons");
  return [...assignment[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

function nameInConfig() {
  const text = readFileSync(CONFIG_PATH, "utf8");
  const assignment = /^\s*name\s*=\s*"([^"]*)"\s*$/m.exec(text);
  assert.notEqual(assignment, null, "wrangler.toml must assign name");
  return assignment[1];
}

// Secrets are stored per Worker name and the Pages service binding points at
// this name, so renaming the Worker silently orphans both. The owner confirmed
// hr-hub-api; the old hr-workers-spike name is only deleted after cutover.
test("wrangler.toml deploys the Worker as hr-hub-api", () => {
  assert.equal(nameInConfig(), "hr-hub-api");
});

test("wrangler.toml ships exactly the pre-cutover triggers", () => {
  assert.deepEqual(cronsInConfig(), ["0 1,9,17 * * *"]);
});

test("the every-minute trigger is implemented but not deployed", () => {
  // Cutover is one line in wrangler.toml: add this string to crons.
  assert.equal(AUTO_ABSENT_CRON, "* * * * *");
  assert.equal(cronsInConfig().includes(AUTO_ABSENT_CRON), false);
});
