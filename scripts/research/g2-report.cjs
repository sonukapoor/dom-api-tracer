#!/usr/bin/env node
// Report of g2-shuffle.sh: assumption G2 of learned isolation under
// shuffled file orders. Per suite: the seeds run, the tests, the candidate
// G2 violations, their classification and the file orders behind them.
//
//   g2-report.cjs <out dir> [--json <file>]   Markdown report of every
//       project directory under <out dir> (those with a runs.csv)
//   g2-report.cjs files <project dir>         the candidates' test files
//       (absolute, space-separated), for g2-shuffle.sh's confirm runs
//
// Definitions (statuses.cjs map form; keys as statuses.cjs):
//   reference runs  iso-<n>.json, warpdom isolated
//   shuffled runs   shared-s<seed>.json (warpdom-sharedreset) and
//                   learned-s<seed>.json (warpdom's fast mode), files shuffled
//   candidate       a test that passes in a shuffled run and does not pass
//                   (fails, is skipped or is missing) in every reference run;
//                   counted per test and per run (test x seed)
//   confirm runs    confirm-<n>.json, the candidates' files isolated again
// Classification of a candidate test:
//   nondeterministic  it passes in a confirm run, or its passing result in a
//                     learned run came from an isolated run of its file (the
//                     split's isolated part or the safety net's rerun): it
//                     passes isolated too, sometimes (not a G2 violation)
//   leak-induced      it never passes isolated (references and confirm runs)
//                     and passes when shared: a G2 violation; "every order"
//                     when it passes in every shuffled run of the
//                     configuration that has a result for it, else "some
//                     orders" (then the file orders show what ran before it)
//   unconfirmed       no confirm run has a result for its file
// The file order of a candidate in a run: the test files its worker ran
// before it, in order (order-setup.mjs rows of the run whose isolate is
// false; seq, then time).
const fs = require('fs');
const path = require('path');
const { read } = require('./statuses.cjs');

const KINDS = ['shared', 'learned'];

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function readRuns(dir) {
  const file = path.join(dir, 'runs.csv');
  if (!fs.existsSync(file)) return [];
  const [head, ...lines] = fs.readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

// One project directory: its runs, maps and orders.
function loadProject(dir) {
  const runs = readRuns(dir);
  const label = (re) => fs.readdirSync(dir).map((f) => f.match(re)).filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const maps = (re) => label(re).map((m) => ({ label: m[0].replace(/\.json$/, ''), n: Number(m[1]), map: read(path.join(dir, m[0])) }));
  const shuffled = Object.fromEntries(KINDS.map((k) => [k, maps(new RegExp(`^${k}-s(\\d+)\\.json$`)).map((r) => ({ ...r, seed: r.n, order: readJsonl(path.join(dir, `${r.label}.order.jsonl`)) }))]));
  return {
    name: path.basename(dir),
    runs,
    iso: maps(/^iso-(\d+)\.json$/),
    confirm: maps(/^confirm-(\d+)\.json$/),
    shuffled,
    method: fs.existsSync(path.join(dir, 'method')) ? fs.readFileSync(path.join(dir, 'method'), 'utf8').trim() : null,
  };
}

const passed = (map, key) => map.tests[key]?.s === 'passed';
const status = (map, key) => map.tests[key]?.s ?? 'missing';
// The key's test file key (statuses.cjs: <slug>::<file>::<name>).
const fileKeyOf = (key) => key.split('::').slice(0, 2).join('::');

// Candidates of one configuration: [{ key, file, seeds: [seed...] }], the
// tests passing in a shuffled run but in no reference run.
function candidates(iso, runs) {
  const out = new Map();
  for (const r of runs) {
    for (const [key, v] of Object.entries(r.map.tests)) {
      if (v.s !== 'passed' || iso.some((i) => passed(i.map, key))) continue;
      if (!out.has(key)) out.set(key, { key, file: v.file, seeds: [] });
      out.get(key).seeds.push(r.seed);
    }
  }
  return [...out.values()];
}

// The classification of one candidate (see the header).
// perSeed: [{ isolated }], whether the passing result came from an isolated run.
function classify(c, runs, confirm, perSeed = []) {
  const withResult = confirm.filter((m) => m.map.tests[c.key] || m.map.files[fileKeyOf(c.key)]);
  if (confirm.some((m) => passed(m.map, c.key)) || perSeed.some((p) => p.isolated)) return { class: 'nondeterministic' };
  if (!withResult.length) return { class: 'unconfirmed' };
  const had = runs.filter((r) => r.map.tests[c.key]);
  return { class: 'leak-induced', orders: c.seeds.length === had.length ? 'every order' : 'some orders' };
}

// The test files the worker that ran <file> (absolute) ran up to and
// including it, in a run's order rows; null when the file did not run in
// a shared worker. Files relative to root when given.
function orderBefore(rows, file, root) {
  const rel = (f) => (root && f?.startsWith(root + '/') ? f.slice(root.length + 1) : f);
  const own = rows.find((r) => r.file === file && r.isolate === false);
  if (!own) return null;
  const worker = rows.filter((r) => r.worker === own.worker && r.main === own.main && r.isolate === false)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.t - b.t);
  return { worker: own.worker, files: worker.slice(0, worker.indexOf(own) + 1).map((r) => rel(r.file)) };
}

