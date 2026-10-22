#!/usr/bin/env node
// Summarizes a timing CSV from timing-vitest.sh / timing-jest.sh as a
// Markdown table: per suite, the median time of each configuration over
// the rounds, the median of the per-round jsdom/warpdom ratios, and the
// most tests whose status differs from jsdom in any round; then the
// uncertainty of the speedups (ranges or bootstrap intervals, see the end).
//
//   node scripts/research/timing-report.cjs <timing.csv> [--packages <packages.csv>] [--pertest <dir>]
//
// Differences: tests whose status differs from the same round's
// jsdom-default run (timing-rounds.sh's ref column; older CSVs counted
// against one jsdom baseline run). With --pertest (the per-test statuses,
// $PERTEST_DIR of timing-rounds.sh) they are recomputed from the per-test
// maps against the round's jsdom-default run, and shown as "raw (without
// flaky)": flaky are the tests whose status changes between the suite's
// jsdom-default runs (warm-up included; statuses.cjs jsdomRounds).
//
// Broken jsdom rounds: a round whose jsdom-default run has no time, or
// (with --pertest) differs from the suite's other jsdom-default runs in
// more than FLAKY tests by the median (without --pertest: from the jsdom
// baseline, its CSV differs), is left out (that round only, every
// configuration of it); a suite without valid rounds is marked (check).
//
// With A/A controls in the CSV (warpdom-default-aa, warpdom-ablate-unset;
// timing-rounds.sh), a table of the paired ratio warpdom-default / control
// per round: the noise floor of a paired ratio. With --packages (the
// <csv>.packages.csv timing-rounds.sh writes), per package the median time
// of each configuration and the jsdom/warpdom ratio, warm-up and timed.
const argv = process.argv.slice(2);
const pkgIdx = argv.indexOf('--packages');
const packagesFile = pkgIdx >= 0 ? argv.splice(pkgIdx, 2)[1] : null;
const ptIdx = argv.indexOf('--pertest');
const pertestDir = ptIdx >= 0 ? argv.splice(ptIdx, 2)[1] : null;
const fs = require('fs');
const path = require('path');
const S = require('./statuses.cjs');
const rows = fs.readFileSync(argv[0], 'utf8').trim().split('\n').slice(1).filter((l) => l && !l.startsWith('round,')).map((l) => l.split(','));
const data = new Map();
for (const [round, project, config, secs, differs] of rows) {
  if (!data.has(project)) data.set(project, new Map());
  const p = data.get(project);
  if (!p.has(round)) p.set(round, {});
  p.get(round)[config] = { secs: secs === 'NA' ? NaN : +secs, differs: differs === 'NA' ? NaN : +differs, stable: NaN };
}
const FLAKY = 5;
// Broken jsdom rounds out (per round), flaky tests and the differences
// without them (--pertest).
const warnings = [];
const readMap = (file) => { try { const m = JSON.parse(fs.readFileSync(file, 'utf8')); return { tests: m.tests ?? {}, files: m.files ?? {} }; } catch { return null; } };
const flakyCount = new Map();
for (const [project, p] of data) {
  let broken;
  const dirs = pertestDir && fs.existsSync(pertestDir)
    ? fs.readdirSync(pertestDir).filter((r) => fs.existsSync(path.join(pertestDir, r, project, 'jsdom-default.json'))) : [];
  if (dirs.length) {
    const entries = dirs.map((r) => ({ round: r, secs: p.get(r)?.['jsdom-default']?.secs ?? null, map: readMap(path.join(pertestDir, r, project, 'jsdom-default.json')) })).filter((e) => e.map);
    const jr = S.jsdomRounds(entries, FLAKY);
    broken = jr.broken.filter((r) => p.has(r));
    flakyCount.set(project, jr.flaky.tests.size);
    for (const [r, cfgs] of p) {
      const base = readMap(path.join(pertestDir, r, project, 'jsdom-default.json'));
      if (!base) continue;
      for (const [c, v] of Object.entries(cfgs)) {
        const run = c === 'jsdom-default' ? null : readMap(path.join(pertestDir, r, project, `${c}.json`));
        if (c === 'jsdom-default') { v.differs = 0; v.stable = 0; continue; }
        if (!run) continue;
        v.differs = S.compare(base, run).differs;
        v.stable = S.compare(base, run, null, jr.flaky).differs;
      }
    }
  } else {
    broken = [...p].filter(([, r]) => r['jsdom-default'] && (r['jsdom-default'].differs > FLAKY || Number.isNaN(r['jsdom-default'].secs))).map(([round]) => round);
  }
  if (broken.length) {
    warnings.push(`${project}: jsdom round${broken.length > 1 ? 's' : ''} ${broken.join(', ')} of ${p.size} broken (no time, or differing from the other jsdom runs in more than ${FLAKY} tests): left out`);
    for (const r of broken) p.delete(r);
  }
}
const median = (a) => { const s = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
// Tests that differ: the most in any round (a round that differs is not hidden by a median).
const most = (a) => { const s = a.filter((x) => !Number.isNaN(x)); return s.length ? Math.max(...s) : NaN; };
// "raw (without flaky)" with --pertest, else raw.
const differ = (p, c) => {
  const raw = most([...p.values()].map((r) => r[c]?.differs ?? NaN));
  const stable = most([...p.values()].map((r) => r[c]?.stable ?? NaN));
  return Number.isNaN(raw) ? '—' : Number.isNaN(stable) ? String(raw) : `${raw} (${stable})`;
};
const fmt = (n, unit = '') => (Number.isNaN(n) ? '—' : n.toFixed(1) + unit);
const num = (n) => (Number.isNaN(n) ? '—' : n);
const ratio = (p, a, b) => median([...p.values()].map((r) => (r[a] && r[b] ? r[a].secs / r[b].secs : NaN)));
console.log('| Suite | rounds | jsdom | warpdom | jsdom vm | warpdom vm | warpdom vs jsdom (default) | best correct warpdom vs jsdom default | differ (wd default / jsdom vm / wd vm) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [project, p] of data) {
  const m = (c) => median([...p.values()].map((r) => r[c]?.secs ?? NaN));
  const d = (c) => most([...p.values()].map((r) => r[c]?.differs ?? NaN));
  const wdDefault = ratio(p, 'jsdom-default', 'warpdom-default');
  // Best warpdom configuration whose results match jsdom (<= 5 differences).
  const wdVmOk = d('warpdom-vm') <= 5;
  const best = wdVmOk ? Math.max(wdDefault, ratio(p, 'jsdom-default', 'warpdom-vm')) : wdDefault;
  console.log(`| ${project}${p.size ? '' : ' (check)'} | ${p.size} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m('warpdom-default'), ' s')} | ${fmt(m('jsdom-vm'), ' s')} | ${fmt(m('warpdom-vm'), ' s')} | ${wdDefault.toFixed(2)}x | ${best.toFixed(2)}x${wdVmOk && best !== wdDefault ? ' (vm)' : ''} | ${differ(p, 'warpdom-default')} / ${differ(p, 'jsdom-vm')} / ${differ(p, 'warpdom-vm')} |`);
}

if (warnings.length) console.log('\n**Check:** ' + warnings.join('; ') + '.');
// The differ column holds the counts; this line only explains it and lists
// the flaky tests per suite (once read as the counts themselves).
if (flakyCount.size) console.log(`\nDiffer column: "N (M)", where N is the largest number of tests in any round whose status differs from the same round's jsdom-default run, and M is that number without the flaky tests. Flaky tests per suite (status changes between the suite's jsdom-default runs), not differences: ${[...flakyCount].map(([k, v]) => `${k} ${v}`).join(', ')}.`);

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
    const wd = ratio(p, 'jsdom-default', 'warpdom-default');
    const hd = ratio(p, 'jsdom-default', 'happy-dom-default');
    const wh = ratio(p, 'happy-dom-default', 'warpdom-default');
    const ok = p.size > 0;
    if (ok) { valid.wd.push(wd); valid.hd.push(hd); valid.wh.push(wh); }
    const x = (v) => (Number.isNaN(v) ? '—' : `${v.toFixed(2)}x`);
    console.log(`| ${project}${ok ? '' : ' (check)'} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m('warpdom-default'), ' s')} | ${fmt(m('happy-dom-default'), ' s')} | ${x(wd)} | ${x(hd)} | ${x(wh)} | ${differ(p, 'warpdom-default')} / ${differ(p, 'happy-dom-default')} |`);
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
    const x = ratio(p, 'jsdom-default', cfg);
    speedups.push(x);
    console.log(`| ${project} | ${fmt(m('jsdom-default'), ' s')} | ${fmt(m(cfg), ' s')} | ${cfg.replace('warpdom-learned-', '')} | ${x.toFixed(2)}x | ${differ(p, cfg)} |`);
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
      console.log(`| ${project} | ${c} | ${fmt(m, ' s')} | ${ratio(p, 'jsdom-default', c).toFixed(2)}x | ${ratio(p, 'warpdom-default', c).toFixed(2)}x | ${differ(p, c)} |`);
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
      let interval = '—';
      if (ratios.length >= 5) {
        const meds = Array.from({ length: RESAMPLES }, () => midMedian(ratios.map(() => pick(ratios, r)))).sort((x, y) => x - y);
        interval = `${percentile(meds, 0.025).toFixed(2)}-${percentile(meds, 0.975).toFixed(2)}x (95% CI)`;
      } else if (ratios.length) interval = `${Math.min(...ratios).toFixed(2)}-${Math.max(...ratios).toFixed(2)}x (range)`;
      console.log(`| ${project} | ${c} | ${rounds.length} | ${fmt(t, ' s')} | ${ratios.length ? midMedian(ratios).toFixed(2) + 'x' : '—'} | ${interval} | ${differ(p, c)} |`);
    }
  }
}

