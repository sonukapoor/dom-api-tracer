/**
 * @jest-environment jsdom
 */
test('records which DOM the pinned file ran on', () => {
  expect(document.createElement('p').tagName).toBe('P');
  const log = process.env.FIXTURE_ENV_LOG;
  if (log) require('node:fs').appendFileSync(log, `jest-pinned ${navigator.userAgent}\n`);
});
