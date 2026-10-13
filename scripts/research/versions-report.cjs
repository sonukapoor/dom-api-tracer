#!/usr/bin/env node
// Summarizes versions.sh output (the jsdom version experiment) as Markdown,
// with a CSV and the differing tests grouped by first error line.
//
//   node scripts/research/versions-report.cjs <out dir> [--csv <file>] [--groups <file.json>]
//
// <out dir> holds <project>/<variant>/{map.json,meta.json} (several jobs'
// directories merged). Per project and variant, against own-a (the
// project's own jsdom): tests and files whose status differs, leaving out
// the flaky ones (status differs between own-a and own-b, statuses.cjs
// flaky); NA with the reason when the install or run failed or own-a
// itself failed. "forced" says whether every package's runner resolved the
// forced version (versions.cjs resolved; packages without a jsdom of their
// own use the one linked in). Differing tests are grouped by status change
// and the first line of the failure message (numbers folded to N).
// "jsdom resolved" also lists the versions of jsdom's dependencies it loads
// (versions.cjs DEPS), marked "outside" when not in jsdom's declared range,
// and the dependencies versions.sh forced to jsdom's ranges; the CSV has
// them in columns of their own.
const fs = require('fs');
const path = require('path');
const S = require('./statuses.cjs');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const csvFile = opt('--csv');
const groupsFile = opt('--groups');
const [outDir] = args;
if (!outDir) { process.stderr.write('usage: versions-report.cjs <out dir> [--csv <file>] [--groups <file.json>]\n'); process.exit(2); }

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ORDER = (v) => (v === 'own-a' ? 0 : v === 'own-b' ? 1 : 2);
const byVersion = (a, b) => ORDER(a) - ORDER(b) || a.localeCompare(b, 'en', { numeric: true });

// What a variant forces: { name, version } from "jsdom-26.1.0".
const forcedOf = (variant) => { const m = variant.match(/^(jsdom|cssstyle)-(.+)$/); return m ? { name: m[1], version: m[2] } : null; };

const DEPS = ['cssstyle', 'nwsapi', 'parse5', 'whatwg-url'];
// The versions of a dependency over the packages ("a / b"), "outside" when
// some package's jsdom loads it outside its range.
function depVersions(meta, d) {
  const rs = Object.values(meta?.resolved ?? {});
  const vs = [...new Set(rs.map((r) => r[d]).filter(Boolean))].join(' / ');
  return vs && rs.some((r) => r.inconsistent?.includes(d)) ? `${vs} outside ${[...new Set(rs.map((r) => r.ranges?.[d]).filter(Boolean))].join(' / ')}` : vs;
}
function jsdomSummary(meta) {
  const vs = Object.values(meta?.resolved ?? {}).map((r) => r.jsdom ?? `linked ${meta.linked ?? '?'}`);
  const deps = DEPS.map((d) => [d, depVersions(meta, d)]).filter(([, v]) => v).map(([d, v]) => `${d} ${v}`);
  const forcedDeps = meta?.forced_deps?.length ? `; forced ${meta.forced_deps.join(', ')}` : '';
  return [...new Set(vs)].join(' / ') + (deps.length || forcedDeps ? ` (${deps.join(', ')}${forcedDeps})` : '');
}

function forced(meta, f) {
  if (!f || !meta?.resolved) return '';
  const pkgs = Object.values(meta.resolved);
  const ok = pkgs.filter((r) => (f.name === 'jsdom'
    ? (r.jsdom === f.version || (r.jsdom === null && meta.linked === `jsdom@${f.version}`))
    : r.cssstyle === f.version)).length;
  return ok === pkgs.length ? 'yes' : ok === 0 ? 'no' : `${ok}/${pkgs.length} packages`;
}

const fold = (m) => (m || '').replace(/\d+/g, 'N');
function groups(base, run, exclude) {
  const g = new Map();
  for (const k of S.differingKeys(base.tests, run.tests)) {
    if (exclude.tests.has(k)) continue;
    const a = base.tests[k], b = run.tests[k];
    const msg = b?.m ? fold(b.m) : a?.m ? `(own) ${fold(a.m)}` : '';
    const key = `${a?.s ?? 'missing'} -> ${b?.s ?? 'missing'} | ${msg}`;
    if (!g.has(key)) g.set(key, { key, count: 0, examples: [] });
    const e = g.get(key);
    e.count++;
    if (e.examples.length < 3) e.examples.push(k);
  }
  return [...g.values()].sort((x, y) => y.count - x.count);
}