// A/A controls: per suite, the paired ratio warpdom-default / control in
// each round (> 1: the control was faster). Two identical configurations
// (warpdom-default-aa) give the noise floor of a paired ratio; the same
// for warpdom-ablate-unset bounds what the WARPDOM_ABLATE switch costs when
// no ablation is chosen.
const controls = ['warpdom-default-aa', 'warpdom-ablate-unset'].filter((c) => rows.some((r) => r[2] === c));
if (controls.length) {
  const r = rng(0xaa);
  console.log('\n**A/A controls** (paired ratio warpdom-default / control per round: median, range below 5 rounds, else 95% bootstrap interval; max deviation = largest |ratio - 1| over rounds)\n');
  console.log('| Suite | control | rounds | ratio | interval | max deviation | differ (control) |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  const pooled = Object.fromEntries(controls.map((c) => [c, []]));
  for (const [project, p] of data) {
    for (const c of controls) {
      const rounds = [...p.values()].filter((x) => x[c] && x['warpdom-default']);
      const ratios = rounds.map((x) => x['warpdom-default'].secs / x[c].secs).filter((x) => !Number.isNaN(x));
      if (!ratios.length) continue;
      pooled[c].push(...ratios);
      let interval;
      if (ratios.length >= 5) {
        const meds = Array.from({ length: RESAMPLES }, () => midMedian(ratios.map(() => pick(ratios, r)))).sort((x, y) => x - y);
        interval = `${percentile(meds, 0.025).toFixed(3)}-${percentile(meds, 0.975).toFixed(3)} (95% CI)`;
      } else interval = `${Math.min(...ratios).toFixed(3)}-${Math.max(...ratios).toFixed(3)} (range)`;
      const dev = Math.max(...ratios.map((x) => Math.abs(x - 1)));
      console.log(`| ${project} | ${c} | ${ratios.length} | ${midMedian(ratios).toFixed(3)} | ${interval} | ${(dev * 100).toFixed(1)}% | ${num(most(rounds.map((x) => x[c].differs)))} |`);
    }
  }
  for (const c of controls) {
    const v = pooled[c];
    if (!v.length) continue;
    const devs = v.map((x) => Math.abs(Math.log(x))).sort((a, b) => a - b);
    console.log(`\n${c}: ${v.length} paired rounds over all suites, median ratio ${midMedian(v).toFixed(3)}, median |log ratio| ${midMedian(devs).toFixed(3)} (${((Math.exp(midMedian(devs)) - 1) * 100).toFixed(1)}%), 95th percentile ${((Math.exp(percentile(devs, 0.95)) - 1) * 100).toFixed(1)}%.`);
  }
}

// Per package (--packages): median runner time of each configuration over
// the timed rounds and the warm-up (round 0) time, and the jsdom/warpdom
// ratio, median of per-round ratios, timed and warm-up.
if (packagesFile) {
  const prow = require('fs').readFileSync(packagesFile, 'utf8').trim().split('\n').slice(1).filter((l) => l && !l.startsWith('round,')).map((l) => l.split(','));
  const pk = new Map(); // project::package -> round -> config -> secs
  for (const [round, project, config, pkg, , secs] of prow) {
    const k = `${project}::${pkg}`;
    if (!pk.has(k)) pk.set(k, new Map());
    const m = pk.get(k);
    if (!m.has(round)) m.set(round, {});
    m.get(round)[config] = secs === 'NA' ? NaN : +secs;
  }
  const cfgs = [...new Set(prow.map((r) => r[2]))];
  const x = (v) => (Number.isNaN(v) ? '—' : `${v.toFixed(2)}x`);
  console.log('\n**Per package** (median runner seconds over the timed rounds; warm-up = round 0)\n');
  console.log(`| Suite | package | timed rounds | ${cfgs.map((c) => `${c} | ${c} warm-up`).join(' | ')} | jsdom / warpdom (timed) | jsdom / warpdom (warm-up) |`);
  console.log(`| --- | --- | --- | ${cfgs.map(() => '--- | ---').join(' | ')} | --- | --- |`);
  for (const [k, m] of pk) {
    const [project, pkg] = k.split('::');
    const timed = [...m].filter(([round]) => round !== '0').map(([, v]) => v);
    const warm = m.get('0') ?? {};
    const pr = (rs) => median(rs.map((v) => v['jsdom-default'] / v['warpdom-default']));
    const cells = cfgs.map((c) => `${fmt(median(timed.map((v) => v[c] ?? NaN)), ' s')} | ${fmt(warm[c] ?? NaN, ' s')}`).join(' | ');
    console.log(`| ${project} | ${pkg} | ${timed.length} | ${cells} | ${x(pr(timed))} | ${x(pr([warm]))} |`);
  }
}
