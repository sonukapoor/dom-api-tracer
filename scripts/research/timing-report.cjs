#!/usr/bin/env node
// Summarizes a timing CSV from timing-vitest.sh / timing-jest.sh as a
// Markdown table: per suite, the median time of each configuration over
// the rounds, the median of the per-round jsdom/warpdom ratios, and the
// median number of tests whose status differs from jsdom.
//
//   node scripts/research/timing-report.cjs <timing.csv>
const rows = require('fs').readFileSync(process.argv[2], 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const data = new Map();
for (const [round, project, config, secs, differs] of rows) {
  if (!data.has(project)) data.set(project, new Map());
  const p = data.get(project);
  if (!p.has(round)) p.set(round, {});
  p.get(round)[config] = { secs: secs === 'NA' ? NaN : +secs, differs: +differs };
}
const median = (a) => { const s = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : NaN; };
const fmt = (n, unit = '') => (Number.isNaN(n) ? '—' : n.toFixed(1) + unit);
const num = (n) => (Number.isNaN(n) ? '—' : n);
const ratio = (p, a, b) => median([...p.values()].map((r) => (r[a] && r[b] ? r[a].secs / r[b].secs : NaN)));
console.log('| Suite | rounds | jsdom | warpdom | jsdom vm | warpdom vm | warpdom vs jsdom (default) | best correct warpdom vs jsdom default | differ (wd default / jsdom vm / wd vm) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const warnings = [];
for (const [project, p] of data) {
  const m = (c) => median([...p.values()].map((r) => r[c]?.secs ?? NaN));
  const d = (c) => median([...p.values()].map((r) => r[c]?.differs ?? NaN));
  const wdDefault = ratio(p, 'jsdom-default', 'warpdom-default');
  // Best warpdom configuration whose results match jsdom (<= 5 differences).
  const wdVmOk = d('warpdom-vm') <= 5;
  const best = wdVmOk ? Math.max(wdDefault, ratio(p, 'jsdom-default', 'warpdom-vm')) : wdDefault;
  // A jsdom run whose tests differ from the jsdom baseline is broken (e.g.
  // a package that did not run), so its time is not comparable.
  const broken = [...p.values()].filter((r) => r['jsdom-default'] && (r['jsdom-default'].differs > 0 || Number.isNaN(r['jsdom-default'].secs))).length;
  if (broken) warnings.push(`${project}: ${broken} of ${p.size} jsdom rounds differ from the jsdom baseline or have no time; those rounds are not comparable`);
  console.log(`| ${project} | ${p.size} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m('warpdom-default'), ' s')} | ${fmt(m('jsdom-vm'), ' s')} | ${fmt(m('warpdom-vm'), ' s')} | ${wdDefault.toFixed(2)}x | ${best.toFixed(2)}x${wdVmOk && best !== wdDefault ? ' (vm)' : ''} | ${num(d('warpdom-default'))} / ${num(d('jsdom-vm'))} / ${num(d('warpdom-vm'))} |`);
}

if (warnings.length) console.log('\n**Check:** ' + warnings.join('; ') + '.');

// Experiments (warpdomframes-*): their median time, speedup over jsdom and
// differences, in a second table.
const experiments = [...new Set(rows.map((r) => r[2]))].filter((c) => c.startsWith('warpdomframes-'));
if (experiments.length) {
  console.log('\n| Suite | configuration | median | vs jsdom default | vs warpdom default | differ |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [project, p] of data) {
    for (const c of experiments) {
      const m = median([...p.values()].map((r) => r[c]?.secs ?? NaN));
      if (Number.isNaN(m)) continue;
      const d = median([...p.values()].map((r) => r[c]?.differs ?? NaN));
      console.log(`| ${project} | ${c} | ${fmt(m, ' s')} | ${ratio(p, 'jsdom-default', c).toFixed(2)}x | ${ratio(p, 'warpdom-default', c).toFixed(2)}x | ${num(d)} |`);
    }
  }
}
