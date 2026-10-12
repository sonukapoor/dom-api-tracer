#!/usr/bin/env node
// Summarizes a timing CSV from timing-vitest.sh / timing-jest.sh as a
// Markdown table: per suite, the median time of each configuration over
// the rounds, the median of the per-round jsdom/warpdom ratios, and the
// median number of tests whose status differs from jsdom; then the
// uncertainty of the speedups (ranges or bootstrap intervals, see the end).
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
const FLAKY = 5;
for (const [project, p] of data) {
  const m = (c) => median([...p.values()].map((r) => r[c]?.secs ?? NaN));
  const d = (c) => median([...p.values()].map((r) => r[c]?.differs ?? NaN));
  const wdDefault = ratio(p, 'jsdom-default', 'warpdom-default');
  // Best warpdom configuration whose results match jsdom (<= 5 differences).
  const wdVmOk = d('warpdom-vm') <= 5;
  const best = wdVmOk ? Math.max(wdDefault, ratio(p, 'jsdom-default', 'warpdom-vm')) : wdDefault;
  // A jsdom run whose tests differ from the jsdom baseline is broken (e.g.
  // a package that did not run), so its time is not comparable.
  // A few differing tests are flaky tests (they change on jsdom itself);
  // more than FLAKY means a package did not run.
  const broken = [...p.values()].filter((r) => r['jsdom-default'] && (r['jsdom-default'].differs > FLAKY || Number.isNaN(r['jsdom-default'].secs))).length;
  if (broken) warnings.push(`${project}: ${broken} of ${p.size} jsdom rounds differ from the jsdom baseline in more than ${FLAKY} tests or have no time; those rounds are not comparable`);
  console.log(`| ${project} | ${p.size} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m('warpdom-default'), ' s')} | ${fmt(m('jsdom-vm'), ' s')} | ${fmt(m('warpdom-vm'), ' s')} | ${wdDefault.toFixed(2)}x | ${best.toFixed(2)}x${wdVmOk && best !== wdDefault ? ' (vm)' : ''} | ${num(d('warpdom-default'))} / ${num(d('jsdom-vm'))} / ${num(d('warpdom-vm'))} |`);
}

if (warnings.length) console.log('\n**Check:** ' + warnings.join('; ') + '.');

