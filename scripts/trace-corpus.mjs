#!/usr/bin/env node
// Trace a corpus of real projects: for every package listed in a corpus file,
// run its own test suite once untraced (baseline) and once with the tracer
// injected through a temporary wrapper config, then aggregate all traces.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const TRACER = {
  vitest: path.join(root, 'src/vitest-setup.mjs'),
  jest: path.join(root, 'src/jest-setup.cjs'),
};
const META_MARKER = '[dom-trace-corpus] browser mode';

const HELP = `trace-corpus — run the tracer over many real projects

Usage:
  node scripts/trace-corpus.mjs [corpus.json] [options]

Options:
  --repos-dir <dir>  Where checkouts live; missing ones are cloned (default: <out>/repos)
  --out <dir>        Traces, logs, status.json and report (default: ./.corpus)
  --only <a,b>       Only these projects
  --install          Run the install command even if node_modules exists
  --no-build         Skip build commands (when the build output is already there)
  --no-baseline      Skip the untraced comparison run
  --timeout <min>    Per test run timeout in minutes (default: 30)
  --max-workers <n>  Test runner workers per run (default: 2). Higher is faster
                     but can saturate the machine on large suites.
  -h, --help         Show this help

Corpus file:
  { "projects": [ { "name": "floating-ui",
      "repo": "https://github.com/floating-ui/floating-ui", "ref": "master",
      "path": "optional, relative to the corpus file",
      "install": "optional install command (default: from lockfile), or false",
      "build": "optional command run after install, e.g. to build workspace packages",
      "notes": "optional free text: why packages are included, excluded or patched",
      "packages": [ { "dir": "packages/react", "runner": "vitest",
                      "config": "optional config file", "args": ["optional", "cli args"],
                      "env": { "OPTIONAL": "environment for both runs" } } ] } ] }
`;

function parseArgs(argv) {
  const args = { corpus: path.join(root, 'corpus/corpus.json'), out: '.corpus', baseline: true, build: true, timeout: 30, maxWorkers: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repos-dir') args.reposDir = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',');
    else if (a === '--install') args.install = true;
    else if (a === '--no-baseline') args.baseline = false;
    else if (a === '--no-build') args.build = false;
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a === '--max-workers') args.maxWorkers = Number(argv[++i]);
    else if (a === '-h' || a === '--help') args.help = true;
    else args.corpus = a;
  }
  return args;
}

const expandHome = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

function log(msg) { process.stdout.write(msg + '\n'); }

function run(cmd, args, { cwd, env, timeoutMin, logFile, shell = false }) {
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd, shell, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, CI: '1', ...env },
    timeout: timeoutMin ? timeoutMin * 60_000 : undefined,
  });
  const output = `$ ${[cmd, ...args].join(' ')}\n${res.stdout || ''}${res.stderr || ''}${res.error ? `\n${res.error.message}` : ''}`;
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, output);
  }
  return { code: res.status, output, ms: Date.now() - started, timedOut: res.error?.code === 'ETIMEDOUT' };
}

// --- Checkout and install -------------------------------------------------

function checkout(project, corpusDir, reposDir) {
  const dir = project.path
    ? path.resolve(corpusDir, expandHome(project.path))
    : path.join(reposDir, project.name);
  if (fs.existsSync(dir)) return dir;
  if (!project.repo) throw new Error(`${dir} does not exist and no "repo" URL is given`);
  log(`  cloning ${project.repo}`);
  const args = ['clone', '--depth', '1', ...(project.ref ? ['--branch', project.ref] : []), project.repo, dir];
  const res = run('git', args, {});
  if (res.code !== 0) throw new Error(`git clone failed:\n${res.output}`);
  return dir;
}

function installCommand(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('pnpm-lock.yaml')) return 'pnpm install --frozen-lockfile';
  if (has('bun.lock') || has('bun.lockb')) return 'bun install --frozen-lockfile';
  if (has('yarn.lock')) return has('.yarnrc.yml') ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return 'npm ci';
  return 'npm install';
}

