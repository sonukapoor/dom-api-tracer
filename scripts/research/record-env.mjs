#!/usr/bin/env node
// Records the environment of a corpus run as JSON, so timings and surveys
// can be compared and reproduced: the git commit (and whether the checkout
// has uncommitted changes) of every corpus project found locally, of
// warpdom and of this repository; Node version; OS; CPU model and core
// count; total memory; load average when the run started.
//
//   node scripts/research/record-env.mjs --out <file.json>
//     [--repos-dir ~/Projects] [--warpdom <dir>] [--corpus corpus/corpus.json]
//
// Run it with the Node version the corpus runs use (the survey and timing
// scripts call it through `nvm exec`), since it records process.version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());
const opts = { out: null, reposDir: path.join(os.homedir(), 'Projects'), warpdom: path.join(root, '..', 'warpdom'), corpus: path.join(root, 'corpus', 'corpus.json') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') opts.out = argv[++i];
  else if (argv[i] === '--repos-dir') opts.reposDir = argv[++i];
  else if (argv[i] === '--warpdom') opts.warpdom = argv[++i];
  else if (argv[i] === '--corpus') opts.corpus = argv[++i];
  else { process.stderr.write(`unknown argument ${argv[i]}\n`); process.exit(2); }
}

function git(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  try {
    return {
      commit: run('rev-parse', 'HEAD'),
      branch: run('rev-parse', '--abbrev-ref', 'HEAD'),
      dirty: run('status', '--porcelain', '--untracked-files=no') !== '',
    };
  } catch (e) {
    return { error: String(e.message).split('\n')[0] };
  }
}

const corpus = JSON.parse(fs.readFileSync(opts.corpus, 'utf8'));
const corpusDir = path.dirname(path.resolve(opts.corpus));
const projects = {};
for (const project of corpus.projects) {
  // Same checkout location as scripts/trace-corpus.mjs.
  const dir = project.path ? path.resolve(corpusDir, expandHome(project.path)) : path.join(path.resolve(expandHome(opts.reposDir)), project.name);
  projects[project.name] = fs.existsSync(dir) ? { dir, ...git(dir) } : { dir, missing: true };
}

const cpus = os.cpus();
const env = {
  recordedAt: new Date().toISOString(),
  node: process.version,
  os: { platform: os.platform(), release: os.release(), version: os.version?.(), arch: os.arch() },
  cpu: { model: cpus[0]?.model ?? null, cores: cpus.length, availableParallelism: os.availableParallelism?.() ?? null },
  memory: { totalBytes: os.totalmem(), totalGiB: +(os.totalmem() / 2 ** 30).toFixed(1) },
  loadAverage: os.loadavg(),
  warpdom: { dir: path.resolve(expandHome(opts.warpdom)), ...git(path.resolve(expandHome(opts.warpdom))) },
  domApiTracer: { dir: root, ...git(root) },
  projects,
};

const json = JSON.stringify(env, null, 2) + '\n';
if (opts.out) {
  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, json);
} else process.stdout.write(json);
