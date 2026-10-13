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
console.log('learned emulation: ok');
