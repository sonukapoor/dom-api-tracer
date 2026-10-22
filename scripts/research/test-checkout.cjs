#!/usr/bin/env node
// Check of checkout-pinned.mjs and record-env.mjs (run by npm test), on a
// local repository with two commits pinned at the first: the pinned
// checkout is at the pin, --unpinned at the default branch head, and the
// environment record names each commit, its pin and whether it is at it.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-'));
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], {
    cwd,
    encoding: 'utf8',
  }).trim();
const node = (...a) => execFileSync(process.execPath, a, { encoding: 'utf8' });

try {
  const origin = path.join(dir, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  fs.writeFileSync(path.join(origin, 'a.txt'), '1');
  git(origin, 'add', '.');
  git(origin, 'commit', '-qm', 'one');
  const pinned = git(origin, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(origin, 'a.txt'), '2');
  git(origin, 'commit', '-qam', 'two');
  const head = git(origin, 'rev-parse', 'HEAD');

  const corpus = path.join(dir, 'set.json');
  fs.writeFileSync(corpus, JSON.stringify({ projects: [{ name: 'p', packages: [] }] }));
  fs.writeFileSync(
    path.join(dir, 'set-pins.json'),
    JSON.stringify({ p: { repo: `file://${origin}`, commit: pinned } }),
  );

  const env = (repos) =>
    JSON.parse(node(path.join(here, 'record-env.mjs'), '--corpus', corpus, '--repos-dir', repos, '--warpdom', dir))
      .projects.p;

  const a = path.join(dir, 'pinned');
  node(path.join(here, 'checkout-pinned.mjs'), '--repos-dir', a, '--corpus', corpus, 'p');
  assert.equal(git(path.join(a, 'p'), 'rev-parse', 'HEAD'), pinned, 'pinned checkout');
  assert.deepEqual([env(a).commit, env(a).pin, env(a).atPin], [pinned, pinned, true], 'record at the pin');

  const b = path.join(dir, 'unpinned');
  const out = node(path.join(here, 'checkout-pinned.mjs'), '--unpinned', '--repos-dir', b, '--corpus', corpus, 'p');
  assert.equal(git(path.join(b, 'p'), 'rev-parse', 'HEAD'), head, 'unpinned checkout: default branch head');
  assert.match(out, /default branch head; pin /);
  assert.deepEqual([env(b).commit, env(b).pin, env(b).atPin], [head, pinned, false], 'record off the pin');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
