#!/usr/bin/env node
// Groups a project's warpdom-vs-jsdom test status differences (from
// scripts/research/survey-warpdom.sh) by status change and first line of
// the error message (numbers folded to N), largest groups first, with up
// to three example test files per group (as <package>:<file>; keys include
// the package, as in survey-warpdom.sh, since monorepo packages such as
// ark-ui's share test file names).
//
//   node scripts/research/diffgroups.cjs <project> [jsdomBaselineDir]
//
// Run from the repository root (or set ENV_DIR to the harness output
// directory, default .corpus-env).
const fs = require('fs');
const ENV_DIR = process.env.ENV_DIR || '.corpus-env';
const [p, baseArg] = process.argv.slice(2);
if (!p) { console.error('usage: diffgroups.cjs <project> [jsdomBaselineDir]'); process.exit(2); }
const base = baseArg || (fs.existsSync(`${ENV_DIR}/jsdom-time/tmp/${p}`) ? `${ENV_DIR}/jsdom-time/tmp/${p}` : `${ENV_DIR}/jsdom-base/${p}-run/tmp/${p}`);
const load = (dir, suffix) => { const m = new Map(); for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(suffix))) { const r = JSON.parse(fs.readFileSync(dir + '/' + f)); for (const t of r.testResults) { const fn = t.name.split(/\/(packages|src|test|tests|examples)\//).pop(); const pk = f.split('.')[0] + ':' + fn; if (!t.assertionResults.length) m.set(pk + '::(file)', { s: t.status, msg: t.message }); for (const a of t.assertionResults) m.set(pk + '::' + a.fullName, { s: a.status, msg: a.failureMessages[0] }); } } return m; };
const b = load(base, '.jsdom.json'), w = load(`${ENV_DIR}/survey-warpdom/${p}-run/tmp/${p}`, '.warpdom.json');
const g = new Map();
for (const k of new Set([...b.keys(), ...w.keys()])) if (b.get(k)?.s !== w.get(k)?.s) {
  const m = (w.get(k)?.msg || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 150) || '';
  const key = b.get(k)?.s + '->' + w.get(k)?.s + ' | ' + m.replace(/\d+/g, 'N');
  if (!g.has(key)) g.set(key, []); g.get(key).push(k.split('::')[0]);
}
for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) console.log(String(v.length).padStart(4), k, '\n        ', [...new Set(v)].slice(0, 3).join(', '));
