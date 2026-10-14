import { test, expect } from 'vitest';
import fs from 'node:fs';

test('records its worker and environment', () => {
  expect(globalThis.__envGroupStandIn).toBe(true);
  fs.appendFileSync(process.env.FIXTURE_GROUP_LOG, 'a ' + process.pid + '\n');
});