function install(project, dir, force, logFile) {
  if (project.install === false) return;
  // Without a package.json here, npm would walk up and install into a parent.
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`${dir} has no package.json; set "install": false to use dependencies from a parent directory`);
  }
  if (!force && fs.existsSync(path.join(dir, 'node_modules'))) return;
  const cmd = project.install || installCommand(dir);
  log(`  installing: ${cmd}`);
  const res = run(cmd, [], { cwd: dir, shell: true, logFile });
  if (res.code !== 0) throw new Error(`install failed (see ${logFile})`);
}

function build(project, dir, logFile) {
  log(`  building: ${project.build}`);
  const res = run(project.build, [], { cwd: dir, shell: true, logFile });
  if (res.code !== 0) throw new Error(`build failed (see ${logFile})`);
  return { exitCode: res.code, ms: res.ms };
}

// --- Runner configs -------------------------------------------------------

const CONFIG_EXTS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

function findConfig(pkgDir, runner, explicit) {
  if (explicit) return path.resolve(pkgDir, explicit);
  const names = runner === 'vitest'
    ? ['vitest.config', 'vitest.config.unit', 'vite.config']
    : ['jest.config'];
  for (const name of names) {
    for (const ext of [...CONFIG_EXTS, ...(runner === 'jest' ? ['json'] : [])]) {
      const f = path.join(pkgDir, `${name}.${ext}`);
      if (fs.existsSync(f)) return f;
    }
  }
  if (runner === 'jest') {
    const pkgJson = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJson) && JSON.parse(fs.readFileSync(pkgJson, 'utf8')).jest) return pkgJson;
  }
  return null;
}

// Written next to the original so relative paths inside it keep working. The
// body is plain JS that is also valid TS, since Vite bundles the config.
export function vitestWrapper(base) {
  return `// Generated by dom-api-tracer (scripts/trace-corpus.mjs). Safe to delete.
import fs from 'node:fs';
import base from './${path.basename(base)}';

const TRACER = ${JSON.stringify(TRACER.vitest)};
const addTracer = (test) => ({
  ...test,
  setupFiles: [TRACER, ...[].concat(test?.setupFiles ?? []).filter((f) => f !== TRACER)],
});
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
// The tracer lives outside the project; let Vite serve it.
const allowOutside = (server) => ({ ...server, fs: { ...server?.fs, strict: false } });

export default async (env) => {
  const cfg = (typeof base === 'function' ? await base(env) : await base) ?? {};
  const usesBrowser = (t) => Boolean(t?.browser?.enabled);
  const test = { ...(cfg.test ?? {}) };
  const projects = Array.isArray(test.projects) ? test.projects : null;
  const inline = (projects ?? []).filter(isObject);
  // Skip only when nothing would run in jsdom/happy-dom: the root runs in a
  // browser, or every project does. Mixed configs (vuetify) keep their DOM
  // projects; browser projects never get the tracer.
  const browser = usesBrowser(test) || (inline.length > 0 && inline.length === projects.length
    && inline.every((p) => usesBrowser(p.test) || (p.extends === true && usesBrowser(test))));
  if (browser) {
    if (process.env.DOM_TRACE_CORPUS_META) fs.writeFileSync(process.env.DOM_TRACE_CORPUS_META, JSON.stringify({ browser }));
    throw new Error(${JSON.stringify(META_MARKER)});
  }
  Object.assign(test, addTracer(test));
  // Inline projects only inherit the root setupFiles with \`extends: true\`;
  // adding the tracer to those too would register it twice.
  if (projects) {
    // They do not inherit the root server options either.
    test.projects = projects.map((p) => (isObject(p) && p.extends !== true && !usesBrowser(p.test)
      ? { ...p, server: allowOutside(p.server), test: addTracer(p.test ?? {}) } : p));
  }
  return { ...cfg, server: allowOutside(cfg.server), test };
};
`;
}

