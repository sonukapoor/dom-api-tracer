#!/usr/bin/env node
// Writes the pins file of a corpus: the commit of each project's local
// checkout, so runs elsewhere (CI) use exactly the code measured here.
// corpus/corpus.json is pinned in corpus/pins.json, any other corpus file
// <name>.json in <name>-pins.json (corpus/held-out.json: corpus/held-out-pins.json).
//
//   node scripts/research/write-pins.mjs [--repos-dir ~/Projects] [--corpus corpus/held-out.json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const opt = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1].replace(/^~/, homedir()) : fallback; };
const reposDir = resolve(opt('--repos-dir', join(homedir(), 'Projects')));
const corpusFile = resolve(opt('--corpus', join(root, 'corpus/corpus.json')));
const pinsFile = corpusFile.endsWith('/corpus.json') ? join(dirname(corpusFile), 'pins.json') : corpusFile.replace(/\.json$/, '-pins.json');
const { projects } = JSON.parse(readFileSync(corpusFile, 'utf8'));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const pins = {};
for (const p of projects) {
  // As the harness finds it: a project's own path (relative to the corpus file), else <repos-dir>/<name>.
  const dir = p.path ? resolve(dirname(corpusFile), p.path.replace(/^~/, homedir())) : join(reposDir, p.name);
  if (!existsSync(join(dir, '.git'))) continue;
  pins[p.name] = { repo: p.repo, commit: git(dir, 'rev-parse', 'HEAD'), date: git(dir, 'log', '-1', '--format=%cI') };
}
writeFileSync(pinsFile, `${JSON.stringify(pins, null, 2)}\n`);
console.log(`${Object.keys(pins).length} projects pinned in ${relative(process.cwd(), pinsFile)}`);
