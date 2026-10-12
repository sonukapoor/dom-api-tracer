#!/usr/bin/env node
// Helpers of versions.sh (the jsdom version experiment, warpdom
// docs/research/revision-plan.md item 9): where a corpus project is, its
// package manager and install commands, forcing a dependency version
// through the package manager's overrides, and which jsdom (and cssstyle)
// each package's runner resolves. test-versions.cjs checks it (npm test).
//
//   versions.cjs dir <corpus.json> <repos dir> <project>      the checkout
//   versions.cjs install <corpus.json> <project dir> <project> [--frozen]
//       the install command: --frozen the project's own (the harness's),
//       else the same without the frozen lockfile, so overrides apply
//   versions.cjs apply <project dir> <name> <version>
//       forces <name>@<version> for the whole dependency tree: npm/bun
//       overrides, pnpm.overrides (and pnpm-workspace.yaml overrides when
//       there is a workspace file), yarn resolutions; a direct dependency
//       of the root on <name> is set to <version> too (npm rejects an
//       override that conflicts with one). Prints the files changed.
//   versions.cjs files <project dir>   files apply and an install may change
//   versions.cjs resolved <corpus.json> <project dir> <project>
//       JSON { <package dir>: { jsdom, cssstyle } }: the jsdom the package's
//       runner loads (Vitest: resolved from vitest's own location, as
//       Vitest imports it; Jest: from jest-environment-jsdom), null when the
//       project has none (the harness then links one, DOM_TRACE_DOM_MODULES)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');

const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function project(corpusFile, name) {
  const p = readJson(corpusFile).projects.find((x) => x.name === name);
  if (!p) throw new Error(`${name} is not in ${corpusFile}`);
  return p;
}

// As trace-corpus.mjs finds a checkout: its own path (relative to the
// corpus file), else <repos dir>/<name>.
function projectDir(corpusFile, reposDir, name) {
  const p = project(corpusFile, name);
  return p.path ? path.resolve(path.dirname(corpusFile), expandHome(p.path)) : path.join(path.resolve(expandHome(reposDir)), name);
}

// trace-corpus.mjs installCommand's choice.
function packageManager(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('bun.lock') || has('bun.lockb')) return 'bun';
  if (has('yarn.lock')) return has('.yarnrc.yml') ? 'yarn-berry' : 'yarn';
  return 'npm';
}

const FROZEN = { pnpm: 'pnpm install --frozen-lockfile', bun: 'bun install --frozen-lockfile', 'yarn-berry': 'yarn install --immutable', yarn: 'yarn install --frozen-lockfile', npm: 'npm ci' };

// The project's install command made to update the lockfile.
function unfrozen(cmd, pm) {
  let c = cmd;
  if (pm === 'npm') {
    c = c.replace(/(^|\s)ci(?=\s|$)/, '$1install');
    if (!/--no-audit/.test(c)) c += ' --no-audit --no-fund';
  } else if (pm === 'pnpm') {
    c = c.replace(/\s--frozen-lockfile(?=\s|$)/, '');
    if (!/--no-frozen-lockfile/.test(c)) c += ' --no-frozen-lockfile';
    // Changed settings must not stop on a prompt to purge node_modules.
    c += ' --config.confirmModulesPurge=false';
  } else if (pm === 'yarn-berry') {
    c = `YARN_ENABLE_IMMUTABLE_INSTALLS=false ${c.replace(/\s--immutable(?=\s|$)/, '')}`;
  } else {
    c = c.replace(/\s--frozen-lockfile(?=\s|$)/, '');
  }
  return c;
}

function installCommand(corpusFile, dir, name, frozen) {
  const p = project(corpusFile, name);
  const pm = packageManager(dir);
  const own = p.install || FROZEN[pm];
  if (p.install === false) return '';
  return frozen ? own : unfrozen(own, pm);
}

// Keys of an override map that target <name> (plain, versioned, or nested
// "parent>name"), so the forced version is the only one.
const targets = (key, name) => new RegExp(`(^|>)${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(@[^>]*)?$`).test(key);
function setOverride(map, name, version) {
  const out = {};
  for (const [k, v] of Object.entries(map ?? {})) if (!targets(k, name)) out[k] = v;
  out[name] = version;
  return out;
}

