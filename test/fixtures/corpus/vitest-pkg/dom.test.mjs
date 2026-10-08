import { describe, test, expect } from 'vitest';

test('project setup files still run', () => {
  expect(globalThis.__fixtureSetupRan).toBe(true);
});

test('builds a list', () => {
  const ul = document.createElement('ul');
  ul.appendChild(document.createElement('li'));
  document.body.appendChild(ul);
  expect(document.querySelectorAll('li')).toHaveLength(1);
});

// A describe block makes suites outnumber files, so the file count is checked.
describe("corpus options", () => {
  test("package env from the corpus file is set", () => {
    expect(process.env.FIXTURE_ENV).toBe("from-corpus");
  });
});

test("records which DOM it ran on", async () => {
  const log = process.env.FIXTURE_ENV_LOG;
  if (log) (await import("node:fs")).appendFileSync(log, `vitest ${navigator.userAgent}\n`);
});
