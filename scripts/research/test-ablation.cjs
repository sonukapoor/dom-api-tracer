#!/usr/bin/env node
// Check of ablation-report.cjs (run by npm test): jsdom-sharedclean is a
// jsdom alternative for the best correct jsdom configuration and for the
// suites where every alternative changes results.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ablation-'));
const csv = ['round,project,config,seconds,differs,files_differ,false_pass,false_fail,ref,position,method'];
for (let r = 1; r <= 3; r++) {
  // p: only jsdom-sharedclean keeps the results, and it is the fastest.
  csv.push(`${r},p,jsdom-default,100,0,0,0,0,,1,`, `${r},p,jsdom-shared,50,2,1,0,2,jsdom-default,2,`,
    `${r},p,jsdom-vm,70,1,1,0,1,jsdom-default,3,`, `${r},p,jsdom-sharedclean,60,0,0,0,0,jsdom-default,4,`);
  // q: every alternative changes results, jsdom-sharedclean too.
  csv.push(`${r},q,jsdom-default,100,0,0,0,0,,1,`, `${r},q,jsdom-shared,50,2,1,0,2,jsdom-default,2,`,
    `${r},q,jsdom-sharedclean,60,1,1,0,1,jsdom-default,3,`);
}
// jsdom-learned (the policy on jsdom) on q, with warpdom-learned: in its
// own table, not a jsdom alternative (q stays a suite where every
// alternative changes results).
for (let r = 1; r <= 3; r++) {
  csv.push(`${r},q,jsdom-learned,80,0,0,0,0,jsdom-default,4,harness`, `${r},q,warpdom-default,40,0,0,0,0,,5,`, `${r},q,warpdom-learned,20,0,0,0,0,warpdom-default,6,harness`);
}
const learning = [
  { round: 0, project: 'q', kind: 'learn', method: 'harness', config: 'jsdom-learned', t_iso: 100, t_sh: 30, t_split: 70, mode: 'split', leaky: ['a'] },
  { round: 1, project: 'q', kind: 'learn', method: 'harness', config: 'jsdom-learned', t_iso: 100, t_sh: 30, t_split: 70, mode: 'split', leaky: ['a'] },
  { round: 0, project: 'q', kind: 'learn', method: 'harness', t_iso: 40, t_sh: 10, t_split: 10, mode: 'split', leaky: [] },
];
fs.writeFileSync(path.join(dir, 'l.jsonl'), learning.map((x) => JSON.stringify(x)).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'a.csv'), csv.join('\n') + '\n');
const report = execFileSync(process.execPath, [path.join(__dirname, 'ablation-report.cjs'), path.join(dir, 'a.csv'), '--learning', path.join(dir, 'l.jsonl')], { encoding: 'utf8' });
assert.match(report, /## Policy and DOM[\s\S]*\| q \| 80\.0 s \| 1\.25x \| 1\.25-1\.25x \(range\) \| 0 \| 0 \| 4\.00x \|/, 'jsdom-learned over jsdom-default, warpdom-learned over it');
// Learning per configuration; jsdom-learned's break-even against jsdom-default: 100 / (100 - 80) = 5.
assert.match(report, /\| q \| jsdom-learned \| harness \| 2 \|[^\n]*\| 100\.0 s \| 5\.0 \|/);
assert.match(report, /\| q \| warpdom-learned \| harness \| 1 \|[^\n]*\| 20\.0 s \| 1\.0 \|/);
const best = report.slice(report.indexOf('## Best correct'));
assert.match(best, /\| p \| jsdom-sharedclean, jsdom-default \| jsdom-sharedclean \| 60\.0 s \|/, 'sharedclean counts as a correct jsdom configuration');
assert.match(best, /\| q \| jsdom-default \| jsdom-default \|/);
assert.match(best, /every non-default jsdom configuration changes results:\*\* q \(jsdom-shared, jsdom-sharedclean\)\./, 'sharedclean is one of the alternatives');
assert.match(report, /\| p \| jsdom-sharedclean \| 3\/3 \| 60\.0 s \| 1\.67x \|/, 'configuration table lists it');
fs.rmSync(dir, { recursive: true, force: true });
console.log('ablation: ok');
