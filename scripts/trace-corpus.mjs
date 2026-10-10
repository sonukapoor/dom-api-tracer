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
  --environment <e>  Environment mode: run each suite once on jsdom, happy-dom or warpdom
                     (projects on jsdom/happy-dom are switched; node ones are
                     not), without the tracer. A DOM package the project lacks
                     is linked from this repo for the run.
  --warpdom <dir>    warpdom checkout for --environment warpdom (default: ../warpdom)
  --extra-args <s>   extra runner arguments, space-separated (e.g. a test file filter)
  --first-setup <f>  a Vitest setup file to run before the project's own
  --profile          Write a CPU profile per test process (with --environment);
                     analyse with scripts/profile-share.mjs
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
    else if (a === '--environment') args.environment = argv[++i];
    else if (a === '--profile') args.profile = true;
    else if (a === '--warpdom') args.warpdom = argv[++i];
    else if (a === '--extra-args') args.extraArgs = argv[++i].split(' ').filter(Boolean);
    else if (a === '--first-setup') args.firstSetup = path.resolve(argv[++i]);
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
// Options: trace (add the tracer, default true) and environment (switch
// projects that run on jsdom or happy-dom to this one; node projects keep theirs).
// execArgv: extra Node flags for test workers (profiling).
export function vitestWrapper(base, { trace = true, environment = null, execArgv = [], firstSetup = null } = {}) {
  return `// Generated by dom-api-tracer (scripts/trace-corpus.mjs). Safe to delete.
import fs from 'node:fs';
import base from './${path.basename(base)}';

const TRACER = ${JSON.stringify(TRACER.vitest)};
const ENVIRONMENT = ${JSON.stringify(environment)};
// Setup files that must run before the project's own: the tracer, and an
// optional extra one (--first-setup).
const FIRST = [...(${trace} ? [TRACER] : []), ...${JSON.stringify(firstSetup ? [firstSetup] : [])}];
const addTracer = (test) => (FIRST.length > 0 ? {
  ...test,
  setupFiles: [...FIRST, ...[].concat(test?.setupFiles ?? []).filter((f) => !FIRST.includes(f))],
} : test);
const EXEC_ARGV = ${JSON.stringify(execArgv)};
const switchDom = (test) => (ENVIRONMENT && ['jsdom', 'happy-dom'].includes(test?.environment)
  ? { ...test, environment: ENVIRONMENT } : test);
// Test workers get their Node flags from the pool options (Vitest <= 3) or
// test.execArgv (Vitest >= 4), not from NODE_OPTIONS. Keep the project's own.
const withExecArgv = (test) => {
  if (!EXEC_ARGV.length) return test;
  const pools = { ...test?.poolOptions };
  for (const pool of ['forks', 'threads', 'vmForks', 'vmThreads']) {
    pools[pool] = { ...pools[pool], execArgv: [...(pools[pool]?.execArgv ?? []), ...EXEC_ARGV] };
  }
  return { ...test, poolOptions: pools, execArgv: [...(test?.execArgv ?? []), ...EXEC_ARGV] };
};
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
  Object.assign(test, withExecArgv(switchDom(addTracer(test))));
  // Inline projects only inherit the root setupFiles with \`extends: true\`;
  // adding the tracer to those too would register it twice.
  if (projects) {
    // They do not inherit the root server options either.
    test.projects = projects.map((p) => (isObject(p) && p.extends !== true && !usesBrowser(p.test)
      ? { ...p, server: allowOutside(p.server), test: withExecArgv(switchDom(addTracer(p.test ?? {}))) }
      : isObject(p) && !usesBrowser(p.test) ? { ...p, test: withExecArgv(switchDom(p.test ?? {})) } : p));
  }
  return { ...cfg, server: allowOutside(cfg.server), test };
};
`;
}

