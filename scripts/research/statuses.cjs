#!/usr/bin/env node
// Per-test statuses of corpus runs: the one key definition and the counting
// used by every research script (timing-rounds.sh, ablation-isolation.sh,
// learned.sh), so "tests that differ" means the same thing everywhere.
//
// A status map (the normalized, archived form) is
//   { tests: { <key>: { s: <status>, file: <absolute test file> } },
//     files: { <fileKey>: { s: <file status>, file: <absolute test file> } } }
// with
//   fileKey = <package slug>::<test file relative to the project checkout>
//   key     = <fileKey>::<full test name>, and " #<n>" appended to the n-th
//             (n >= 2) test of the same file with the same full name.
// The file status is the runner's ("failed" when the file failed to run or
// any of its tests failed). Tests and files are counted separately: a file
// that fails to load is one file difference plus its missing tests, never
// an extra "test". `.file` (absolute) is kept for re-running files and for
// merging re-run results.
//
//   statuses.cjs map <results dir> <env> <out.json> [--root <project dir>]
//       Vitest/Jest JSON results (<slug>.<env>.json) -> a status map.
//   statuses.cjs compare <base.json> <run.json> [<ref.json>]
//       prints "differs files_differ false_pass false_fail": tests and files
//       whose status differs from base; with ref, tests passed in run but not
//       in ref (failed, skipped or missing) and the reverse.
//   statuses.cjs failing <map.json>        failing test files (absolute), one line
//   statuses.cjs leaky <shared.json> <isolated.json>
//       files failing in shared that do not fail isolated (warpdom's
//       newlyLeaky: "fails without isolation, passes isolated")
//   statuses.cjs isolate <shared.json> <isolated.json>
//       files to run isolated: failing in shared, or a test or file whose
//       status differs from isolated or is missing (warpdom's learning,
//       state version 2)
//   statuses.cjs merge <out.json> <first.json> [<rerun.json>...]
//       first, with every file present in a rerun replaced by its rerun result
//   statuses.cjs count <map.json>          prints "tests files"
const fs = require('fs');
const path = require('path');

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

// The part of a test file path that is the same on every machine.
function relativeFile(name, root) {
  // The root as the runner reports paths: resolved (CI passes .../dom-api-tracer/../repos/<project>)
  // and with symbolic links followed.
  if (root) {
    for (const r of new Set([path.resolve(root), realpath(root)])) {
      if (name.startsWith(r + '/')) return name.slice(r.length + 1);
    }
  }
  // Without the checkout (an old baseline from another directory): from the
  // first packages/src/test/tests/examples directory on, so monorepo
  // packages keep their own directory.
  const m = name.match(/^.*?\/(packages|src|test|tests|examples)\/(.*)$/);
  return m ? m[2] : name;
}

// First line of a failure message: colors removed, numbers kept.
function firstLine(msg) {
  return String(msg ?? '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? '';
}

// results: parsed runner JSON reports, each with its package slug.
// messages: also record failure messages (.m).
function fromResults(results, root, { messages = false } = {}) {
  const map = { tests: {}, files: {} };
  for (const { slug, report } of results) {
    for (const t of report.testResults ?? []) {
      const fileKey = `${slug}::${relativeFile(t.name, root)}`;
      const failed = t.status === 'failed' || (t.assertionResults ?? []).some((a) => a.status === 'failed');
      map.files[fileKey] = { s: failed ? 'failed' : t.status, file: t.name };
      if (messages && failed && t.message) map.files[fileKey].m = firstLine(t.message);
      const seen = new Map();
      for (const a of t.assertionResults ?? []) {
        const n = (seen.get(a.fullName) ?? 0) + 1;
        seen.set(a.fullName, n);
        const entry = { s: a.status, file: t.name };
        if (messages && a.status === 'failed') entry.m = firstLine(a.failureMessages?.[0]);
        map.tests[`${fileKey}::${a.fullName}${n > 1 ? ` #${n}` : ''}`] = entry;
      }
    }
  }
  return map;
}

function loadDir(dir, env, root, options) {
  const results = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(`.${env}.json`)).sort()) {
      let report;
      try { report = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      results.push({ slug: f.slice(0, -`.${env}.json`.length), report });
    }
  }
  return fromResults(results, root, options);
}

const empty = () => ({ tests: {}, files: {} });
function read(file) {
  if (!file || !fs.existsSync(file)) return empty();
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { tests: m.tests ?? {}, files: m.files ?? {} };
}

