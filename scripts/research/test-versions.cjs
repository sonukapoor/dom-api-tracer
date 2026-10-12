#!/usr/bin/env node
// Check of versions.cjs and versions-report.cjs (run by npm test): install
// commands without a frozen lockfile, overrides for each package manager,
// and the report's counting (flaky tests left out, NA, forced, groups).
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const V = require('./versions.cjs');

// Install commands.
assert.equal(V.unfrozen('npm ci', 'npm'), 'npm install --no-audit --no-fund');
assert.equal(V.unfrozen('npx -y npm@11 ci --no-audit --no-fund --engine-strict=false', 'npm'), 'npx -y npm@11 install --no-audit --no-fund --engine-strict=false');
assert.equal(V.unfrozen('pnpm install --frozen-lockfile', 'pnpm'), 'pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false');
assert.equal(V.unfrozen('pnpm install --no-frozen-lockfile', 'pnpm'), 'pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false');
assert.equal(V.unfrozen('yarn install --immutable', 'yarn-berry'), 'YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install');
assert.equal(V.unfrozen('YARN_IGNORE_ENGINES=true yarn install --frozen-lockfile', 'yarn'), 'YARN_IGNORE_ENGINES=true yarn install');
assert.equal(V.unfrozen('npx -y bun@1.4.2 install --frozen-lockfile', 'bun'), 'npx -y bun@1.4.2 install');

// Override maps: other entries for the package (versioned, nested) go.
assert.deepEqual(V.setOverride({ 'jsdom@<20': '16', 'a>jsdom': '20', 'jsdom-x': '1', react: '18' }, 'jsdom', '26.1.0'), { 'jsdom-x': '1', react: '18', jsdom: '26.1.0' });
assert.deepEqual(V.setOverride(undefined, 'cssstyle', '4.1.0'), { cssstyle: '4.1.0' });

// pnpm-workspace.yaml: into an existing block, a new block, an empty map.
assert.equal(V.setYamlOverride('packages:\n  - a\noverrides:\n  react: 18\n  "x>jsdom": 20\ncatalog:\n  b: 1\n', 'jsdom', '20.0.3'),
  'packages:\n  - a\noverrides:\n  jsdom: "20.0.3"\n  react: 18\ncatalog:\n  b: 1\n');
assert.equal(V.setYamlOverride('packages:\n  - a\n', 'jsdom', '30.1.2'), 'packages:\n  - a\n\noverrides:\n  jsdom: "30.1.2"\n');
assert.equal(V.setYamlOverride('overrides: {}\n', 'cssstyle', '4.6.0'), 'overrides:\n  cssstyle: "4.6.0"\n');

