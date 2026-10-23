#!/usr/bin/env node
// Summarizes ablation-isolation.sh (and learned.sh) results as Markdown.
//
//   node scripts/research/ablation-report.cjs <csv> [--learning <jsonl>] [--pertest <dir>]
//
// <csv>: round,project,config,seconds,differs,files_differ,false_pass,
// false_fail,ref,position,method (several jobs' CSVs concatenated under
// one header). --learning: the learning records (<csv>.learning.jsonl,
// concatenated). --pertest: the per-test statuses ($PERTEST_DIR), for the
// exact flaky-test allowance below.
//
// 1. Per suite and configuration: rounds with a time, median time, speedup
//    over jsdom-default (median of per-round ratios; the range below 5
//    rounds, else a 95% bootstrap interval), differing tests and files
//    (median and maximum over rounds), false passes and false fails
//    against the same DOM's isolated run (sum over rounds; for
//    warpdom-learned the false passes are G2 violations).
// 2. Per suite, the best correct jsdom configuration: the fastest (median
//    time) of jsdom-default, jsdom-shared, jsdom-vm and jsdom-sharedclean
//    (no isolation plus shared-cleanup.mjs) whose results match
//    jsdom-default in every round, and warpdom-learned's speedup over it.
//    "Match": with --pertest, every differing test is one that also
//    changes between jsdom-default runs (the warm-up's included: flaky,
//    the timing report's FLAKY idea made exact); without, differs is 0 in
//    every round.
// 3. The suites where every non-default jsdom configuration changes results.
// 3b. Policy and DOM: per suite with jsdom-learned (learned isolation's
//    policy on jsdom, no reset), its speedup over jsdom-default and
//    warpdom-learned's over it (what warpdom's DOM adds to the policy).
// 4. Learning stability: per suite and learned configuration, the learnings (round 0 = the warm-up's,
//    then one per round), mean pairwise Jaccard similarity of the leaky
//    sets, mode agreement (share of learnings choosing the most common
//    mode), the learning cost (t_sh + t_split: what learning adds to an
//    isolated run, whose result it reports) and the break-even number of
//    runs: cost / (t_iso - t_learned), t_iso and t_learned the medians of
//    the timed warpdom-default and warpdom-learned runs.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const learningFile = opt('--learning');
const pertestDir = opt('--pertest');
const [csvFile] = args;
if (!csvFile) {
  process.stderr.write('usage: ablation-report.cjs <csv> [--learning <jsonl>] [--pertest <dir>]\n');
  process.exit(2);
}

const lines = fs.readFileSync(csvFile, 'utf8').trim().split('\n');
const header = lines[0].split(',');
const rows = lines
  .slice(1)
  .filter((l) => l && !l.startsWith('round,'))
  .map((l) => Object.fromEntries(l.split(',').map((v, i) => [header[i], v])));
const n = (v) => (v === undefined || v === '' || v === 'NA' ? NaN : +v);
const data = new Map(); // project -> round -> config -> row
for (const r of rows) {
  if (!data.has(r.project)) data.set(r.project, new Map());
  const p = data.get(r.project);
  if (!p.has(r.round)) p.set(r.round, {});
  p.get(r.round)[r.config] = {
    secs: n(r.seconds),
    differs: n(r.differs),
    files: n(r.files_differ),
    fp: n(r.false_pass),
    ff: n(r.false_fail),
    method: r.method,
  };
}
// The jsdom configurations: the baseline and its alternatives.
const JSDOMS = ['jsdom-default', 'jsdom-shared', 'jsdom-vm', 'jsdom-sharedclean'];
const ORDER = [
  ...JSDOMS,
  'jsdom-learned',
  'warpdom-default',
  'warpdom-vm',
  'warpdom-sharedfresh',
  'warpdom-sharedreset',
  'warpdom-learned',
  'happydom-shared',
];
const configsOf = (p) => {
  const s = new Set([...p.values()].flatMap((r) => Object.keys(r)));
  return [...ORDER.filter((c) => s.has(c)), ...[...s].filter((c) => !ORDER.includes(c))];
};

