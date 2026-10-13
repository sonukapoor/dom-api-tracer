#!/usr/bin/env node
// Unit check of statuses.cjs (run by npm test): keys, duplicate names,
// file-level failures counted as files (not tests), merging and directions.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('./statuses.cjs');

const root = '/work/repos/proj';
const report = (files) => ({ testResults: files.map(([name, status, tests]) => ({ name: `${root}/${name}`, status, assertionResults: tests.map(([fullName, s]) => ({ fullName, status: s })) })) });

// jsdom: a.test.ts has two tests with the same full name; b.test.ts passes.
const base = S.fromResults([{ slug: 'pkg', report: report([
  ['src/a.test.ts', 'passed', [['menu opens', 'passed'], ['menu opens', 'passed'], ['menu closes', 'passed']]],
  ['src/b.test.ts', 'passed', [['b works', 'passed']]],
]) }], root);
assert.deepEqual(Object.keys(base.tests).sort(), [
  'pkg::src/a.test.ts::menu closes', 'pkg::src/a.test.ts::menu opens', 'pkg::src/a.test.ts::menu opens #2', 'pkg::src/b.test.ts::b works',
]);
assert.equal(base.tests['pkg::src/a.test.ts::menu opens #2'].file, `${root}/src/a.test.ts`);
assert.deepEqual(Object.keys(base.files).sort(), ['pkg::src/a.test.ts', 'pkg::src/b.test.ts']);

// A run where the second duplicate fails and b.test.ts fails to load (no tests).
const run = S.fromResults([{ slug: 'pkg', report: report([
  ['src/a.test.ts', 'failed', [['menu opens', 'passed'], ['menu opens', 'failed'], ['menu closes', 'passed']]],
  ['src/b.test.ts', 'failed', []],
]) }], root);
let c = S.compare(base, run, base);
// Tests: the second "menu opens" and the missing "b works"; files: both.
assert.equal(c.differs, 2, 'differs counts tests only');
assert.equal(c.filesDiffer, 2, 'files_differ counts file statuses');
assert.equal(c.falsePass, 0);
assert.equal(c.falseFail, 2);
assert.deepEqual(S.failing(run).sort(), [`${root}/src/a.test.ts`, `${root}/src/b.test.ts`]);

// A file whose status is "passed" but has a failed test counts as failed.
const quiet = S.fromResults([{ slug: 'pkg', report: report([['src/a.test.ts', 'passed', [['x', 'failed']]]]) }], root);
assert.equal(quiet.files['pkg::src/a.test.ts'].s, 'failed');

// Re-run: b.test.ts isolated passes; the merged result replaces b's file and tests.
const rerun = S.fromResults([{ slug: 'pkg', report: report([['src/b.test.ts', 'passed', [['b works', 'passed']]]]) }], root);
const merged = S.merge(run, rerun);
c = S.compare(base, merged);
assert.equal(c.differs, 1);
assert.equal(c.filesDiffer, 1);
// Leaky: failing shared, not failing isolated (b), a fails both ways.
assert.deepEqual(S.leaky(run, rerun), [`${root}/src/b.test.ts`]);
// Isolate: failing shared (a, b), and a file whose test is missing or
// changed without isolation although the file passes (c).
const iso3 = S.fromResults([{ slug: 'pkg', report: report([
  ['src/a.test.ts', 'failed', [['menu opens', 'passed'], ['menu opens', 'failed'], ['menu closes', 'passed']]],
  ['src/b.test.ts', 'passed', [['b works', 'passed']]],
  ['src/c.test.ts', 'passed', [['c1', 'passed'], ['c2', 'skipped']]],
  ['src/d.test.ts', 'passed', [['d1', 'passed']]],
]) }], root);
const shared3 = S.fromResults([{ slug: 'pkg', report: report([
  ['src/a.test.ts', 'failed', [['menu opens', 'passed'], ['menu opens', 'failed'], ['menu closes', 'passed']]],
  ['src/b.test.ts', 'failed', []],
  ['src/c.test.ts', 'passed', [['c1', 'passed']]],
  ['src/d.test.ts', 'passed', [['d1', 'passed']]],
]) }], root);
assert.deepEqual(S.isolate(shared3, iso3).sort(), ['a', 'b', 'c'].map((f) => `${root}/src/${f}.test.ts`));
// A file with no result at all without isolation (a hung or crashed worker) is isolated too.
const noD = { tests: Object.fromEntries(Object.entries(shared3.tests).filter(([k]) => !k.includes('d.test'))), files: Object.fromEntries(Object.entries(shared3.files).filter(([k]) => !k.includes('d.test'))) };
assert.ok(S.isolate(noD, iso3).includes(`${root}/src/d.test.ts`));
// Missing: files of the reference without any result (d), not those that failed.
assert.deepEqual(S.missing(noD, iso3), [`${root}/src/d.test.ts`]);
// Direction: passed in the learned run but not isolated is a false pass.
assert.deepEqual(S.direction(base, run), { falsePass: 2, falseFail: 0 });

// Without the checkout root, keys fall back to the path after the last
// packages/src/test/tests/examples directory.
assert.equal(S.relativeFile('/elsewhere/proj/packages/x/src/a.test.ts'), 'x/src/a.test.ts');
// A root given with '..' (CI: $GITHUB_WORKSPACE/../repos/<project>) still matches.
assert.equal(S.relativeFile(`${root}/packages/x/test/index.test.ts`, `${root}/packages/../`), 'packages/x/test/index.test.ts');
// Two packages' test/index.test.ts never share a key without the root either.
assert.notEqual(S.relativeFile('/w/repos/p/packages/a/test/index.test.ts'), S.relativeFile('/w/repos/p/packages/b/test/index.test.ts'));
assert.equal(S.relativeFile(`${root}/packages/x/a.test.ts`, root), 'packages/x/a.test.ts');

