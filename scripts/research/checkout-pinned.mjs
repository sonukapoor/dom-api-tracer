#!/usr/bin/env node
// Clones corpus projects at their pinned commits (corpus/pins.json; for
// another corpus file <name>.json, <name>-pins.json), into
// the directories the harness looks in (a project's own path, else
// <repos-dir>/<name>), so it uses them instead of cloning a branch head.
// Projects already checked out there are left as they are.
//
// --unpinned clones the head of each project's default branch instead
// (the repository from the pins file), to measure today's code;
// record-env.mjs records the commit and whether it is the pin.
//
//   node scripts/research/checkout-pinned.mjs --repos-dir <dir> [--corpus corpus/held-out.json] [--unpinned] <project...>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const i = args.indexOf('--repos-dir');
const reposDir = resolve(i >= 0 ? args.splice(i, 2)[1].replace(/^~/, homedir()) : join(homedir(), 'Projects'));
const c = args.indexOf('--corpus');
const corpusFile = resolve(c >= 0 ? args.splice(c, 2)[1].replace(/^~/, homedir()) : join(root, 'corpus/corpus.json'));
const u = args.indexOf('--unpinned');
const unpinned = u >= 0 && Boolean(args.splice(u, 1));
const pinsFile = corpusFile.endsWith('/corpus.json') ? join(dirname(corpusFile), 'pins.json') : corpusFile.replace(/\.json$/, '-pins.json');
const { projects } = JSON.parse(readFileSync(corpusFile, 'utf8'));
const pins = JSON.parse(readFileSync(pinsFile, 'utf8'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
for (const name of args) {
  const project = projects.find((p) => p.name === name);
  const pin = pins[name];
  if (!project || !pin) throw new Error(`${name}: not in ${corpusFile} or ${pinsFile}`);
  const dir = project.path ? resolve(dirname(corpusFile), project.path.replace(/^~/, homedir())) : join(reposDir, name);
  if (existsSync(dir)) { console.log(`${name}: ${dir} exists, left as is`); continue; }
  mkdirSync(dir, { recursive: true });
  // A shallow fetch of exactly the pinned commit (or the remote's HEAD:
  // its default branch).
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', pin.repo);
  git(dir, 'fetch', '-q', '--depth', '1', 'origin', unpinned ? 'HEAD' : pin.commit);
  git(dir, 'checkout', '-q', 'FETCH_HEAD');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  console.log(`${name}: ${commit.slice(0, 10)} in ${dir}${unpinned ? ` (default branch head; pin ${pin.commit.slice(0, 10)})` : ''}`);
}