// pnpm-workspace.yaml: <name>: <version> in its top-level overrides block
// (created at the end when missing), other entries for <name> removed.
function setYamlOverride(text, name, version) {
  const lines = text.replace(/\n*$/, '').split('\n');
  const entry = (indent) => `${indent}${/^[\w.-]+$/.test(name) ? name : JSON.stringify(name)}: ${JSON.stringify(version)}`;
  let i = lines.findIndex((l) => /^overrides:\s*(\{\s*\})?\s*(#.*)?$/.test(l));
  if (i < 0) return `${lines.join('\n')}\n\noverrides:\n${entry('  ')}\n`;
  lines[i] = 'overrides:';
  let end = i + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;
  const block = lines.slice(i + 1, end);
  const indent = block.find((l) => l.trim() && !l.trim().startsWith('#'))?.match(/^\s+/)[0] ?? '  ';
  const keep = block.filter((l) => {
    const m = l.match(/^\s+(['"]?)(.+?)\1\s*:/);
    return !(m && l.match(/^\s+/)[0] === indent && targets(m[2], name));
  });
  lines.splice(i + 1, block.length, entry(indent), ...keep);
  return `${lines.join('\n')}\n`;
}

function apply(dir, name, version) {
  const pm = packageManager(dir);
  const changed = [];
  const pjFile = path.join(dir, 'package.json');
  const raw = fs.readFileSync(pjFile, 'utf8');
  const pj = JSON.parse(raw);
  if (pm === 'pnpm') pj.pnpm = { ...pj.pnpm, overrides: setOverride(pj.pnpm?.overrides, name, version) };
  else if (pm === 'yarn' || pm === 'yarn-berry') pj.resolutions = setOverride(pj.resolutions, name, version);
  else pj.overrides = setOverride(pj.overrides, name, version);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (pj[field]?.[name]) pj[field][name] = version;
  }
  const indent = raw.match(/^\{\n([ \t]+)/)?.[1] ?? '  ';
  fs.writeFileSync(pjFile, `${JSON.stringify(pj, null, indent)}\n`);
  changed.push(pjFile);
  const ws = path.join(dir, 'pnpm-workspace.yaml');
  if (pm === 'pnpm' && fs.existsSync(ws)) {
    fs.writeFileSync(ws, setYamlOverride(fs.readFileSync(ws, 'utf8'), name, version));
    changed.push(ws);
  }
  return changed;
}

// Files to back up before apply + install, restored afterwards.
const FILES = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const files = (dir) => FILES.filter((f) => fs.existsSync(path.join(dir, f)));

function versionFrom(fromFile, name) {
  try { return readJson(createRequire(fromFile).resolve(`${name}/package.json`)).version; } catch { return null; }
}

function resolved(corpusFile, dir, name) {
  const out = {};
  for (const pkg of project(corpusFile, name).packages) {
    const pkgDir = path.resolve(dir, pkg.dir);
    const req = createRequire(path.join(pkgDir, 'package.json'));
    let from = path.join(pkgDir, 'package.json');
    try {
      const runnerPkg = pkg.runner === 'jest' ? 'jest-environment-jsdom' : 'vitest';
      from = fs.realpathSync(req.resolve(`${runnerPkg}/package.json`));
    } catch {}
    let jsdom = versionFrom(from, 'jsdom');
    let jsdomFile = null;
    if (!jsdom) { jsdom = versionFrom(path.join(pkgDir, 'package.json'), 'jsdom'); }
    try { jsdomFile = fs.realpathSync(createRequire(from).resolve('jsdom/package.json')); } catch {
      try { jsdomFile = fs.realpathSync(req.resolve('jsdom/package.json')); } catch {}
    }
    out[pkg.dir] = { jsdom, cssstyle: jsdomFile ? versionFrom(jsdomFile, 'cssstyle') : null };
  }
  return out;
}

module.exports = { projectDir, packageManager, unfrozen, installCommand, setOverride, setYamlOverride, apply, files, resolved };

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'dir') console.log(projectDir(path.resolve(a[0]), a[1], a[2]));
  else if (cmd === 'install') console.log(installCommand(path.resolve(a[0]), a[1], a[2], a.includes('--frozen')));
  else if (cmd === 'apply') console.log(apply(a[0], a[1], a[2]).join('\n'));
  else if (cmd === 'files') console.log(files(a[0]).join('\n'));
  else if (cmd === 'resolved') console.log(JSON.stringify(resolved(path.resolve(a[0]), a[1], a[2])));
  else { process.stderr.write('usage: versions.cjs dir|install|apply|files|resolved ... (see the header)\n'); process.exit(2); }
}
