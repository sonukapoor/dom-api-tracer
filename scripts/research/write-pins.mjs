#!/usr/bin/env node
// Writes corpus/pins.json: the commit of each corpus project's local
// checkout, so runs elsewhere (CI) use exactly the code measured here.
//
//   node scripts/research/write-pins.mjs [--repos-dir ~/Projects]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const i = process.argv.indexOf('--repos-dir');
const reposDir = resolve(i > 0 ? process.argv[i + 1].replace(/^~/, homedir()) : join(homedir(), 'Projects'));
const { projects } = JSON.parse(readFileSync(join(root, 'corpus/corpus.json'), 'utf8'));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const pins = {};
for (const p of projects) {
  // As the harness finds it: a project's own path (relative to corpus/), else <repos-dir>/<name>.
  const dir = p.path ? resolve(root, 'corpus', p.path.replace(/^~/, homedir())) : join(reposDir, p.name);
  if (!existsSync(join(dir, '.git'))) continue;
  pins[p.name] = { repo: p.repo, commit: git(dir, 'rev-parse', 'HEAD'), date: git(dir, 'log', '-1', '--format=%cI') };
}
writeFileSync(join(root, 'corpus/pins.json'), `${JSON.stringify(pins, null, 2)}\n`);
console.log(`${Object.keys(pins).length} projects pinned in corpus/pins.json`);