const valid = (a) => a.filter((x) => !Number.isNaN(x));
const midMedian = (a) => {
  const v = valid(a).sort((x, y) => x - y);
  const k = v.length;
  return k ? (k % 2 ? v[k >> 1] : (v[k / 2 - 1] + v[k / 2]) / 2) : NaN;
};
const max = (a) => (valid(a).length ? Math.max(...valid(a)) : NaN);
const total = (a) => (valid(a).length ? valid(a).reduce((s, x) => s + x, 0) : NaN);
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (a, r) => a[Math.floor(r() * a.length)];
const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const RESAMPLES = 10000;
const random = rng(0xab1a7e);
function interval(ratios) {
  const v = valid(ratios);
  if (!v.length) return '—';
  if (v.length < 5) return `${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)}x (range)`;
  const meds = Array.from({ length: RESAMPLES }, () => midMedian(v.map(() => pick(v, random)))).sort((x, y) => x - y);
  return `${percentile(meds, 0.025).toFixed(2)}-${percentile(meds, 0.975).toFixed(2)}x (95% CI)`;
}
const fmt = (x, d = 1, unit = '') => (Number.isNaN(x) ? '—' : `${x.toFixed(d)}${unit}`);
const cnt = (x) => (Number.isNaN(x) ? '—' : String(x));
const ratiosOf = (p, a, b) => [...p.values()].map((r) => (r[a] && r[b] ? r[a].secs / r[b].secs : NaN));
const timed = (p, c) => [...p.values()].filter((r) => r[c]);
const medTime = (p, c) => midMedian(timed(p, c).map((r) => r[c].secs));

// 1. Configurations.
console.log('## Configurations against jsdom-default\n');
console.log(
  "Speedup: median of per-round ratios to the same round's jsdom-default run. Differing tests and files: median (max) over rounds, against that round's jsdom-default. False passes / fails: sums over rounds, against the same DOM's isolated run (warpdom-default, or jsdom-default for jsdom and happy-dom).\n",
);
console.log(
  '| Suite | configuration | rounds | median time | speedup | interval | tests differ | files differ | false passes | false fails |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [project, p] of data) {
  for (const c of configsOf(p)) {
    const rs = timed(p, c);
    const ok = rs.filter((r) => !Number.isNaN(r[c].secs)).length;
    const ratios = ratiosOf(p, 'jsdom-default', c);
    const method = rs.find((r) => r[c].method)?.[c].method;
    console.log(
      `| ${project} | ${c}${method ? ` (${method})` : ''} | ${ok}/${rs.length} | ${fmt(medTime(p, c), 1, ' s')} | ${c === 'jsdom-default' ? '1.00x' : fmt(midMedian(ratios), 2, 'x')} | ${c === 'jsdom-default' ? '' : interval(ratios)} | ${cnt(midMedian(rs.map((r) => r[c].differs)))} (${cnt(max(rs.map((r) => r[c].differs)))}) | ${cnt(midMedian(rs.map((r) => r[c].files)))} (${cnt(max(rs.map((r) => r[c].files)))}) | ${cnt(total(rs.map((r) => r[c].fp)))} | ${cnt(total(rs.map((r) => r[c].ff)))} |`,
    );
  }
}