// Three-way (happy-dom-* present): speed of all three DOMs and how many
// tests differ from jsdom on each, plus medians over the suites whose
// jsdom rounds are all valid.
const hasHappy = rows.some((r) => r[2] === 'happy-dom-default');
if (hasHappy) {
  console.log('\n| Suite | jsdom | warpdom | happy-dom | warpdom vs jsdom | happy-dom vs jsdom | warpdom vs happy-dom | tests differing from jsdom: warpdom / happy-dom |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const valid = { wd: [], hd: [], wh: [] };
  for (const [project, p] of data) {
    const m = (c) => median([...p.values()].map((r) => r[c]?.secs ?? NaN));
    const d = (c) => median([...p.values()].map((r) => r[c]?.differs ?? NaN));
    const wd = ratio(p, 'jsdom-default', 'warpdom-default');
    const hd = ratio(p, 'jsdom-default', 'happy-dom-default');
    const wh = ratio(p, 'happy-dom-default', 'warpdom-default');
    const ok = ![...p.values()].some((r) => r['jsdom-default'] && (r['jsdom-default'].differs > FLAKY || Number.isNaN(r['jsdom-default'].secs)));
    if (ok) { valid.wd.push(wd); valid.hd.push(hd); valid.wh.push(wh); }
    const x = (v) => (Number.isNaN(v) ? '—' : `${v.toFixed(2)}x`);
    console.log(`| ${project}${ok ? '' : ' (check)'} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m('warpdom-default'), ' s')} | ${fmt(m('happy-dom-default'), ' s')} | ${x(wd)} | ${x(hd)} | ${x(wh)} | ${num(d('warpdom-default'))} / ${num(d('happy-dom-default'))} |`);
  }
  const med = (a) => { const v = a.filter((n) => !Number.isNaN(n)).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
  console.log(`\nMedians over ${valid.wd.length} suites with valid jsdom rounds: warpdom vs jsdom ${med(valid.wd).toFixed(2)}x, happy-dom vs jsdom ${med(valid.hd).toFixed(2)}x, warpdom vs happy-dom ${med(valid.wh).toFixed(2)}x.`);
}

// Fast mode (learned.sh: warpdom-learned-split or -isolated per round,
// against that round's jsdom default run).
const learned = rows.some((r) => r[2].startsWith('warpdom-learned-'));
if (learned) {
  console.log('\n| Suite | jsdom default | warpdom fast mode | mode | speedup | tests differing from jsdom |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const speedups = [];
  for (const [project, p] of data) {
    const cfg = [...p.values()].flatMap((r) => Object.keys(r)).find((c) => c.startsWith('warpdom-learned-'));
    if (!cfg) continue;
    const m = (c) => median([...p.values()].map((r) => r[c]?.secs ?? NaN));
    const d = median([...p.values()].map((r) => r[cfg]?.differs ?? NaN));
    const x = ratio(p, 'jsdom-default', cfg);
    speedups.push(x);
    console.log(`| ${project} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m(cfg), ' s')} | ${cfg.replace('warpdom-learned-', '')} | ${x.toFixed(2)}x | ${num(d)} |`);
  }
  const v = speedups.filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  if (v.length) console.log(`\nFast mode median over ${v.length} suites: ${(v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2).toFixed(2)}x.`);
}

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

// Uncertainty of the speedups over jsdom's default pool. Per suite: with
// fewer than 5 rounds the range of the per-round ratios (a bootstrap of 3
// values says little more), else a 95% bootstrap interval of the median of
// the per-round ratios. Across suites: a 95% bootstrap interval of the
// median speedup, resampling suites and, within each, its rounds (two
// levels). Fixed seed, so the same CSV gives the same intervals.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const midMedian = (a) => { const v = [...a].sort((x, y) => x - y); const n = v.length; return n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2; };
const pick = (a, r) => a[Math.floor(r() * a.length)];
const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const RESAMPLES = 10000;
for (const target of ['warpdom-default', 'happy-dom-default']) {
  const suites = [];
  for (const [project, p] of data) {
    const rounds = [...p.values()];
    if (rounds.some((r) => r['jsdom-default'] && (r['jsdom-default'].differs > FLAKY || Number.isNaN(r['jsdom-default'].secs)))) continue;
    const ratios = rounds.map((r) => (r['jsdom-default'] && r[target] ? r['jsdom-default'].secs / r[target].secs : NaN)).filter((x) => !Number.isNaN(x));
    if (ratios.length) suites.push({ project, ratios });
  }
  if (suites.length === 0) continue;
  const r = rng(0x5eed);
  console.log(`\n**${target.replace('-default', '')} vs jsdom: speedup and its uncertainty** (median of per-round ratios; range for fewer than 5 rounds, else 95% bootstrap interval)\n`);
  console.log('| Suite | rounds | speedup | interval |');
  console.log('| --- | --- | --- | --- |');
  for (const { project, ratios } of suites) {
    const m = midMedian(ratios);
    let lo, hi, kind;
    if (ratios.length < 5) { lo = Math.min(...ratios); hi = Math.max(...ratios); kind = 'range'; }
    else {
      const meds = Array.from({ length: RESAMPLES }, () => midMedian(ratios.map(() => pick(ratios, r)))).sort((x, y) => x - y);
      lo = percentile(meds, 0.025); hi = percentile(meds, 0.975); kind = '95% CI';
    }
    console.log(`| ${project} | ${ratios.length} | ${m.toFixed(2)}x | ${lo.toFixed(2)}-${hi.toFixed(2)}x (${kind}) |`);
  }
  const point = midMedian(suites.map((s) => midMedian(s.ratios)));
  const boot = Array.from({ length: RESAMPLES }, () => {
    const sample = suites.map(() => pick(suites, r));
    return midMedian(sample.map((s) => midMedian(s.ratios.map(() => pick(s.ratios, r)))));
  }).sort((x, y) => x - y);
  console.log(`\nMedian speedup over ${suites.length} suites: ${point.toFixed(2)}x (95% bootstrap interval ${percentile(boot, 0.025).toFixed(2)}-${percentile(boot, 0.975).toFixed(2)}x, suites and rounds resampled, ${RESAMPLES} resamples).`);
}

// Every configuration other than jsdom-default (ablations and experiments
// included): median time, speedup against jsdom-default in the same round
// (median of per-round ratios, with the range or a 95% bootstrap interval as
// above), and tests that differ from jsdom.
const others = [...new Set(rows.map((r) => r[2]))].filter((c) => c !== 'jsdom-default');
const extra = others.filter((c) => !['warpdom-default', 'happy-dom-default', 'jsdom-vm', 'warpdom-vm'].includes(c) && !c.startsWith('warpdomframes-') && !c.startsWith('warpdom-learned-'));
if (extra.length) {
  const r = rng(0xab1a7e);
  console.log('\n**All configurations against jsdom-default** (speedup: median of per-round ratios; range below 5 rounds, else 95% bootstrap interval)\n');
  console.log('| Suite | configuration | rounds | median time | speedup | interval | differ |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const [project, p] of data) {
    for (const c of others) {
      const rounds = [...p.values()].filter((x) => x[c]);
      if (!rounds.length) continue;
      const ratios = rounds.map((x) => (x['jsdom-default'] ? x['jsdom-default'].secs / x[c].secs : NaN)).filter((x) => !Number.isNaN(x));
      const t = median(rounds.map((x) => x[c].secs));
      const d = median(rounds.map((x) => x[c].differs));
      let interval = '—';
      if (ratios.length >= 5) {
        const meds = Array.from({ length: RESAMPLES }, () => midMedian(ratios.map(() => pick(ratios, r)))).sort((x, y) => x - y);
        interval = `${percentile(meds, 0.025).toFixed(2)}-${percentile(meds, 0.975).toFixed(2)}x (95% CI)`;
      } else if (ratios.length) interval = `${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}x (range)`;
      console.log(`| ${project} | ${c} | ${rounds.length} | ${fmt(t, ' s')} | ${ratios.length ? midMedian(ratios).toFixed(2) + 'x' : '—'} | ${interval} | ${num(d)} |`);
    }
  }
}
