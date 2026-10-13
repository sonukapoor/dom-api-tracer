#!/usr/bin/env node
// Check of configs.sh (run by npm test): configuration names, the
// WARPDOM_ABLATE of the A/A controls, per-package times from harness
// output; and the timing report's A/A and per-package tables.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const sh = (script, input) => execFileSync('bash', ['-c', `source ${JSON.stringify(path.join(__dirname, 'configs.sh'))}; ${script}`], { encoding: 'utf8', input }).trim();
const parse = (cfg) => { try { return sh(`parse_config ${cfg}`); } catch { return null; } };

assert.equal(parse('jsdom-default'), 'jsdom - - - -');
assert.equal(parse('happy-dom-default'), 'happy-dom - - - -');
assert.equal(parse('warpdom-vm'), 'warpdom - - vmThreads -');
assert.equal(parse('warpdomframes-default'), 'warpdom - 1 - -');
assert.equal(parse('warpdomnocache-default'), 'warpdom no-query-cache - - -');
assert.equal(parse('warpdomlatest-vm'), 'warpdom latest-profile - vmThreads -');
// The A/A controls: warpdom-default again, and with WARPDOM_ABLATE=''.
assert.equal(parse('warpdom-default-aa'), 'warpdom - - - -');
assert.equal(parse('warpdom-ablate-unset'), "warpdom '' - - -");
// The strong jsdom baseline: no isolation plus the generic cleanup.
assert.equal(parse('jsdom-sharedclean'), 'jsdom - - - clean');
assert.equal(parse('happy-dom-sharedclean'), null, 'jsdom only');
for (const script of ['timing-rounds.sh', 'ablation-isolation.sh']) {
  assert.match(fs.readFileSync(path.join(__dirname, script), 'utf8'), /--no-isolate.*--project-setup "\$RESEARCH_DIR\/shared-cleanup\.mjs"/, `${script} runs jsdom-sharedclean with the cleanup`);
}
assert.match(fs.readFileSync(path.join(__dirname, 'ablation-isolation.sh'), 'utf8'), /^ALL="[^"]*\bjsdom-sharedclean\b/m, 'ablation-isolation.sh runs jsdom-sharedclean by default');
// jsdom-learned: the shared emulation on jsdom without the reset, its own state.
const ab = fs.readFileSync(path.join(__dirname, 'ablation-isolation.sh'), 'utf8');
assert.match(ab, /^ALL="[^"]*\bjsdom-learned\b/m);
assert.match(ab, /^jl\(\) \{ LENV=jsdom LFIRST= "\$@"; \}/m);
assert.match(ab, /jl learned_run \$r \$md\/\$c\.json \$S\/ab-jstate-\$p/);
assert.equal(parse('warpdom-fast'), null, 'unknown pool');
assert.equal(parse('linkedom-default'), null, 'unknown DOM');

// timing-rounds.sh runs every configuration but warpdom-ablate-unset with
// WARPDOM_ABLATE unset, even when the caller's environment has it.
const ablate = (a) => execFileSync('bash', ['-c', `source ${JSON.stringify(path.join(__dirname, 'configs.sh'))}; show() { echo "\${WARPDOM_ABLATE-unset}"; }; with_ablate ${a} show`],
  { encoding: 'utf8', env: { ...process.env, WARPDOM_ABLATE: 'eager-interfaces' } }).trim();
assert.equal(ablate('-'), 'unset');
assert.equal(ablate("\"''\""), '');
assert.equal(ablate('no-query-cache'), 'no-query-cache');
const rounds = fs.readFileSync(path.join(__dirname, 'timing-rounds.sh'), 'utf8');
assert.match(rounds, /with_ablate "\$ablate" harness /, 'timing-rounds.sh runs the harness through with_ablate');
// Differences against the same round's jsdom-default run, the flaky set recorded.
assert.match(rounds, /\[ \$r = round \] && against=\$md\/jsdom-default\.json/, 'timing-rounds.sh compares with the round\'s jsdom run');
assert.match(rounds, /statuses jsdom-rounds /, 'timing-rounds.sh records the flaky set');

// Per-package times from harness output: ran, failed, skipped.
const log = `
▶ handsontable
  building: pnpm --filter handsontable run build
  ran     handsontable: 2900/2910 passed on jsdom, 301.5s
  ran     wrappers/react-wrapper: 120/120 passed on jsdom (provided), 12.0s
  failed  wrappers/vue3: run produced no results (see logs/x/y.log)
  skipped wrappers/angular-wrapper: runs in browser mode
`;
assert.equal(sh('package_times', log), [
  'handsontable ran 301.5', 'wrappers/react-wrapper ran 12.0', 'wrappers/vue3 failed NA', 'wrappers/angular-wrapper skipped NA',
].join('\n'));

// The timing report: A/A table and per-package table.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configs-'));
const csv = ['round,project,config,seconds,differs,files_differ'];
const pkgs = ['round,project,config,package,status,seconds'];
for (let r = 1; r <= 5; r++) {
  csv.push(`${r},p,jsdom-default,100,0,0`, `${r},p,warpdom-default,${40 + r},0,0`, `${r},p,warpdom-default-aa,${40 + r},0,0`, `${r},p,warpdom-ablate-unset,${(40 + r) / 1.1},0,0`);
  pkgs.push(`${r},p,jsdom-default,a,ran,90`, `${r},p,warpdom-default,a,ran,10`, `${r},p,jsdom-default,b,ran,10`, `${r},p,warpdom-default,b,ran,5`);
}
pkgs.push('0,p,jsdom-default,a,ran,180', '0,p,warpdom-default,a,ran,60', '0,p,jsdom-default,b,failed,NA', '0,p,warpdom-default,b,ran,5');
fs.writeFileSync(path.join(dir, 't.csv'), csv.join('\n') + '\n');
fs.writeFileSync(path.join(dir, 't.packages.csv'), pkgs.join('\n') + '\n');
const report = execFileSync(process.execPath, [path.join(__dirname, 'timing-report.cjs'), path.join(dir, 't.csv'), '--packages', path.join(dir, 't.packages.csv')], { encoding: 'utf8' });
const after = (heading) => report.slice(report.indexOf(heading));
const line = (re, from = '**A/A controls**') => after(from).split('\n').find((l) => re.test(l));
assert.match(line(/^\| p \| warpdom-default-aa \|/), /\| 5 \| 1\.000 \| 1\.000-1\.000 \(95% CI\) \| 0\.0% \|/);
assert.match(line(/^\| p \| warpdom-ablate-unset \|/), /\| 5 \| 1\.100 \|/);
assert.match(report, /warpdom-default-aa: 5 paired rounds over all suites, median ratio 1\.000/);
// Package a: 90/10 timed, 180/60 warm-up; b: no jsdom warm-up time.
assert.match(line(/^\| p \| a \|/, '**Per package**'), /\| 5 \| 90\.0 s \| 180\.0 s \| 10\.0 s \| 60\.0 s \| 9\.00x \| 3\.00x \|$/);
assert.match(line(/^\| p \| b \|/, '**Per package**'), /\| 2\.00x \| — \|$/);
fs.rmSync(dir, { recursive: true, force: true });
console.log('configs: ok');