// Exact flaky allowance from the per-test statuses: tests whose status is
// not the same in every jsdom-default run of the suite.
function readMap(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function pertestRounds(project) {
  if (!pertestDir || !fs.existsSync(pertestDir)) return [];
  return fs.readdirSync(pertestDir).filter((r) => fs.existsSync(path.join(pertestDir, r, project)));
}
function flakySet(project) {
  const maps = pertestRounds(project)
    .map((r) => readMap(path.join(pertestDir, r, project, 'jsdom-default.json')))
    .filter(Boolean);
  const flaky = new Set();
  const keys = new Set(maps.flatMap((m) => Object.keys(m.tests)));
  for (const k of keys) if (new Set(maps.map((m) => m.tests[k]?.s)).size > 1) flaky.add(k);
  return { flaky, rounds: maps.length };
}
function correct(project, p, c) {
  if (c === 'jsdom-default') return true;
  const rs = timed(p, c);
  if (!rs.length || rs.some((r) => Number.isNaN(r[c].secs))) return false;
  const rounds = pertestRounds(project).filter((r) => r !== '0');
  if (pertestDir && rounds.length) {
    const { flaky } = flakySet(project);
    for (const r of rounds) {
      const base = readMap(path.join(pertestDir, r, project, 'jsdom-default.json'));
      const run = readMap(path.join(pertestDir, r, project, `${c}.json`));
      if (!base || !run) return false;
      for (const k of new Set([...Object.keys(base.tests), ...Object.keys(run.tests)])) {
        if (base.tests[k]?.s !== run.tests[k]?.s && !flaky.has(k)) return false;
      }
    }
    return true;
  }
  // Counts only (each round's jsdom-default is its own baseline, so its
  // spread is not in the CSV): no differing test at all.
  return rs.every((r) => r[c].differs === 0);
}

// 2 and 3. Best correct jsdom configuration.
console.log('\n## Best correct jsdom configuration\n');
console.log(
  `The fastest of ${JSDOMS.join(', ')} (those that ran) whose results match jsdom-default in every round (${pertestDir ? 'allowing only tests that also change between jsdom-default runs' : 'no differing test in any round; pass --pertest to allow tests that change between jsdom-default runs'}), and warpdom-learned's speedup over it (per-round ratios).\n`,
);
console.log(
  '| Suite | correct jsdom configurations | best | its median time | warpdom-learned | speedup over best | interval | learned tests differ (max) | learned false passes |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const everyBreaks = [];
const learnedOverBest = [];
for (const [project, p] of data) {
  const jsdoms = JSDOMS.filter((c) => timed(p, c).length);
  const ok = jsdoms.filter((c) => correct(project, p, c) && !Number.isNaN(medTime(p, c)));
  const others = jsdoms.filter((c) => c !== 'jsdom-default');
  if (others.length && others.every((c) => !ok.includes(c))) everyBreaks.push(`${project} (${others.join(', ')})`);
  const best = ok.sort((a, b) => medTime(p, a) - medTime(p, b))[0];
  const hasLearned = timed(p, 'warpdom-learned').length > 0;
  const ratios = best && hasLearned ? ratiosOf(p, best, 'warpdom-learned') : [];
  if (valid(ratios).length) learnedOverBest.push({ project, ratios: valid(ratios) });
  const L = timed(p, 'warpdom-learned');
  console.log(
    `| ${project} | ${ok.join(', ') || '—'} | ${best ?? '—'} | ${best ? fmt(medTime(p, best), 1, ' s') : '—'} | ${hasLearned ? fmt(medTime(p, 'warpdom-learned'), 1, ' s') : '—'} | ${fmt(midMedian(ratios), 2, 'x')} | ${interval(ratios)} | ${L.length ? cnt(max(L.map((r) => r['warpdom-learned'].differs))) : '—'} | ${L.length ? cnt(total(L.map((r) => r['warpdom-learned'].fp))) : '—'} |`,
  );
}
if (learnedOverBest.length) {
  const point = midMedian(learnedOverBest.map((s) => midMedian(s.ratios)));
  const r = rng(0x5eed);
  const boot = Array.from({ length: RESAMPLES }, () =>
    midMedian(
      learnedOverBest.map(() => pick(learnedOverBest, r)).map((s) => midMedian(s.ratios.map(() => pick(s.ratios, r)))),
    ),
  ).sort((x, y) => x - y);
  console.log(
    `\nwarpdom-learned over the best correct jsdom configuration, median over ${learnedOverBest.length} suites: ${point.toFixed(2)}x (95% bootstrap interval ${percentile(boot, 0.025).toFixed(2)}-${percentile(boot, 0.975).toFixed(2)}x, suites and rounds resampled).`,
  );
}
console.log(
  `\n**Suites where every non-default jsdom configuration changes results:** ${everyBreaks.length ? everyBreaks.join('; ') : 'none'}.`,
);

// 3b. Policy and DOM.
const withJl = [...data].filter(([, p]) => timed(p, 'jsdom-learned').length);
if (withJl.length) {
  console.log('\n## Policy and DOM\n');
  console.log(
    "jsdom-learned: learned isolation's policy (the harness emulation) on jsdom, without any reset between files. Speedups: median of per-round ratios. Differing tests: max over rounds against jsdom-default; false passes: sum over rounds (G2 violations).\n",
  );
  console.log(
    '| Suite | jsdom-learned | over jsdom-default | interval | tests differ (max) | false passes | warpdom-learned over jsdom-learned | interval |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [project, p] of withJl) {
    const J = timed(p, 'jsdom-learned');
    const a = ratiosOf(p, 'jsdom-default', 'jsdom-learned');
    const b = timed(p, 'warpdom-learned').length ? ratiosOf(p, 'jsdom-learned', 'warpdom-learned') : [];
    console.log(
      `| ${project} | ${fmt(medTime(p, 'jsdom-learned'), 1, ' s')} | ${fmt(midMedian(a), 2, 'x')} | ${interval(a)} | ${cnt(max(J.map((r) => r['jsdom-learned'].differs)))} | ${cnt(total(J.map((r) => r['jsdom-learned'].fp)))} | ${fmt(midMedian(b), 2, 'x')} | ${interval(b)} |`,
    );
  }
}

// 4. Learning.
if (learningFile && fs.existsSync(learningFile)) {
  const recs = fs
    .readFileSync(learningFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const jaccard = (a, b) => {
    const A = new Set(a),
      B = new Set(b);
    const u = new Set([...A, ...B]);
    if (!u.size) return 1;
    let i = 0;
    for (const x of A) if (B.has(x)) i++;
    return i / u.size;
  };
  console.log('\n## Learning stability and cost\n');
  console.log(
    "Learnings: round 0 (the warm-up; the timed learned runs use its state) and one from scratch per round. Jaccard: mean over pairs of learnings of the leaky sets' similarity (1 = identical). Learning cost: median t_sh + t_split. Break-even: cost / (median isolated run - median learned run), the isolated run being the same DOM's default (warpdom-default, or jsdom-default for jsdom-learned).\n",
  );
  console.log(
    '| Suite | configuration | method | learnings | leaky files (min-max) | Jaccard | modes | mode agreement | median t_iso / t_sh / t_split | learning cost | break-even runs | new leaky in timed runs | files re-run |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  // Records without a config are warpdom-learned's (cli, older emulation).
  const cfgOf = (r) => r.config ?? 'warpdom-learned';
  const groups = [...new Set(recs.map((r) => `${r.project}\t${cfgOf(r)}`))];
  for (const g of groups) {
    const [project, config] = g.split('\t');
    const isolatedOf = config === 'jsdom-learned' ? 'jsdom-default' : 'warpdom-default';
    const L = recs.filter((r) => r.project === project && cfgOf(r) === config && r.kind === 'learn');
    const R = recs.filter((r) => r.project === project && cfgOf(r) === config && r.kind === 'run');
    const pairs = [];
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) pairs.push(jaccard(L[i].leaky, L[j].leaky));
    const modes = new Map();
    for (const r of L) modes.set(r.mode, (modes.get(r.mode) ?? 0) + 1);
    const top = Math.max(0, ...modes.values());
    const cost = midMedian(L.map((r) => (r.t_sh == null || r.t_split == null ? NaN : r.t_sh + r.t_split)));
    const p = data.get(project);
    const gain = p ? medTime(p, isolatedOf) - medTime(p, config) : NaN;
    const breakEven =
      Number.isNaN(cost) || Number.isNaN(gain)
        ? '—'
        : gain <= 0
          ? 'never (learned not faster)'
          : (cost / gain).toFixed(1);
    const sizes = L.map((r) => r.leaky.length);
    const m = (k) => fmt(midMedian(L.map((r) => (r[k] == null ? NaN : r[k]))), 1);
    console.log(
      `| ${project} | ${config} | ${[...new Set(L.map((r) => r.method))].join(', ')} | ${L.length} | ${sizes.length ? `${Math.min(...sizes)}-${Math.max(...sizes)}` : '—'} | ${pairs.length ? (pairs.reduce((s, x) => s + x, 0) / pairs.length).toFixed(2) : '—'} | ${[...modes].map(([k, v]) => `${k} ${v}`).join(', ')} | ${L.length ? (top / L.length).toFixed(2) : '—'} | ${m('t_iso')} / ${m('t_sh')} / ${m('t_split')} s | ${fmt(cost, 1, ' s')} | ${breakEven} | ${R.reduce((s, r) => s + (r.new_leaky?.length ?? 0), 0)} | ${R.reduce((s, r) => s + (r.rerun ?? 0), 0)} |`,
    );
  }
}