// apply per package manager, on temporary checkouts.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'versions-'));
const proj = (name, files) => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, f), c);
  return d;
};
const pj = (d) => JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
const npm = proj('npm', { 'package.json': '{\n  "devDependencies": { "jsdom": "^20.0.0" },\n  "overrides": { "jsdom": "20.0.0" }\n}\n', 'package-lock.json': '{}' });
V.apply(npm, 'jsdom', '26.1.0');
assert.deepEqual([pj(npm).overrides, pj(npm).devDependencies.jsdom], [{ jsdom: '26.1.0' }, '26.1.0'], 'npm: override and the direct dependency');
const pnpm = proj('pnpm', { 'package.json': '{"name":"x"}', 'pnpm-lock.yaml': '', 'pnpm-workspace.yaml': 'packages:\n  - p\n' });
assert.deepEqual(V.apply(pnpm, 'jsdom', '20.0.3').map((f) => path.basename(f)), ['package.json', 'pnpm-workspace.yaml']);
assert.deepEqual(pj(pnpm).pnpm.overrides, { jsdom: '20.0.3' });
assert.match(fs.readFileSync(path.join(pnpm, 'pnpm-workspace.yaml'), 'utf8'), /overrides:\n {2}jsdom: "20\.0\.3"/);
const berry = proj('berry', { 'package.json': '{"resolutions":{"react":"18"}}', 'yarn.lock': '', '.yarnrc.yml': '' });
V.apply(berry, 'jsdom', '30.1.2');
assert.deepEqual(pj(berry).resolutions, { react: '18', jsdom: '30.1.2' });
const bun = proj('bun', { 'package.json': '{}', 'bun.lock': '' });
V.apply(bun, 'cssstyle', '4.1.0');
assert.deepEqual(pj(bun).overrides, { cssstyle: '4.1.0' });
assert.deepEqual(V.files(pnpm), ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']);

// The report: own-a/own-b flaky, a forced version, an NA variant, groups.
const out = path.join(tmp, 'out');
const write = (variant, meta, tests) => {
  const d = path.join(out, 'proj', variant);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ variant, status: 'ok', reason: null, seconds: 10, linked: null, ...meta }));
  if (tests) {
    const map = { tests: {}, files: {} };
    for (const [k, s, m] of tests) {
      map.tests[`pkg::a.test.ts::${k}`] = { s, file: '/x/a.test.ts', ...(m ? { m } : {}) };
      const f = map.files['pkg::a.test.ts'];
      map.files['pkg::a.test.ts'] = { s: f?.s === 'failed' || s === 'failed' ? 'failed' : 'passed', file: '/x/a.test.ts' };
    }
    fs.writeFileSync(path.join(d, 'map.json'), JSON.stringify(map));
  }
};
const own = { resolved: { '.': { jsdom: '25.0.1', cssstyle: '4.1.0' } } };
write('own-a', own, [['t1', 'passed'], ['t2', 'passed'], ['t3', 'passed'], ['t4', 'passed']]);
write('own-b', own, [['t1', 'passed'], ['t2', 'failed', 'Timeout 5000ms'], ['t3', 'passed'], ['t4', 'passed']]);
write('jsdom-30.1.2', { resolved: { '.': { jsdom: '30.1.2', cssstyle: null } } },
  [['t1', 'failed', 'TypeError: x.style is 1'], ['t2', 'failed', 'Timeout 5000ms'], ['t3', 'failed', 'TypeError: x.style is 2'], ['t4', 'passed']]);
write('jsdom-20.0.3', { status: 'NA', reason: 'install failed: ERR', resolved: {} }, null);
write('cssstyle-4.6.0', { resolved: { '.': { jsdom: '25.0.1', cssstyle: '4.1.0' } } }, [['t1', 'passed'], ['t2', 'passed'], ['t3', 'passed'], ['t4', 'passed']]);
const csv = path.join(tmp, 'v.csv');
const groupsJson = path.join(tmp, 'g.json');
const report = execFileSync(process.execPath, [path.join(__dirname, 'versions-report.cjs'), out, '--csv', csv, '--groups', groupsJson], { encoding: 'utf8' });
const row = (v) => report.split('\n').find((l) => l.startsWith(`| proj | ${v} |`));
// t2 is flaky (own-a vs own-b): left out; t1 and t3 differ, both in one group.
assert.match(row('jsdom-30.1.2'), /\| 30\.1\.2 \| yes \| 4 \| 2 \| 0 \| 1 \/ 1 \|/);
assert.match(row('own-b'), /\| 4 \| 1 \| 1 \| 1 \/ 1 \|/);
assert.match(row('jsdom-20.0.3'), /\| NA \| NA \|.*install failed: ERR \|$/);
assert.match(row('cssstyle-4.6.0'), /\| 25\.0\.1 \(cssstyle 4\.1\.0\) \| no \|/, 'the override did not reach the runner');
const g = JSON.parse(fs.readFileSync(groupsJson, 'utf8'));
assert.deepEqual(g['proj jsdom-30.1.2'].map((x) => [x.key, x.count]), [['passed -> failed | TypeError: x.style is N', 2]]);
assert.match(fs.readFileSync(csv, 'utf8'), /^project,variant,status,/);
assert.match(fs.readFileSync(csv, 'utf8'), /\nproj,jsdom-30\.1\.2,ok,30\.1\.2,yes,4,1,2,0,1,1,10,\n/);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('versions: ok');