// Options as for vitestWrapper; environment is a Jest testEnvironment value.
export function jestWrapper(base, { trace = true, environment = null } = {}) {
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
const ENVIRONMENT = ${JSON.stringify(environment)};
const addTracer = (c${any}) => (${trace} ? {
  ...c,
  setupFilesAfterEnv: [TRACER, ...(c.setupFilesAfterEnv ?? []).filter((f${any}) => f !== TRACER)],
} : c);
const switchDom = (c${any}) => (ENVIRONMENT && /jsdom|happy-dom/.test(String(c.testEnvironment ?? ''))
  ? { ...c, testEnvironment: ENVIRONMENT } : c);

${ts ? 'export default' : 'module.exports ='} async () => {
  let cfg${any} = ${load};
  // \`export default\` arrives as { default } (ts-node) or a namespace (require of ESM).
  if (cfg && typeof cfg === 'object' && 'default' in cfg) cfg = cfg.default;
  if (typeof cfg === 'function') cfg = await cfg();
  cfg = switchDom(addTracer(cfg ?? {}));
  // A project path pointing back at this directory makes Jest reload the
  // original config file, bypassing this wrapper: run the root config itself.
  if (Array.isArray(cfg.projects)) {
    cfg.projects = cfg.projects.filter((p${any}) => !(typeof p === 'string' && ['<rootDir>', '<rootDir>/', '.', './'].includes(p)));
    if (!cfg.projects.length) delete cfg.projects;
  }
  // Inline projects do not inherit the root setupFilesAfterEnv.
  if (Array.isArray(cfg.projects)) {
    cfg.projects = cfg.projects.map((p${any}) => (p && typeof p === 'object' ? switchDom(addTracer(p)) : p));
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

// warpdom's source and runtime dependencies (parse5, entities), copied into
// the package's node_modules for one run; removed with the wrappers.
function copyWarpdom(warpdomDir, pkgDir) {
  const target = path.join(pkgDir, 'node_modules', 'warpdom.dom-trace.copy');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  setPending((list) => [...list.filter((f) => f !== target), target]);
  fs.cpSync(path.join(warpdomDir, 'src'), path.join(target, 'src'), { recursive: true });
  fs.copyFileSync(path.join(warpdomDir, 'package.json'), path.join(target, 'package.json'));
  for (const dep of ['parse5', 'entities']) {
    fs.cpSync(fs.realpathSync(path.join(warpdomDir, 'node_modules', dep)), path.join(target, 'node_modules', dep), { recursive: true });
  }
  return target;
}

export function removeWrappers(files) {
  for (const f of files) {
    // Only ever delete what this script creates: wrapper configs, and links
    // that point into this repository.
    let link = false;
    try { link = fs.lstatSync(f).isSymbolicLink() && fs.realpathSync(f).startsWith(fs.realpathSync(root)); } catch {}
    if (link) fs.unlinkSync(f);
    else if (path.basename(f).includes('.dom-trace.')) fs.rmSync(f, { recursive: true, force: true });
  }
  setPending((list) => list.filter((f) => !files.includes(f)));
}

function removeLeftoverWrappers() {
  if (!pendingFile || !fs.existsSync(pendingFile)) return;
  const leftovers = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  if (leftovers.length) log(`Removing ${leftovers.length} wrapper config(s) left by an interrupted run`);
  removeWrappers(leftovers);
}

function writeWrapper(runner, base, options) {
  const ext = path.extname(base);
  const name = runner === 'vitest'
    ? `vitest.config.dom-trace.${/^\.[mc]?ts$/.test(ext) ? 'mts' : 'mjs'}`
    : `jest.config.dom-trace.${ext === '.ts' ? 'ts' : 'cjs'}`;
  const file = path.join(path.dirname(base), name);
  setPending((list) => [...list.filter((f) => f !== file), file]);
  fs.writeFileSync(file, runner === 'vitest' ? vitestWrapper(base, options) : jestWrapper(base, options));
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

// --- Environment mode -------------------------------------------------------

// Link a DOM package the project lacks from this repository into the
// node_modules that holds the project's test runner, so the runner resolves
// it. Returns the link (recorded for cleanup) or null if it already resolves.
export function provideDomPackage(nodeModules, name) {
  const target = path.join(nodeModules, name);
  if (fs.existsSync(path.join(target, 'package.json'))) return null;
  setPending((list) => [...list.filter((f) => f !== target), target]);
  fs.symlinkSync(path.join(root, 'node_modules', name), target, 'dir');
  return target;
}

function runEnvironment({ pkg, projectDir, logDir, tmpDir, profileDir, opts }) {
  const pkgDir = path.resolve(projectDir, pkg.dir);
  const runner = pkg.runner;
  const result = { dir: pkg.dir, runner, environment: opts.environment };
  const config = findConfig(pkgDir, runner, pkg.config);
  if (!config) return { ...result, status: 'failed', error: `no ${runner} config found in ${pkgDir}` };
  const bin = findBin(pkgDir, runner);
  if (!bin) return { ...result, status: 'failed', error: `${runner} is not installed` };

  // Vitest loads the environment package from the runner's node_modules;
  // Jest accepts a path, so happy-dom's Jest environment comes from this repo.
  const created = [];
  let environment = opts.environment;
  if (opts.environment === 'warpdom') {
    // A copy inside the package's node_modules, as an installed warpdom
    // would be: Vitest hangs loading an environment from outside the
    // project root when files share workers (isolate: false), and Jest
    // runs files outside node_modules through the project's transformer.
    const copy = copyWarpdom(opts.warpdom, pkgDir);
    created.push(copy);
    environment = path.join(copy, 'src', runner === 'jest' ? 'jest.js' : 'vitest.js');
  } else if (runner === 'vitest') {
    const link = provideDomPackage(path.dirname(path.dirname(bin)), opts.environment);
    if (link) { created.push(link); result.providedFrom = 'dom-api-tracer'; }
  } else if (opts.environment === 'happy-dom') {
    environment = path.join(root, 'node_modules', '@happy-dom', 'jest-environment');
    result.providedFrom = 'dom-api-tracer';
  }

  const slug = slugFor(pkg.dir);
  const metaFile = path.join(tmpDir, `${slug}.meta.json`);
  fs.rmSync(metaFile, { force: true });
  const env = { ...pkg.env, DOM_TRACE_CORPUS_META: metaFile };
  let execArgv = [];
  if (profileDir) {
    const dir = path.join(profileDir, slug);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execArgv = ['--cpu-prof', `--cpu-prof-dir=${dir}`];
    // Jest workers are child processes that inherit NODE_OPTIONS; Vitest's
    // get execArgv through the wrapper. The runner's own process too.
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${execArgv.join(' ')}`.trim();
  }
  const wrapper = writeWrapper(runner, config, { trace: false, environment, execArgv: runner === 'vitest' ? execArgv : [], firstSetup: opts.firstSetup ?? null });
  const resultsFile = path.join(tmpDir, `${slug}.${opts.environment}.json`);
  let res;
  try {
    res = run(bin, runnerArgs(runner, bin, wrapper, resultsFile, opts.maxWorkers, [...(pkg.args ?? []), ...(opts.extraArgs ?? [])]), {
      cwd: pkgDir, timeoutMin: opts.timeout, logFile: path.join(logDir, `${slug}.${opts.environment}.log`), env,
    });
  } finally {
    removeWrappers([wrapper, ...created]);
  }
  if (fs.existsSync(metaFile) || res.output.includes(META_MARKER)) {
    return { ...result, status: 'skipped', reason: 'runs in browser mode' };
  }
  const results = readResults(resultsFile);
  if (!results) return { ...result, status: 'failed', error: `run produced no results (see logs/${path.basename(logDir)}/${slug}.${opts.environment}.log)` };
  return { ...result, status: 'ran', run: { ...results, ms: res.ms, exitCode: res.code } };
}

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
    traced = run(bin, runnerArgs(runner, bin, wrapper, resultsFile, opts.maxWorkers, [...(pkg.args ?? []), ...(opts.extraArgs ?? [])]), {
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
    const baseline = run(bin, runnerArgs(runner, bin, config, resultsFile, opts.maxWorkers, [...(pkg.args ?? []), ...(opts.extraArgs ?? [])]), {
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
  if (opts.environment && !['jsdom', 'happy-dom', 'warpdom'].includes(opts.environment)) {
    process.stderr.write(`--environment must be jsdom, happy-dom or warpdom\n`);
    process.exit(1);
  }
  if (opts.environment === 'warpdom') {
    opts.warpdom = path.resolve(expandHome(opts.warpdom || path.join(root, '..', 'warpdom')));
    if (!fs.existsSync(path.join(opts.warpdom, 'src', 'vitest.js'))) {
      process.stderr.write(`warpdom not found at ${opts.warpdom} (use --warpdom <dir>)\n`);
      process.exit(1);
    }
  }

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
    if (!opts.environment) fs.rmSync(traceDir, { recursive: true, force: true });
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
        if (opts.environment) {
          const profileDir = opts.profile ? path.join(out, 'profiles', project.name) : null;
          const r = runEnvironment({ pkg, projectDir, logDir, tmpDir: projectTmp, profileDir, opts });
          entry.packages.push(r);
          log(`  ${r.status.padEnd(7)} ${pkg.dir}: ${r.status === 'ran'
            ? `${r.run.passed}/${r.run.tests} passed on ${r.environment}${r.providedFrom ? ' (provided)' : ''}, ${(r.run.ms / 1000).toFixed(1)}s`
            : r.error || r.reason}`);
          continue;
        }
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

  if (opts.environment) return;
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