// Keys whose status differs between two key -> { s } maps.
const differingKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k]?.s !== b[k]?.s);
const differing = (a, b, exclude) => differingKeys(a, b).filter((k) => !exclude?.has(k)).length;

// The flaky tests and files: those whose status differs between two runs
// of the same configuration ({ tests: Set, files: Set }).
const flaky = (a, b) => ({ tests: new Set(differingKeys(a.tests, b.tests)), files: new Set(differingKeys(a.files, b.files)) });

// false_pass: passed in run, not passed (failed, skipped, missing) in ref;
// false_fail: passed in ref, not passed in run.
function direction(run, ref) {
  let falsePass = 0, falseFail = 0;
  for (const k of new Set([...Object.keys(run.tests), ...Object.keys(ref.tests)])) {
    const r = run.tests[k]?.s === 'passed', i = ref.tests[k]?.s === 'passed';
    if (r && !i) falsePass++;
    if (i && !r) falseFail++;
  }
  return { falsePass, falseFail };
}

// exclude: { tests: Set, files: Set } left out of differs/filesDiffer (flaky).
function compare(base, run, ref, exclude) {
  const out = { differs: differing(base.tests, run.tests, exclude?.tests), filesDiffer: differing(base.files, run.files, exclude?.files) };
  if (ref) Object.assign(out, direction(run, ref));
  return out;
}

const failing = (map) => [...new Set(Object.values(map.files).filter((v) => v.s === 'failed').map((v) => v.file))];

function leaky(shared, isolated) {
  const isoFailed = new Set(failing(isolated));
  const ran = new Set(Object.values(isolated.files).map((v) => v.file));
  return failing(shared).filter((f) => ran.has(f) && !isoFailed.has(f));
}

// Files to run isolated (warpdom's learning since its state version 2):
// a test (or the file) whose status in shared differs from isolated, a
// test or file missing from shared (a hang, a crash, a timeout), or a file
// failing in shared.
function isolate(shared, isolated) {
  const out = new Set(failing(shared));
  for (const [k, v] of Object.entries(isolated.tests)) if (shared.tests[k]?.s !== v.s) out.add(v.file);
  for (const [k, v] of Object.entries(shared.tests)) if (!isolated.tests[k]) out.add(v.file);
  for (const [k, v] of Object.entries(isolated.files)) if (shared.files[k]?.s !== v.s) out.add(v.file);
  return [...out];
}

function merge(first, ...reruns) {
  const replaced = new Set(reruns.flatMap((r) => Object.values(r.files).map((v) => v.file)));
  const keep = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !replaced.has(v.file)));
  const out = { tests: keep(first.tests), files: keep(first.files) };
  for (const r of reruns) { Object.assign(out.tests, r.tests); Object.assign(out.files, r.files); }
  return out;
}

module.exports = { relativeFile, firstLine, fromResults, loadDir, read, differingKeys, flaky, compare, direction, failing, leaky, isolate, merge };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const write = (file, m) => { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, JSON.stringify(m)); };
  if (cmd === 'map') {
    const root = opt('--root');
    const mi = args.indexOf('--messages');
    const messages = mi >= 0 && Boolean(args.splice(mi, 1));
    const [dir, env, out] = args;
    write(out, loadDir(dir, env, root, { messages }));
  } else if (cmd === 'compare') {
    const ei = args.indexOf('--exclude');
    const exclude = ei >= 0 ? (([x, y]) => flaky(read(x), read(y)))(args.splice(ei, 3).slice(1)) : null;
    const [b, r, ref] = args;
    const c = compare(read(b), read(r), ref ? read(ref) : null, exclude);
    console.log([c.differs, c.filesDiffer, ...(ref ? [c.falsePass, c.falseFail] : [])].join(' '));
  } else if (cmd === 'failing') {
    console.log(failing(read(args[0])).join(' '));
  } else if (cmd === 'leaky') {
    console.log(leaky(read(args[0]), read(args[1])).join(' '));
  } else if (cmd === 'isolate') {
    console.log(isolate(read(args[0]), read(args[1])).join(' '));
  } else if (cmd === 'merge') {
    const [out, first, ...reruns] = args;
    write(out, merge(read(first), ...reruns.map(read)));
  } else if (cmd === 'count') {
    const m = read(args[0]);
    console.log(`${Object.keys(m.tests).length} ${Object.keys(m.files).length}`);
  } else {
    process.stderr.write('usage: statuses.cjs map|compare|failing|leaky|isolate|merge|count ... (see the header)\n');
    process.exit(2);
  }
}
