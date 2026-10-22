#!/usr/bin/env node
// Check of timing-report.cjs's baseline handling (run by npm test): a
// broken jsdom round leaves out that round only, and with --pertest the
// differences are counted against the round's jsdom-default run, raw and
// without the flaky tests (those changing between jsdom-default runs).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-'));
const map = (failed = []) => {
  const tests = {}, files = { 'p::a.test.ts': { s: failed.length ? 'failed' : 'passed', file: '/a.test.ts' } };
  for (let i = 0; i < 10; i++) tests[`p::a.test.ts::t${i}`] = { s: failed.includes(i) ? 'failed' : 'passed', file: '/a.test.ts' };
  return { tests, files };
};
const put = (round, cfg, m) => {
  fs.mkdirSync(path.join(dir, 'pt', String(round), 'm'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pt', String(round), 'm', `${cfg}.json`), JSON.stringify(m));
};
// The warm-up's jsdom run fails t3 (the odd one out); warpdom fails t3 and t5
// in every round; round 2's jsdom run has no time.
put(0, 'jsdom-default', map([3]));
put(0, 'warpdom-default', map([3, 5]));
const csv = ['round,project,config,seconds,differs,files_differ,ref'];
for (let r = 1; r <= 4; r++) {
  put(r, 'jsdom-default', map());
  put(r, 'warpdom-default', map([3, 5]));
  csv.push(`${r},m,jsdom-default,${r === 2 ? 'NA' : 100},1,1,baseline`, `${r},m,warpdom-default,50,2,1,round`);
}
fs.writeFileSync(path.join(dir, 't.csv'), csv.join('\n') + '\n');
const report = (...a) => execFileSync(process.execPath, [path.join(__dirname, 'timing-report.cjs'), path.join(dir, 't.csv'), ...a], { encoding: 'utf8' });
const row = (text) => text.split('\n').find((l) => l.startsWith('| m'));

// Without --pertest: round 2 left out, the suite kept (3 rounds).
let out = report();
assert.match(row(out), /^\| m \| 3 \| 100\.0 s \| 50\.0 s \|.*\| 2\.00x \|.*\| 2 \/ — \/ — \|$/);
assert.match(out, /m: jsdom round 2 of 4 broken .*left out/);
// With --pertest: t3 is flaky (the warm-up), so 2 raw, 1 without flaky.
out = report('--pertest', path.join(dir, 'pt'));
assert.match(row(out), /^\| m \| 3 \|.*\| 2 \(1\) \/ — \/ — \|$/);
assert.match(out, /Flaky tests per suite .*, not differences: m 1\./);
fs.rmSync(dir, { recursive: true, force: true });
console.log('timing: ok');