const rows = [];
const allGroups = {};
const projects = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((p) => fs.existsSync(path.join(outDir, p, 'own-a'))).sort() : [];
for (const p of projects) {
  const dir = path.join(outDir, p);
  const variants = fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, 'meta.json'))).sort(byVersion);
  const meta = Object.fromEntries(variants.map((v) => [v, readJson(path.join(dir, v, 'meta.json'))]));
  const map = (v) => S.read(path.join(dir, v, 'map.json'));
  const ownOk = meta['own-a']?.status === 'ok';
  const ownBOk = meta['own-b']?.status === 'ok';
  const a = map('own-a');
  const fl = ownOk && ownBOk ? S.flaky(a, map('own-b')) : { tests: new Set(), files: new Set() };
  for (const v of variants) {
    const m = meta[v];
    const run = map(v);
    const row = {
      project: p, variant: v, status: m?.status ?? 'NA', reason: m?.reason ?? '', jsdom: jsdomSummary(m), forced: forced(m, forcedOf(v)),
      tests: Object.keys(run.tests).length, files: Object.keys(run.files).length, seconds: m?.seconds ?? null,
      tests_differ: null, files_differ: null, flaky_tests: fl.tests.size, flaky_files: fl.files.size,
      ...Object.fromEntries(DEPS.map((d) => [d.replace('-', '_'), depVersions(m, d)])),
      forced_deps: (m?.forced_deps ?? []).join('; '),
    };
    if (!ownOk && v !== 'own-a') { row.status = 'NA'; row.reason = row.reason || 'own-a (the project\'s own jsdom) failed'; }
    if (!ownBOk) row.flaky_tests = row.flaky_files = null;
    if (row.status === 'ok' && v === 'own-b') {
      // own-b against own-a: these differences are the flaky ones.
      const c = S.compare(a, run);
      row.tests_differ = c.differs; row.files_differ = c.filesDiffer;
    } else if (row.status === 'ok' && v !== 'own-a') {
      const c = S.compare(a, run, null, fl);
      row.tests_differ = c.differs; row.files_differ = c.filesDiffer;
      const g = groups(a, run, fl);
      if (g.length) allGroups[`${p} ${v}`] = g;
    } else if (v === 'own-a' && row.status === 'ok') { row.tests_differ = 0; row.files_differ = 0; }
    rows.push(row);
  }
}

const cell = (r, k) => (r.status !== 'ok' ? 'NA' : r[k] ?? '—');
console.log('**jsdom version dependence** (jsdom only; tests and files whose status differs from the project\'s own jsdom (own-a), flaky ones left out: those that differ between own-a and own-b; own-b\'s row shows the flaky counts)\n');
console.log('| Suite | variant | jsdom resolved | forced | tests | tests differing | files differing | flaky tests / files | seconds | NA reason |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(`| ${r.project} | ${r.variant} | ${r.jsdom || '—'} | ${r.forced || '—'} | ${r.status === 'ok' ? r.tests : '—'} | ${cell(r, 'tests_differ')} | ${cell(r, 'files_differ')} | ${r.flaky_tests ?? '—'} / ${r.flaky_files ?? '—'} | ${r.seconds ?? '—'} | ${r.status === 'ok' ? '' : (r.reason || '').replace(/\|/g, '\\|').slice(0, 160)} |`);
}

// Matrix: tests differing per suite and variant.
const vs = [...new Set(rows.map((r) => r.variant))].filter((v) => v !== 'own-a').sort(byVersion);
if (rows.length) {
  console.log(`\n| Suite | ${vs.join(' | ')} |`);
  console.log(`| --- | ${vs.map(() => '---').join(' | ')} |`);
  for (const p of projects) {
    console.log(`| ${p} | ${vs.map((v) => { const r = rows.find((x) => x.project === p && x.variant === v); return r ? (r.status === 'ok' ? `${r.tests_differ} (${r.files_differ} files)` : 'NA') : ''; }).join(' | ')} |`);
  }
}

const keys = Object.keys(allGroups);
if (keys.length) {
  console.log('\n**Differing tests by first error line** (largest groups first, at most 8 per suite and variant)\n');
  for (const k of keys) {
    console.log(`- ${k}`);
    for (const g of allGroups[k].slice(0, 8)) console.log(`  - ${g.count} × \`${g.key.replace(/`/g, "'").slice(0, 220)}\` (e.g. ${g.examples[0]})`);
  }
}

if (csvFile) {
  const cols = ['project', 'variant', 'status', 'jsdom', 'forced', ...DEPS.map((d) => d.replace('-', '_')), 'forced_deps', 'tests', 'files', 'tests_differ', 'files_differ', 'flaky_tests', 'flaky_files', 'seconds', 'reason'];
  const q = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(csvFile, [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n') + '\n');
}
if (groupsFile) fs.writeFileSync(groupsFile, JSON.stringify(allGroups, null, 2));