export function jestWrapper(base) {
  const ext = path.extname(base);
  const ts = ext === '.ts';
  const load = path.basename(base) === 'package.json'
    ? `require('./package.json').jest`
    : ext === '.mjs' ? `(await import('./${path.basename(base)}')).default`
      // TS: the wrapper is a module like the original, so Jest loads it the
      // same way (native type stripping, else its ts-node fallback, which turns
      // import() into require()). The computed specifier keeps ts-node's type
      // check from rejecting the '.ts' extension.
      : ts ? `await import(['./${path.basename(base, ext)}', '.ts'].join(''))`
        : `require('./${path.basename(base)}')`;
  const any = ts ? ': any' : '';
  return `// Generated by dom-api-tracer (scripts/trace-corpus.mjs). Safe to delete.
const TRACER = ${JSON.stringify(TRACER.jest)};
const addTracer = (c${any}) => ({
  ...c,
  setupFilesAfterEnv: [TRACER, ...(c.setupFilesAfterEnv ?? []).filter((f${any}) => f !== TRACER)],
});

${ts ? 'export default' : 'module.exports ='} async () => {
  let cfg${any} = ${load};
  // \`export default\` arrives as { default } (ts-node) or a namespace (require of ESM).
  if (cfg && typeof cfg === 'object' && 'default' in cfg) cfg = cfg.default;
  if (typeof cfg === 'function') cfg = await cfg();
  cfg = addTracer(cfg ?? {});
  // A project path pointing back at this directory makes Jest reload the
  // original config file, bypassing this wrapper: run the root config itself.
  if (Array.isArray(cfg.projects)) {
    cfg.projects = cfg.projects.filter((p${any}) => !(typeof p === 'string' && ['<rootDir>', '<rootDir>/', '.', './'].includes(p)));
    if (!cfg.projects.length) delete cfg.projects;
  }
  // Inline projects do not inherit the root setupFilesAfterEnv.
  if (Array.isArray(cfg.projects)) {
    cfg.projects = cfg.projects.map((p${any}) => (p && typeof p === 'object' ? addTracer(p) : p));
  }
  return cfg;
};
`;
}

// Wrapper configs live inside other people's checkouts. Their paths are
// recorded until removed, so a run that was killed can be cleaned up by the next.
let pendingFile = null;

function setPending(update) {
  if (!pendingFile) return;
  const list = fs.existsSync(pendingFile) ? JSON.parse(fs.readFileSync(pendingFile, 'utf8')) : [];
  const next = update(list);
  if (next.length) fs.writeFileSync(pendingFile, JSON.stringify(next, null, 2));
  else fs.rmSync(pendingFile, { force: true });
}

function removeWrappers(files) {
  for (const f of files) {
    // Only ever delete files this script generates.
    if (path.basename(f).includes('.dom-trace.')) fs.rmSync(f, { force: true });
  }
  setPending((list) => list.filter((f) => !files.includes(f)));
}

function removeLeftoverWrappers() {
  if (!pendingFile || !fs.existsSync(pendingFile)) return;
  const leftovers = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  if (leftovers.length) log(`Removing ${leftovers.length} wrapper config(s) left by an interrupted run`);
  removeWrappers(leftovers);
}

function writeWrapper(runner, base) {
  const ext = path.extname(base);
  const name = runner === 'vitest'
    ? `vitest.config.dom-trace.${/^\.[mc]?ts$/.test(ext) ? 'mts' : 'mjs'}`
    : `jest.config.dom-trace.${ext === '.ts' ? 'ts' : 'cjs'}`;
  const file = path.join(path.dirname(base), name);
  setPending((list) => [...list.filter((f) => f !== file), file]);
  fs.writeFileSync(file, runner === 'vitest' ? vitestWrapper(base) : jestWrapper(base));
  return file;
}

// Use the project's own runner binary: npx may pick up an unrelated version.
function findBin(fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const bin = path.join(dir, 'node_modules', '.bin', name);
    if (fs.existsSync(bin)) return bin;
    if (dir === path.dirname(dir)) return null;
  }
}

// Vitest before 4 rejects a maxWorkers below its default minWorkers, and later
// versions removed --minWorkers. Ask the binary whether it has the flag.
const minWorkersFlag = new Map();
function hasMinWorkers(bin) {
  if (!minWorkersFlag.has(bin)) {
    const help = spawnSync(bin, ['--help'], { encoding: 'utf8' });
    minWorkersFlag.set(bin, /--minWorkers/.test(`${help.stdout}${help.stderr}`));
  }
  return minWorkersFlag.get(bin);
}