// Messages (--messages): the first line of a failed test's first failure,
// colors removed; a file that failed to load gets its runner message.
const withMsg = S.fromResults([{ slug: 'pkg', report: { testResults: [
  { name: `${root}/src/a.test.ts`, status: 'failed', message: '', assertionResults: [{ fullName: 'x', status: 'failed', failureMessages: ['\x1b[31mAssertionError: expected 1 to be 2\x1b[39m\n    at foo'] }, { fullName: 'y', status: 'passed', failureMessages: [] }] },
  { name: `${root}/src/b.test.ts`, status: 'failed', message: '\n  TypeError: x is not a function\n at y', assertionResults: [] },
] } }], root, { messages: true });
assert.equal(withMsg.tests['pkg::src/a.test.ts::x'].m, 'AssertionError: expected 1 to be 2');
assert.equal(withMsg.tests['pkg::src/a.test.ts::y'].m, undefined);
assert.equal(withMsg.files['pkg::src/b.test.ts'].m, 'TypeError: x is not a function');
assert.equal(base.tests['pkg::src/a.test.ts::menu opens'].m, undefined, 'no messages by default');

// Flaky exclusion: tests and files that differ between two runs of the
// same configuration are left out of the counts.
const again = S.fromResults([{ slug: 'pkg', report: report([
  ['src/a.test.ts', 'failed', [['menu opens', 'passed'], ['menu opens', 'failed'], ['menu closes', 'passed']]],
  ['src/b.test.ts', 'passed', [['b works', 'passed']]],
]) }], root);
const fl = S.flaky(base, again);
assert.deepEqual([...fl.tests], ['pkg::src/a.test.ts::menu opens #2']);
assert.deepEqual([...fl.files], ['pkg::src/a.test.ts']);
c = S.compare(base, run, null, fl);
assert.equal(c.differs, 1, 'the flaky duplicate is excluded, the missing b test is not');
assert.equal(c.filesDiffer, 1);

// jsdom-default runs of one job: the warm-up (0) differs from the others in
// one test (flaky, not broken); round 2 lost a file of 10 tests (broken by
// the median rule); round 3 has no time (broken). Only rounds 0 and 1 and
// 4 define the flaky set.
const tests = (n, f = () => 'passed') => report([['src/many.test.ts', 'passed', Array.from({ length: n }, (_, i) => [`t${i}`, f(i)])], ['src/x.test.ts', 'passed', [['x', 'passed']]]]);
const mk = (rep) => S.fromResults([{ slug: 'pkg', report: rep }], root);
const ok = mk(tests(12));
const odd = mk(tests(12, (i) => (i === 3 ? 'failed' : 'passed')));
const partial = mk({ testResults: tests(12).testResults.slice(1) });
const jr = S.jsdomRounds([{ round: '0', secs: null, map: odd }, { round: '1', secs: 40, map: ok }, { round: '2', secs: 30, map: partial }, { round: '3', secs: NaN, map: ok }, { round: '4', secs: 41, map: ok }]);
assert.deepEqual(jr.broken, ['2', '3']);
assert.deepEqual([...jr.flaky.tests], ['pkg::src/many.test.ts::t3']);
assert.deepEqual([...jr.flaky.files], ['pkg::src/many.test.ts']);

// The command line: map from results files, compare.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statuses-'));
fs.writeFileSync(path.join(dir, 'pkg.jsdom.json'), JSON.stringify(report([['src/a.test.ts', 'passed', [['menu opens', 'passed'], ['menu opens', 'passed']]]])));
fs.writeFileSync(path.join(dir, 'pkg.warpdom.json'), JSON.stringify(report([['src/a.test.ts', 'failed', [['menu opens', 'passed'], ['menu opens', 'skipped']]]])));
const cli = (...a) => execFileSync(process.execPath, [path.join(__dirname, 'statuses.cjs'), ...a], { encoding: 'utf8' }).trim();
cli('map', dir, 'jsdom', path.join(dir, 'b.json'), '--root', root);
cli('map', dir, 'warpdom', path.join(dir, 'w.json'), '--root', root);
assert.equal(cli('compare', path.join(dir, 'b.json'), path.join(dir, 'w.json'), path.join(dir, 'b.json')), '1 1 0 1');
assert.equal(cli('count', path.join(dir, 'w.json')), '2 1');
// --exclude: w vs b with the differences between b and w themselves flaky.
assert.equal(cli('compare', path.join(dir, 'b.json'), path.join(dir, 'w.json'), '--exclude', path.join(dir, 'b.json'), path.join(dir, 'w.json')), '0 0');
// jsdom-rounds and compare --flaky: b and w as two jsdom runs make w's
// differences flaky.
cli('jsdom-rounds', path.join(dir, 'jr.json'), `0:-:${path.join(dir, 'b.json')}`, `1:12.5:${path.join(dir, 'w.json')}`);
const jrOut = JSON.parse(fs.readFileSync(path.join(dir, 'jr.json'), 'utf8'));
assert.deepEqual(jrOut.broken, []);
assert.deepEqual(jrOut.flaky.tests, ['pkg::src/a.test.ts::menu opens #2']);
assert.equal(cli('compare', path.join(dir, 'b.json'), path.join(dir, 'w.json'), '--flaky', path.join(dir, 'jr.json')), '0 0');
cli('map', dir, 'warpdom', path.join(dir, 'wm.json'), '--root', root, '--messages');
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'wm.json'), 'utf8')).files['pkg::src/a.test.ts'].s, 'failed');
fs.rmSync(dir, { recursive: true, force: true });
console.log('statuses: ok');
