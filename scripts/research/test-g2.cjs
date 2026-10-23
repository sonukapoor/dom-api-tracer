#!/usr/bin/env node
// Check of g2-report.cjs (run by npm test): candidate G2 violations of
// shuffled runs against the isolated references, their classification by
// the confirm runs and the runs' order rows, the file order before a
// candidate, the distinct orders per configuration and the candidates'
// files; and learned-emulation.sh's LEARN_SHARED_ARGS (the shuffle only in
// the shared part of a learned run).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadProject, analyse } = require('./g2-report.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2-'));
const D = path.join(dir, 'proj');
fs.mkdirSync(D);
const ROOT = '/repos/proj';
const abs = (f) => `${ROOT}/${f}.test.ts`;
// map({ a: 'passed', ... }): one test "t" per file; undefined leaves the file out.
const map = (st) => {
  const m = { tests: {}, files: {} };
  for (const [f, s] of Object.entries(st)) {
    if (!s) continue;
    m.tests[`root::${f}.test.ts::t`] = { s, file: abs(f) };
    m.files[`root::${f}.test.ts`] = { s: s === 'failed' ? 'failed' : 'passed', file: abs(f) };
  }
  return m;
};
const write = (name, m) => fs.writeFileSync(path.join(D, `${name}.json`), JSON.stringify(m));
const order = (name, rows) =>
  fs.writeFileSync(
    path.join(D, `${name}.order.jsonl`),
    rows.map((r, i) => JSON.stringify({ main: 1, t: 1000 + i, ...r, file: abs(r.file) })).join('\n') + '\n',
  );

// a: never passes isolated, passes shared after c in seed 1 only -> leak-induced, some orders.
// b: skipped isolated, passes shared in both seeds, passes in a confirm run -> nondeterministic.
// c: passes in one reference -> not a candidate.
// d: fails isolated; passes in the learned run, where its result came from an isolated run -> nondeterministic.
// e: missing isolated (the file did not load), passes shared in both seeds; no confirm result -> unconfirmed.
write('iso-1', map({ a: 'failed', b: 'skipped', c: 'passed', d: 'failed' }));
write('iso-2', map({ a: 'failed', b: 'skipped', c: 'failed', d: 'failed' }));
write('shared-s1', map({ a: 'passed', b: 'passed', c: 'passed', d: 'failed', e: 'passed' }));
write('shared-s2', map({ a: 'failed', b: 'passed', c: 'passed', d: 'failed', e: 'passed' }));
write('learned-s1', map({ a: 'failed', b: 'skipped', c: 'passed', d: 'passed' }));
write('confirm-1', map({ a: 'failed', b: 'passed' }));
write('confirm-2', map({ a: 'failed', b: 'skipped' }));
order('shared-s1', [
  { file: 'c', worker: '1:1', isolate: false, seq: 1 },
  { file: 'b', worker: '1:2', isolate: false, seq: 1 },
  { file: 'a', worker: '1:1', isolate: false, seq: 2 },
  { file: 'e', worker: '1:2', isolate: false, seq: 2 },
  { file: 'd', worker: '1:1', isolate: false, seq: 3 },
]);
order('shared-s2', [
  { file: 'a', worker: '1:1', isolate: false, seq: 1 },
  { file: 'e', worker: '1:2', isolate: false, seq: 1 },
  { file: 'c', worker: '1:1', isolate: false, seq: 2 },
  { file: 'b', worker: '1:2', isolate: false, seq: 2 },
  { file: 'd', worker: '1:1', isolate: false, seq: 3 },
]);
// The learned run: a, b, c shared; d isolated (the split's isolated part).
order('learned-s1', [
  { file: 'a', worker: '1:1', isolate: false, seq: 1 },
  { file: 'b', worker: '1:1', isolate: false, seq: 2 },
  { file: 'c', worker: '1:2', isolate: false, seq: 1 },
  { main: 2, file: 'd', worker: '7:1', isolate: true, seq: 1 },
]);
fs.writeFileSync(
  path.join(D, 'runs.csv'),
  'label,kind,seed,seconds,status\niso-1,iso,,10,ok\nshared-s1,shared,1,5,ok\nlearned-s1,learned,1,6,ok\nshared-s2,shared,2,5,ok\nlearned-s2,learned,2,NA,failed\niso-2,iso,,10,ok\n',
);
fs.writeFileSync(path.join(D, 'method'), 'cli\n');

const r = analyse(loadProject(D));
assert.equal(r.root, ROOT, 'the checkout from the maps');
assert.equal(r.tests, 4, 'tests of the references');
assert.equal(r.isoRuns, 2);
assert.equal(r.confirmRuns, 2);
const s = r.kinds.shared,
  l = r.kinds.learned;