// Whether a run's result for <file> came from an isolated worker (the
// learned run's isolated part, or the safety net's rerun, whose result
// replaces the shared one).
const ranIsolated = (rows, file) => rows.some((r) => r.file === file && r.isolate === true);

// Per worker file sequences of a run (shared workers only), as one string:
// how many distinct orders the seeds produced.
const signature = (rows) => {
  const by = new Map();
  for (const r of rows.filter((x) => x.isolate === false).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.t - b.t)) {
    const k = `${r.main}/${r.worker}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r.file);
  }
  return JSON.stringify([...by.values()].map((v) => v.join('\n')).sort());
};

// The project checkout as the runs saw it: from a map entry whose file key
// and absolute file are both known.
function rootOf(project) {
  for (const m of [...project.iso, ...KINDS.flatMap((k) => project.shuffled[k])]) {
    for (const [k, v] of Object.entries(m.map.files)) {
      const rel = k.split('::')[1];
      if (rel && v.file?.endsWith('/' + rel)) return v.file.slice(0, -rel.length - 1);
    }
  }
  return null;
}

function analyse(project) {
  const root = rootOf(project);
  const tests = new Set(project.iso.flatMap((i) => Object.keys(i.map.tests)));
  const kinds = {};
  for (const kind of KINDS) {
    const runs = project.shuffled[kind];
    const cands = candidates(project.iso, runs).map((c) => {
      const perSeed = c.seeds.map((seed) => {
        const r = runs.find((x) => x.seed === seed);
        return { seed, isolated: ranIsolated(r.order, c.file), order: orderBefore(r.order, c.file, root) };
      });
      return {
        ...c,
        iso: project.iso.map((i) => status(i.map, c.key)),
        confirm: project.confirm.map((m) => status(m.map, c.key)),
        ...classify(c, runs, project.confirm, perSeed),
        perSeed,
      };
    });
    kinds[kind] = {
      seeds: runs.map((r) => r.seed),
      failedSeeds: project.runs.filter((r) => r.kind === kind && r.status !== 'ok').map((r) => Number(r.seed)),
      orders: new Set(runs.filter((r) => r.order.some((x) => x.isolate === false)).map((r) => signature(r.order))).size,
      sharedFiles: runs.map((r) => new Set(r.order.filter((x) => x.isolate === false).map((x) => x.file)).size),
      candidates: cands,
      runCandidates: cands.reduce((n, c) => n + c.seeds.length, 0),
      byClass: cands.reduce((o, c) => ({ ...o, [c.class]: (o[c.class] ?? 0) + 1 }), {}),
    };
  }
  return { name: project.name, method: project.method, root, isoRuns: project.iso.length, confirmRuns: project.confirm.length, tests: tests.size, kinds };
}

function markdown(results) {
  const out = [];
  const classes = (b) => ['leak-induced', 'nondeterministic', 'unconfirmed'].map((c) => b[c] ?? 0).join(' / ');
  out.push('## G2 under shuffled file orders', '',
    'Candidate: passes in a shuffled run, does not pass in any isolated reference run. Classes: leak-induced (never passes isolated, confirm runs included) / nondeterministic (passes in a confirm run) / unconfirmed (no confirm result). Orders: distinct per-worker file orders among the seeds\' shared workers.', '',
    '| Suite | method | references | confirm runs | tests | shared: seeds (orders) | shared: candidate tests (test x seed) | shared: classes | learned: seeds (orders) | learned: shared files (median) | learned: candidate tests (test x seed) | learned: classes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 'NA'; };
  for (const r of results) {
    const s = r.kinds.shared, l = r.kinds.learned;
    const seeds = (k) => `${k.seeds.length}${k.failedSeeds.length ? ` (+${k.failedSeeds.length} failed)` : ''} (${k.orders})`;
    out.push(`| ${r.name} | ${r.method ?? '-'} | ${r.isoRuns} | ${r.confirmRuns} | ${r.tests} | ${seeds(s)} | ${s.candidates.length} (${s.runCandidates}) | ${classes(s.byClass)} | ${seeds(l)} | ${median(l.sharedFiles)} | ${l.candidates.length} (${l.runCandidates}) | ${classes(l.byClass)} |`);
  }
  const all = results.flatMap((r) => KINDS.flatMap((k) => r.kinds[k].candidates.map((c) => ({ suite: r.name, kind: k, ...c }))));
  out.push('', `## Candidates (${all.length})`, '');
  if (!all.length) out.push('None.');
  for (const c of all) {
    out.push(`### ${c.suite}, ${c.kind}: ${c.key}`, '',
      `- class: **${c.class}**${c.orders ? ` (${c.orders})` : ''}`,
      `- passes in seeds ${c.seeds.join(', ')}; references: ${c.iso.join(', ')}; confirm runs: ${c.confirm.join(', ') || 'none'}`);
    for (const p of c.perSeed) {
      if (p.isolated) { out.push(`- seed ${p.seed}: the result came from an isolated run of the file`); continue; }
      if (!p.order) { out.push(`- seed ${p.seed}: the file did not run in a shared worker`); continue; }
      out.push(`- seed ${p.seed}, worker ${p.order.worker}, ${p.order.files.length} file(s) up to it: ${p.order.files.map((f) => `\`${f}\``).join(' -> ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}

module.exports = { loadProject, candidates, classify, orderBefore, ranIsolated, signature, analyse, markdown };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'files') {
    const project = loadProject(args[1]);
    const files = new Set(KINDS.flatMap((k) => candidates(project.iso, project.shuffled[k]).map((c) => c.file)));
    console.log([...files].join(' '));
  } else if (args[0]) {
    const ji = args.indexOf('--json');
    const json = ji >= 0 ? args.splice(ji, 2)[1] : null;
    const dir = args[0];
    const results = fs.readdirSync(dir).sort()
      .filter((d) => fs.existsSync(path.join(dir, d, 'runs.csv')))
      .map((d) => analyse(loadProject(path.join(dir, d))));
    if (json) fs.writeFileSync(json, JSON.stringify(results, null, 2));
    console.log(markdown(results));
  } else {
    process.stderr.write('usage: g2-report.cjs <out dir> [--json <file>] | g2-report.cjs files <project dir>\n');
    process.exit(2);
  }
}
