#!/usr/bin/env node
// Clones corpus projects at their pinned commits (corpus/pins.json), into
// the directories the harness looks in (a project's own path, else
// <repos-dir>/<name>), so it uses them instead of cloning a branch head.
// Projects already checked out there are left as they are.
//
//   node scripts/research/checkout-pinned.mjs --repos-dir <dir> <project...>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const i = args.indexOf('--repos-dir');
const reposDir = resolve(i >= 0 ? args.splice(i, 2)[1].replace(/^~/, homedir()) : join(homedir(), 'Projects'));
const { projects } = JSON.parse(readFileSync(join(root, 'corpus/corpus.json'), 'utf8'));
const pins = JSON.parse(readFileSync(join(root, 'corpus/pins.json'), 'utf8'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
for (const name of args) {
  const project = projects.find((p) => p.name === name);
  const pin = pins[name];
  if (!project || !pin) throw new Error(`${name}: not in corpus/corpus.json or corpus/pins.json`);
  const dir = project.path ? resolve(root, 'corpus', project.path.replace(/^~/, homedir())) : join(reposDir, name);
  if (existsSync(dir)) { console.log(`${name}: ${dir} exists, left as is`); continue; }
  mkdirSync(dir, { recursive: true });
  // A shallow fetch of exactly the pinned commit.
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', pin.repo);
  git(dir, 'fetch', '-q', '--depth', '1', 'origin', pin.commit);
  git(dir, 'checkout', '-q', 'FETCH_HEAD');
  console.log(`${name}: ${pin.commit.slice(0, 10)} in ${dir}`);
}
