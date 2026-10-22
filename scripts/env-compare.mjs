#!/usr/bin/env node
// Compare the same suites on jsdom and happy-dom, from environment-mode runs:
//   .corpus-env/<env>-time     timing runs (no profiler)
//   .corpus-env/<env>-profile  profiled runs (CPU profiles per test process)
// Reports per project: wall time on each DOM, tests that pass on one DOM but
// not the other, and the share of CPU time spent in the DOM implementation.
//
//   node scripts/env-compare.mjs [.corpus-env] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const base = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(root, '.corpus-env'));
const ENVS = ['jsdom', 'happy-dom'];
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

// Test identities per project: "file > full name" -> status.
function testStatuses(envDir, project) {
  const dir = path.join(envDir, 'tmp', project);
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.meta.json'))) {
    const r = readJson(path.join(dir, f));
    for (const t of r?.testResults ?? []) {
      const file = path.relative(base, t.name).replace(/^(\.\.\/)+/, '');
      if (!t.assertionResults?.length && t.status === 'failed') out.set(`${file} > (file failed to run)`, 'failed');
      for (const a of t.assertionResults ?? []) out.set(`${file} > ${a.fullName}`, a.status);
    }
  }
  return out;
}

function profileShares(envDir) {
  const dir = path.join(envDir, 'profiles');
  if (!fs.existsSync(dir)) return {};
  return JSON.parse(
    String(
      execFileSync(process.execPath, [path.join(root, 'scripts/profile-share.mjs'), dir, '--json'], {
        maxBuffer: 64 * 1024 * 1024,
      }),
    ),
  );
}

const timing = Object.fromEntries(
  ENVS.map((e) => [e, readJson(path.join(base, `${e}-time`, 'status.json'))?.projects ?? {}]),
);
const shares = Object.fromEntries(ENVS.map((e) => [e, profileShares(path.join(base, `${e}-profile`))]));
const projects = [...new Set(ENVS.flatMap((e) => Object.keys(timing[e])))].sort();

const rows = projects.map((name) => {
  const row = { project: name };
  for (const env of ENVS) {
    const pk = (timing[env][name]?.packages ?? []).filter((p) => p.status === 'ran');
    row[env] = {
      packages: pk.length,
      seconds: +(pk.reduce((a, p) => a + p.run.ms, 0) / 1000).toFixed(1),
      tests: pk.reduce((a, p) => a + p.run.tests, 0),
      passed: pk.reduce((a, p) => a + p.run.passed, 0),
      failed: pk.reduce((a, p) => a + p.run.failed, 0),
      providedFrom: pk.some((p) => p.providedFrom) ? 'dom-api-tracer' : null,
      notRun: (timing[env][name]?.packages ?? [])
        .filter((p) => p.status !== 'ran')
        .map((p) => `${p.dir}: ${p.error || p.reason}`),
      profile: shares[env][name]
        ? { cpuSeconds: shares[env][name].cpuSeconds, categories: shares[env][name].categories }
        : null,
    };
  }
  // Correctness gap: tests passing on one DOM but not on the other.
  const a = testStatuses(path.join(base, 'jsdom-time'), name);
  const b = testStatuses(path.join(base, 'happy-dom-time'), name);
  const onlyJsdom = [...a].filter(([k, s]) => s === 'passed' && b.has(k) && b.get(k) !== 'passed').map(([k]) => k);
  const onlyHappy = [...b].filter(([k, s]) => s === 'passed' && a.has(k) && a.get(k) !== 'passed').map(([k]) => k);
  row.passOnlyOnJsdom = onlyJsdom.length;
  row.passOnlyOnHappyDom = onlyHappy.length;
  row.examplesOnlyJsdom = onlyJsdom.slice(0, 5);
  const j = row.jsdom.seconds,
    h = row['happy-dom'].seconds;
  row.speedup = j && h ? +(j / h).toFixed(2) : null;
  return row;
});

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(rows, null, 2));
} else {
  const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(0)}%`);
  console.log(
    '| Project | jsdom s | happy-dom s | jsdom / happy-dom | Pass only on jsdom | Pass only on happy-dom | DOM share of CPU (jsdom) | (happy-dom) |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    console.log(
      `| ${r.project} | ${r.jsdom.seconds} | ${r['happy-dom'].seconds} | ${r.speedup ?? '-'}x | ${r.passOnlyOnJsdom} of ${r.jsdom.tests} | ${r.passOnlyOnHappyDom} | ${pct(r.jsdom.profile?.categories.dom)} | ${pct(r['happy-dom'].profile?.categories.dom)} |`,
    );
  }
  for (const r of rows)
    for (const env of ENVS) for (const n of r[env].notRun) console.log(`- ${r.project} on ${env} not run: ${n}`);
}
