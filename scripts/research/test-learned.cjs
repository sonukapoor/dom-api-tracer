#!/usr/bin/env node
// Unit check of learned-emulation.sh's decision rule (run by npm test):
// the margin, the feedback, the deadlines and the set helpers, as in
// warpdom's src/vitest-fast-cli.js. Missing results counting as failures
// is statuses.cjs isolate (test-statuses.cjs).
const assert = require('assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const sh = (cmd) => execFileSync('bash', ['-c', `first=""; source ${JSON.stringify(path.join(__dirname, 'learned-emulation.sh'))}; ${cmd}`], { encoding: 'utf8' }).trim();
assert.equal(sh('beats 100 94.9'), '1', 'split beats isolated by more than 5%');
assert.equal(sh('beats 100 95'), '0', 'a 5% gain is within the margin');
assert.equal(sh('beats 100 100'), '0');
assert.equal(sh('beats 4 3.6'), '0', 'and by at least 0.5 s');
assert.equal(sh('beats 4 3.4'), '1');
assert.equal(sh('keeps 100 99'), '1', 'a split run faster than t_iso stays split');
assert.equal(sh('keeps 100 100'), '0');
assert.equal(Number(sh('dl_min 100 1.25 10')), 2.25, 'learning deadline: 1.25 x t_iso + 10 s, in minutes');
assert.equal(Number(sh('dl_min 100 1.5 30')), 3, 'run deadline: 1.5 x t_iso + 30 s');
assert.equal(sh('minus "a b c" "b"'), 'a c');
assert.equal(sh('union "a" "c a"'), 'a c');
assert.equal(sh('echo "$LENV|$LFIRST"'), 'warpdom|');
assert.equal(execFileSync('bash', ['-c', `first="--first-setup x"; LEARN_ENV=jsdom LEARN_FIRST= source ${JSON.stringify(path.join(__dirname, 'learned-emulation.sh'))}; echo "$LENV|$LFIRST"`], { encoding: 'utf8' }).trim(), 'jsdom|');

// learned_run on another DOM's state (jsdom-learned: LENV=jsdom, its own
// state prefix): a split run where a file of the shared part reports no
// result at all (b, a crash) re-runs it isolated, like a failing file, and
// isolates it from then on. run/status_map are stand-ins.
{
  const fs = require('fs');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learned-'));
  const file = (f) => `/proj/${f}.test.ts`;
  const map = (files) => ({ tests: Object.fromEntries(files.map((f) => [`pkg::${f}.test.ts::t`, { s: 'passed', file: file(f) }])), files: Object.fromEntries(files.map((f) => [`pkg::${f}.test.ts`, { s: 'passed', file: file(f) }])) });
  fs.writeFileSync(path.join(tmp, 'map0.json'), JSON.stringify(map(['a'])));
  fs.writeFileSync(path.join(tmp, 'map1.json'), JSON.stringify(map(['b'])));
  const st = path.join(tmp, 'jstate');
  fs.writeFileSync(`${st}.reference.json`, JSON.stringify(map(['a', 'b'])));
  for (const [k, v] of [['isolate', ''], ['leaky', ''], ['mode', 'split'], ['tiso', '100']]) fs.writeFileSync(`${st}.${k}`, `${v}\n`);
  const script = `
    T=${JSON.stringify(tmp)}; S=$T; E=$T; p=proj; REPOS_DIR=/; RESEARCH_DIR=${JSON.stringify(__dirname)}; jsonl=$T/l.jsonl; first="--first-setup reset.js"
    source "$RESEARCH_DIR/learned-emulation.sh"
    echo 0 > $T/n
    run() { echo "$*" >> $T/runs; echo 10; }
    na() { :; }
    add() { echo "$1 + $2" | bc; }
    excludes() { for f in "$@"; do printf -- "--exclude %s " "$f"; done; }
    count() { echo $#; }
    nodex() { node "$@"; }
    statuses() { node "$RESEARCH_DIR/statuses.cjs" "$@"; }
    status_map() { local n; n=$(cat $T/n); cp $T/map$n.json "$3"; echo $((n + 1)) > $T/n; }
    LENV=jsdom LFIRST= learned_run 1 $T/out.json $T/jstate
    echo "secs=$secs"`;
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.match(out, /secs=20/, 'shared part and the re-run of the missing file');
  const runs = fs.readFileSync(path.join(tmp, 'runs'), 'utf8').trim().split('\n');
  assert.match(runs[0], /--environment jsdom .*--extra-args --no-isolate $/, 'jsdom, no reset setup file');
  assert.match(runs[1], /--environment jsdom --extra-args --passWithNoTests \/proj\/b\.test\.ts$/, 'the file without a result re-run isolated');
  assert.equal(fs.readFileSync(`${st}.isolate`, 'utf8').trim(), file('b'), 'and isolated from then on');
  const rec = JSON.parse(fs.readFileSync(path.join(tmp, 'l.jsonl'), 'utf8').trim());
  assert.equal(rec.config, 'jsdom-learned');
  assert.equal(rec.rerun, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('learned emulation: ok');