assert.deepEqual(s.seeds, [1, 2]);
assert.equal(s.orders, 2, 'two seeds, two distinct orders');
const byKey = (k) => Object.fromEntries(k.candidates.map((c) => [c.key.split('::')[1], c]));
const sc = byKey(s);
assert.deepEqual(
  Object.keys(sc).sort(),
  ['a.test.ts', 'b.test.ts', 'e.test.ts'],
  'c passes in a reference; d never passes shared',
);
assert.equal(s.runCandidates, 5, 'test x seed: a once, b and e twice');
assert.equal(sc['a.test.ts'].class, 'leak-induced');
assert.equal(sc['a.test.ts'].orders, 'some orders', 'a passes in one of two seeds');
assert.deepEqual(
  sc['a.test.ts'].perSeed[0].order,
  { worker: '1:1', files: ['c.test.ts', 'a.test.ts'] },
  'the files its worker ran up to it',
);
assert.deepEqual(sc['a.test.ts'].iso, ['failed', 'failed']);
assert.equal(sc['b.test.ts'].class, 'nondeterministic', 'passes in a confirm run');
assert.equal(sc['e.test.ts'].class, 'unconfirmed', 'no confirm result');
assert.deepEqual(sc['e.test.ts'].iso, ['missing', 'missing']);
assert.deepEqual(s.byClass, { 'leak-induced': 1, nondeterministic: 1, unconfirmed: 1 });
const lc = byKey(l);
assert.deepEqual(Object.keys(lc), ['d.test.ts']);
assert.equal(lc['d.test.ts'].class, 'nondeterministic', 'its passing result came from an isolated run');
assert.equal(lc['d.test.ts'].perSeed[0].order, null);
assert.deepEqual(l.failedSeeds, [2], 'a learned seed without a result');
assert.deepEqual(l.sharedFiles, [3]);

// The candidates' files (for the confirm runs), and the Markdown report.
const files = execFileSync(process.execPath, [path.join(__dirname, 'g2-report.cjs'), 'files', D], { encoding: 'utf8' })
  .trim()
  .split(' ')
  .sort();
assert.deepEqual(files, ['a', 'b', 'd', 'e'].map(abs));
const md = execFileSync(
  process.execPath,
  [path.join(__dirname, 'g2-report.cjs'), dir, '--json', path.join(dir, 'g2.json')],
  { encoding: 'utf8' },
);
assert.match(
  md,
  /\| proj \| cli \| 2 \| 2 \| 4 \| 2 \(2\) \| 3 \(5\) \| 1 \/ 1 \/ 1 \| 1 \(\+1 failed\) \(1\) \| 3 \| 1 \(1\) \| 0 \/ 1 \/ 0 \|/,
);
assert.match(md, /class: \*\*leak-induced\*\* \(some orders\)/);
assert.match(md, /seed 1, worker 1:1, 2 file\(s\) up to it: `c\.test\.ts` -> `a\.test\.ts`/);
assert.match(md, /seed 1: the result came from an isolated run of the file/);
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'g2.json'), 'utf8'))[0].name, 'proj');

// learned_run (the emulation) with LEARN_SHARED_ARGS: only the shared part
// gets them. run/status_map are stand-ins, as in test-learned.cjs.
{
  const T = path.join(dir, 'emu');
  fs.mkdirSync(T);
  const st = path.join(T, 'state');
  fs.writeFileSync(path.join(T, 'fast.json'), JSON.stringify(map({ a: 'passed' })));
  fs.writeFileSync(path.join(T, 'iso.json'), JSON.stringify(map({ b: 'passed' })));
  for (const [k, v] of [
    ['isolate', abs('b')],
    ['leaky', ''],
    ['mode', 'split'],
    ['tiso', '100'],
  ])
    fs.writeFileSync(`${st}.${k}`, `${v}\n`);
  fs.writeFileSync(`${st}.reference.json`, JSON.stringify(map({ a: 'passed', b: 'passed' })));
  const script = `
    T=${JSON.stringify(T)}; S=$T; E=$T; p=proj; REPOS_DIR=/; RESEARCH_DIR=${JSON.stringify(__dirname)}; jsonl=$T/l.jsonl; first="--first-setup reset.js"
    source "$RESEARCH_DIR/learned-emulation.sh"
    echo 0 > $T/n
    run() { echo "$*" >> $T/runs; echo 10; }
    na() { :; }
    add() { echo "$1 + $2" | bc; }
    excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
    count() { echo $#; }
    nodex() { node "$@"; }
    statuses() { node "$RESEARCH_DIR/statuses.cjs" "$@"; }
    status_map() { local n; n=$(cat $T/n); [ $n = 0 ] && cp $T/fast.json "$3" || cp $T/iso.json "$3"; echo $((n + 1)) > $T/n; }
    LEARN_SHARED_ARGS="--sequence.shuffle.files --sequence.seed=3" learned_run 1 $T/out.json $T/state`;
  execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  const runs = fs.readFileSync(path.join(T, 'runs'), 'utf8').trim().split('\n');
  assert.match(
    runs[0],
    /--extra-args --no-isolate --exclude \/repos\/proj\/b\.test\.ts +--sequence\.shuffle\.files --sequence\.seed=3 --first-setup reset\.js$/,
    'the shared part shuffled',
  );
  assert.ok(!/sequence/.test(runs[1]), 'the isolated part not');
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('g2: ok');
