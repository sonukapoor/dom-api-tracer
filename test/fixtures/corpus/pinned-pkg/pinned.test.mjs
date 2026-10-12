/**
 * Pins its DOM with a comment, which Vitest reads before the config: the
 * harness must switch it like the config's environment.
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";

test("records which DOM it ran on", async () => {
  expect(document.body).toBeTruthy();
  const log = process.env.FIXTURE_ENV_LOG;
  if (log) (await import("node:fs")).appendFileSync(log, `pinned ${navigator.userAgent}\n`);
});
