#!/usr/bin/env node
// How much of a Vitest run is per-file setup? For each Vitest package in the
// corpus, run the suite as configured (no tracer, no environment switch),
// once with isolation (the default) and once with --no-isolate, and read
// Vitest's own duration breakdown: environment, transform, setup, import
// (collect), tests, prepare. --no-isolate reuses one environment and module
// graph per worker, so it bounds what avoiding per-file setup can save, and
// its pass counts show what sharing state breaks.
//
//   node scripts/setup-cost.mjs [corpus.json] --repos-dir ~/Projects [--only a,b]
//     [--out .corpus-env/setup-cost] [--max-workers 2]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
// Importable (tests use parseDuration) without starting a run.
const isMain = import.meta.url.split('?')[0] === pathToFileURL(process.argv[1] ?? '').href;
const args = { corpus: path.join(root, 'corpus/corpus.json'), out: '.corpus-env/setup-cost', maxWorkers: 2 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--repos-dir') args.reposDir = argv[++i];
  else if (a === '--only') args.only = argv[++i].split(',');
  else if (a === '--out') args.out = argv[++i];
  else if (a === '--max-workers') args.maxWorkers = Number(argv[++i]);
  else args.corpus = a;
}
const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

const PHASES = ['environment', 'transform', 'setup', 'import', 'collect', 'tests', 'prepare', 'worker'];
const MS_PER_UNIT = { __proto__: null, s: 1000, m: 60000 };
const toMs = (v, unit) => Number(v) * (MS_PER_UNIT[unit] ?? 1);

// "Duration 4.08s (transform 1.26s, setup 3.09s, collect 8.04s, tests 7.96s, environment 8.50s, prepare 1.91s)"
// or, in newer Vitest, "Duration 640ms (environment 95%, transform 2%, tests 1%, ...)".
// Phases are summed over all files and workers; returned as shares of their total.
export function parseDuration(text) {
  const line = text.split('\n').find((l) => /^\s*Duration\s/.test(l));
  if (!line) return null;
  const [, wall, wallUnit] = line.match(/Duration\s+([\d.]+)(ms|s|m)/) || [];
  const phases = {};
  for (const [, name, value, unit] of line.matchAll(/(\w+) ([\d.]+)(ms|s|m|%)/g)) {
    if (!PHASES.includes(name)) continue;
    phases[name === 'collect' ? 'import' : name] = { value: Number(value), unit };
  }
  const percent = Object.values(phases).some((p) => p.unit === '%');
  const total = Object.values(phases).reduce((a, p) => a + (percent ? p.value : toMs(p.value, p.unit)), 0);
  const shares = Object.fromEntries(
    Object.entries(phases).map(([k, p]) => [k, total ? (percent ? p.value : toMs(p.value, p.unit)) / total : 0]),
  );
  return { wallMs: wall ? toMs(wall, wallUnit) : null, shares };
}

function findBin(fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, 'node_modules', '.bin', 'vitest');
    if (fs.existsSync(bin)) return bin;
    if (dir === path.dirname(dir)) return null;
  }
}

function runOnce(pkgDir, bin, pkg, isolate, resultsFile) {
  const started = Date.now();
  const res = spawnSync(
    bin,
    [
      'run',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${resultsFile}`,
      `--maxWorkers=${args.maxWorkers}`,
      ...(isolate ? [] : ['--no-isolate']),
      ...(pkg.args ?? []),
    ],
    {
      cwd: pkgDir,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30 * 60_000,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', ...pkg.env },
    },
  );
  const output = `${res.stdout || ''}${res.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  let r = null;
  try {
    r = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  } catch {}
  return {
    ms: Date.now() - started,
    breakdown: parseDuration(output),
    tests: r?.numTotalTests ?? null,
    passed: r?.numPassedTests ?? null,
    failed: r?.numFailedTests ?? null,
    exitCode: res.status,
  };
}

function main() {
  const corpusFile = path.resolve(args.corpus);
  const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8')).projects;
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  const results = {};
  for (const project of corpus.filter((p) => !args.only || args.only.includes(p.name))) {
    const projectDir = project.path
      ? path.resolve(path.dirname(corpusFile), expandHome(project.path))
      : path.join(path.resolve(expandHome(args.reposDir || '.')), project.name);
    for (const pkg of project.packages.filter((p) => p.runner === 'vitest')) {
      const pkgDir = path.resolve(projectDir, pkg.dir);
      const bin = findBin(pkgDir);
      const key = `${project.name}/${pkg.dir}`;
      if (!bin) {
        results[key] = { error: 'vitest not installed' };
        continue;
      }
      const slug = `${project.name}-${pkg.dir}`.replace(/[^\w.-]+/g, '_');
      const isolated = runOnce(pkgDir, bin, pkg, true, path.join(out, `${slug}.isolated.json`));
      const shared = runOnce(pkgDir, bin, pkg, false, path.join(out, `${slug}.shared.json`));
      results[key] = { isolated, shared };
      const share = (b, k) => `${((b?.shares?.[k] || 0) * 100).toFixed(0)}%`;
      console.log(
        `${key}: isolated ${(isolated.ms / 1000).toFixed(1)}s ${isolated.passed}/${isolated.tests}` +
          ` [env ${share(isolated.breakdown, 'environment')}, import ${share(isolated.breakdown, 'import')}, tests ${share(isolated.breakdown, 'tests')}]` +
          ` | no-isolate ${(shared.ms / 1000).toFixed(1)}s ${shared.passed}/${shared.tests}`,
      );
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    }
  }
}

if (isMain) main();
