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
fs.writeFileSync(path.join(dir, 'a.csv'), csv.join('\n') + '\n');
const report = execFileSync(process.execPath, [path.join(__dirname, 'ablation-report.cjs'), path.join(dir, 'a.csv')], { encoding: 'utf8' });
const best = report.slice(report.indexOf('## Best correct'));
assert.match(best, /\| p \| jsdom-sharedclean, jsdom-default \| jsdom-sharedclean \| 60\.0 s \|/, 'sharedclean counts as a correct jsdom configuration');
assert.match(best, /\| q \| jsdom-default \| jsdom-default \|/);
assert.match(best, /every non-default jsdom configuration changes results:\*\* q \(jsdom-shared, jsdom-sharedclean\)\./, 'sharedclean is one of the alternatives');
assert.match(report, /\| p \| jsdom-sharedclean \| 3\/3 \| 60\.0 s \| 1\.67x \|/, 'configuration table lists it');
fs.rmSync(dir, { recursive: true, force: true });
console.log('ablation: ok');