function runnerArgs(runner, bin, config, resultsFile, maxWorkers, extra = []) {
  const workers = !maxWorkers ? []
    : runner === 'vitest' && hasMinWorkers(bin) ? ['--minWorkers=1', `--maxWorkers=${maxWorkers}`]
      : [`--maxWorkers=${maxWorkers}`];
  return runner === 'vitest'
    ? ['run', ...(config ? ['--config', config] : []), '--reporter=json', `--outputFile=${resultsFile}`, ...workers, ...extra]
    : [...(config ? ['--config', config] : []), '--ci', '--json', `--outputFile=${resultsFile}`, ...workers, ...extra];
}

function readResults(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    // numTotalTestSuites counts describe blocks under Vitest; testResults has one entry per file.
    const files = r.testResults ?? [];
    return {
      files: files.length, failedFiles: files.filter((f) => f.status === 'failed').length,
      tests: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests,
    };
  } catch { return null; }
}

function countTraces(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('run-')).length : 0;
}

// --- Per package ----------------------------------------------------------

// File-name stem for a package's logs and results ('.' would make hidden files).
export function slugFor(dir) {
  const slug = dir.replace(/^\.\/?/, '').replace(/[^\w.-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return slug || 'root';
}

function tracePackage({ pkg, projectDir, traceDir, logDir, tmpDir, opts, projectName }) {
  const pkgDir = path.resolve(projectDir, pkg.dir);
  const runner = pkg.runner;
  const result = { dir: pkg.dir, runner };
  if (!TRACER[runner]) return { ...result, status: 'failed', error: `unknown runner "${runner}"` };

  const config = findConfig(pkgDir, runner, pkg.config);
  if (!config) return { ...result, status: 'failed', error: `no ${runner} config found in ${pkgDir}` };
  result.config = path.relative(projectDir, config);
  const bin = findBin(pkgDir, runner);
  if (!bin) return { ...result, status: 'failed', error: `${runner} is not installed` };

  const slug = slugFor(pkg.dir);
  const metaFile = path.join(tmpDir, `${slug}.meta.json`);
  fs.rmSync(metaFile, { force: true });

  const before = countTraces(traceDir);
  const wrapper = writeWrapper(runner, config);
  let traced;
  try {
    const resultsFile = path.join(tmpDir, `${slug}.traced.json`);
    traced = run(bin, runnerArgs(runner, bin, wrapper, resultsFile, opts.maxWorkers, pkg.args), {
      cwd: pkgDir, timeoutMin: opts.timeout, logFile: path.join(logDir, `${slug}.traced.log`),
      env: { ...pkg.env, DOM_TRACE_DIR: traceDir, DOM_TRACE_PROJECT: projectName, DOM_TRACE_CORPUS_META: metaFile },
    });
    traced.results = readResults(resultsFile);
  } finally {
    removeWrappers([wrapper]);
  }

  if (fs.existsSync(metaFile) || traced.output.includes(META_MARKER)) {
    return { ...result, status: 'skipped', reason: 'runs in browser mode; the tracer needs jsdom or happy-dom' };
  }
  result.traced = { ...traced.results, ms: traced.ms, exitCode: traced.code };
  result.traceFiles = countTraces(traceDir) - before;

  if (opts.baseline) {
    const resultsFile = path.join(tmpDir, `${slug}.baseline.json`);
    const baseline = run(bin, runnerArgs(runner, bin, config, resultsFile, opts.maxWorkers, pkg.args), {
      cwd: pkgDir, timeoutMin: opts.timeout, logFile: path.join(logDir, `${slug}.baseline.log`), env: pkg.env,
    });
    result.baseline = { ...readResults(resultsFile), ms: baseline.ms, exitCode: baseline.code };
  }

  const warnings = [];
  if (traced.timedOut) warnings.push('traced run timed out');
  if (!traced.results) {
    return { ...result, status: 'failed', error: `traced run produced no results (see logs/${projectName}/${slug}.traced.log)` };
  }
  if (!result.traceFiles) warnings.push('no traces written: tests may not use jsdom/happy-dom, or projects are defined in separate files');
  if (result.baseline && result.baseline.passed !== result.traced.passed) {
    warnings.push(`passing tests differ: baseline ${result.baseline.passed}, traced ${result.traced.passed}`);
  }
  if (warnings.length) result.warnings = warnings;
  return { ...result, status: result.traceFiles ? 'traced' : 'failed', ...(result.traceFiles ? {} : { error: warnings[0] }) };
}

// --- Main -----------------------------------------------------------------

// Two concurrent runs would each use every worker they are given, and two
// large suites at once can saturate the machine. Refuse to start instead.
function acquireLock(out) {
  const lockFile = path.join(out, 'run.lock');
  if (fs.existsSync(lockFile)) {
    let pid;
    try { pid = JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid; } catch {}
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; }
    if (alive) {
      process.stderr.write(`trace-corpus is already running (pid ${pid}); wait for it or stop it first.\n`);
      process.exit(1);
    }
  }
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const release = () => {
    try {
      if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.pid) fs.rmSync(lockFile);
    } catch {}
  };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      removeLeftoverWrappers();
      process.exit(130);
    });
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { log(HELP); return; }

  const corpusFile = path.resolve(opts.corpus);
  const corpusDir = path.dirname(corpusFile);
  const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  const out = path.resolve(opts.out);
  const reposDir = path.resolve(expandHome(opts.reposDir || path.join(out, 'repos')));
  const tmpDir = path.join(out, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  acquireLock(out);
  pendingFile = path.join(out, 'pending-wrappers.json');
  removeLeftoverWrappers();

  const statusFile = path.join(out, 'status.json');
  const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : { projects: {} };

  const projects = corpus.projects.filter((p) => !opts.only || opts.only.includes(p.name));
  for (const project of projects) {
    log(`\n▶ ${project.name}`);
    const traceDir = path.join(out, 'traces', project.name);
    const logDir = path.join(out, 'logs', project.name);
    fs.rmSync(traceDir, { recursive: true, force: true });
    const entry = { name: project.name, repo: project.repo, startedAt: new Date().toISOString(), packages: [] };
    status.projects[project.name] = entry;
    try {
      const projectDir = checkout(project, corpusDir, reposDir);
      install(project, projectDir, opts.install, path.join(logDir, 'install.log'));
      if (project.build && opts.build) entry.build = build(project, projectDir, path.join(logDir, 'build.log'));
      const rev = run('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
      if (rev.code === 0) entry.commit = rev.output.split('\n')[1].trim();
      for (const pkg of project.packages) {
        // Per-project tmp dir: results files must not collide between projects.
        const projectTmp = path.join(tmpDir, project.name);
        fs.mkdirSync(projectTmp, { recursive: true });
        const r = tracePackage({ pkg, projectDir, traceDir, logDir, tmpDir: projectTmp, opts, projectName: project.name });
        entry.packages.push(r);
        const t = r.traced;
        const summary = r.status === 'traced'
          ? `${r.traceFiles} traces, ${t.passed}/${t.tests} passed` +
            (r.baseline ? ` (baseline ${r.baseline.passed}/${r.baseline.tests}), ${(t.ms / 1000).toFixed(1)}s vs ${(r.baseline.ms / 1000).toFixed(1)}s` : '')
          : r.reason || r.error;
        log(`  ${r.status.padEnd(7)} ${pkg.dir}: ${summary}`);
        for (const w of r.warnings || []) log(`          ⚠ ${w}`);
      }
    } catch (err) {
      entry.error = err.message;
      log(`  failed: ${err.message}`);
    }
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  }

  const traceDirs = Object.keys(status.projects)
    .map((name) => path.join(out, 'traces', name))
    .filter((d) => countTraces(d) > 0);
  if (traceDirs.length) {
    const res = run(process.execPath, [path.join(root, 'bin/dom-trace.cjs'), 'report', ...traceDirs, '--out', path.join(out, 'report')], {});
    log(`\n${res.output.split('\n').slice(1).join('\n').trim()}`);
    if (res.code !== 0) process.exitCode = 1;
  } else {
    log('\nNo traces collected.');
  }
}


// Importable (tests use vitestWrapper) without starting a run.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
