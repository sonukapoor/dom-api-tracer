// End-to-end check: run the fixture suites under every supported runner and
// environment with the tracer installed, then assert the recorded counts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.dom-trace-verify');
fs.rmSync(out, { recursive: true, force: true });

const bin = (name) => path.join(root, 'node_modules', '.bin', name);
const runs = [
  { name: 'vitest-jsdom', env: 'jsdom', cmd: [bin('vitest'), 'run', '--environment', 'jsdom'] },
  { name: 'vitest-jsdom-shared', env: 'jsdom', project: 'corpus-repo', cmd: [bin('vitest'), 'run', '--environment', 'jsdom', '--no-isolate'] },
  { name: 'vitest-happy-dom', env: 'happy-dom', cmd: [bin('vitest'), 'run', '--environment', 'happy-dom'] },
  { name: 'jest-jsdom', env: 'jsdom', project: 'corpus-repo', cmd: [bin('jest'), '-c', 'jest.config.cjs'] },
];

let failures = 0;
for (const run of runs) {
  const dir = path.join(out, run.name);
  process.stdout.write(`• ${run.name.padEnd(22)}`);
  try {
    execFileSync(run.cmd[0], run.cmd.slice(1), {
      cwd: root, stdio: 'pipe', env: { ...process.env, DOM_TRACE_DIR: dir, DOM_TRACE_PROJECT: run.project ?? '', CI: '1' },
    });
    const reports = fs.readdirSync(dir).filter((f) => f.startsWith('run-'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const byFile = Object.fromEntries(reports.map((r) => [path.basename(r.testFile).split('.')[0], r]));

    assert.ok(byFile.list && byFile.form && byFile.events, 'expected reports for list and form fixtures');
    // A file running without a DOM passes (the run would throw otherwise) and writes no report.
    assert.equal(byFile['node-env'], undefined, 'node-env: no report without a DOM');
    // Test framework globals (describe, it, ...) sit on the jsdom window under Jest.
    for (const r of reports) {
      for (const id of ['window#describe', 'window#it', 'window#test', 'window#beforeEach', 'window#expect']) {
        assert.equal(r.usage[id], undefined, `${id} is not a DOM member (${r.testFile})`);
      }
    }
    for (const r of reports) assert.equal(r.environment, run.env, `environment detected for ${r.testFile}`);
    // DOM_TRACE_PROJECT names the project; otherwise it is the cwd's basename.
    for (const r of reports) assert.equal(r.project, run.project ?? path.basename(root), `project name for ${r.testFile}`);
    assert.equal(byFile.list.usage['Document#createElement']?.call, 51, 'list: createElement calls');
    assert.equal(byFile.list.usage['DOMTokenList#add']?.call, 50, 'list: classList.add calls');
    assert.equal(byFile.list.usage['Element#setAttribute']?.call, 50, 'list: setAttribute calls');
    assert.ok(byFile.list.usage['window#getComputedStyle']?.call > 0, 'list: getComputedStyle counted as calls');
    assert.ok(byFile.form.usage['EventTarget#addEventListener']?.call > 0, 'form: addEventListener counted');
    assert.equal(byFile.events.usage['Element#setAttribute']?.call, 3, 'events: calls inside listeners counted');
    assert.equal(byFile.events.usage['HTMLElement#click']?.call, 1, 'events: click counted');
    // Selector matching and style resolution read the tree through the same
    // public getters the tests use; only the test's own calls count.
    const internals = byFile.internals.usage;
    assert.equal(internals['window#getComputedStyle']?.call, 1, 'internals: getComputedStyle counted');
    assert.equal(internals['Element#querySelector']?.call, 1, 'internals: querySelector counted');
    for (const id of ['Element#localName', 'Node#nodeType', 'Node#parentNode', 'Element#getAttribute']) {
      assert.equal(internals[id], undefined, `internals: ${id} read by the implementation not counted`);
    }
    // Dispatch internals (the implementation reading event.type, eventPhase,
    // ...) are not counted; the listener and onclick handler code is.
    const dispatch = byFile.dispatch.usage;
    assert.deepEqual(Object.keys(dispatch).filter((id) => /^Event#/.test(id)), [], 'dispatch: no Event members read by the implementation');
    assert.equal(dispatch['Element#setAttribute']?.call, 2, 'dispatch: listener and onclick handler counted');
    const ce = byFile['custom-element'].usage;
    // jsdom defines textContent on Node, happy-dom on Element.
    assert.equal((ce['Node#textContent'] ?? ce['Element#textContent'])?.set, 1, 'custom element: connectedCallback counted');
    assert.equal(ce['DOMTokenList#add']?.call, 1, 'custom element: attributeChangedCallback counted');
    assert.equal(ce['Element#hasAttribute']?.call, 1, 'custom element: disconnectedCallback counted');
    assert.ok(fs.readdirSync(dir).some((f) => f === `catalog-${run.env}.json`), 'catalog written');
    // jsdom's window lives in its own realm with its own Object.prototype;
    // ECMAScript built-ins of any realm must never be instrumented.
    const catalog = JSON.parse(fs.readFileSync(path.join(dir, `catalog-${run.env}.json`), 'utf8'));
    const builtins = catalog.members.filter((id) => /^(Object|Function|Array|Promise|Error|Map|Set)#/.test(id));
    assert.deepEqual(builtins, [], 'catalog: no ECMAScript built-ins');
    console.log('ok');
  } catch (err) {
    failures++;
    console.log('FAILED');
    console.log(String(err.stdout || '') + String(err.stderr || '') || err.message);
  }
}

// The report CLI must aggregate everything without errors.
try {
  execFileSync(process.execPath, [path.join(root, 'bin/dom-trace.cjs'), 'report',
    ...runs.map((r) => path.join(out, r.name)), '--out', path.join(out, 'report')], { cwd: root, stdio: 'pipe' });
  const summary = fs.readFileSync(path.join(out, 'report', 'summary.md'), 'utf8');
  assert.match(summary, /Coverage curve/);

  // Coverage per environment: jsdom and happy-dom catalogs differ, so a
  // combined percentage would mislead.
  const usage = JSON.parse(fs.readFileSync(path.join(out, 'report', 'usage.json'), 'utf8'));
  const envs = Object.fromEntries(usage.environmentCoverage.map((e) => [e.environment, e]));
  for (const env of ['jsdom', 'happy-dom']) {
    assert.ok(envs[env]?.catalog > 0 && envs[env].used > 0 && envs[env].used <= envs[env].catalog, `report: ${env} coverage`);
  }
  assert.equal(envs['happy-dom'].testFiles, usage.testFiles - envs.jsdom.testFiles, 'report: test files split by environment');
  assert.match(summary, /## Coverage by environment/);

  // Concentration: share of a member's operations from its busiest test file.
  const byId = Object.fromEntries(usage.members.map((m) => [m.id, m]));
  for (const m of usage.members) assert.ok(m.topFileShare > 0 && m.topFileShare <= 1, `report: topFileShare of ${m.id}`);
  // Recompute createElement's share from the raw runs (files keyed by project + path).
  const perFile = new Map();
  for (const r of runs) {
    for (const f of fs.readdirSync(path.join(out, r.name)).filter((n) => n.startsWith('run-'))) {
      const run = JSON.parse(fs.readFileSync(path.join(out, r.name, f), 'utf8'));
      const n = run.usage['Document#createElement']?.call || 0;
      const key = `${run.project}::${run.testFile}`;
      perFile.set(key, (perFile.get(key) || 0) + n);
    }
  }
  const total = [...perFile.values()].reduce((a, b) => a + b, 0);
  assert.equal(byId['Document#createElement'].topFileShare, Math.max(...perFile.values()) / total, 'report: concentration of createElement');
  assert.deepEqual(byId['Document#createElement'].environments, ['happy-dom', 'jsdom'], 'report: environments per member');
  assert.match(summary, /Top file share/);

  // Members keyed by private symbols (happy-dom's [getTokenList], [appendChild],
  // ...) are implementation internals, not DOM API: excluded from the report.
  const catalogs = runs.flatMap((r) => fs.readdirSync(path.join(out, r.name)).filter((n) => n.startsWith('catalog-'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(out, r.name, n), 'utf8'))));
  assert.ok(catalogs.some((c) => c.members.some((id) => /#\[(?!Symbol\.)/.test(id))), 'fixture: happy-dom has private-symbol members');
  const isPrivate = (id) => /#\[(?!Symbol\.)/.test(id);
  assert.deepEqual(usage.members.filter((m) => isPrivate(m.id)).map((m) => m.id), [], 'report: no private-symbol members used');
  assert.deepEqual(usage.unusedCatalogMembers.filter(isPrivate), [], 'report: no private-symbol members in the catalog');
  console.log('• report CLI              ok');
} catch (err) {
  failures++;
  console.log('• report CLI              FAILED\n' + (err.stderr || err.message));
}

// The corpus harness must trace a fixture corpus end to end: inject the tracer
// into each package's own config, compare against an untraced baseline, skip
// browser-mode suites and leave no generated files behind.
try {
  const corpusDir = path.join(root, 'test/fixtures/corpus');
  const corpusOut = path.join(out, 'corpus');
  const harness = (extra = []) => execFileSync(process.execPath, [path.join(root, 'scripts/trace-corpus.mjs'),
    path.join(corpusDir, 'corpus.json'), '--out', corpusOut, ...extra], { cwd: root, stdio: 'pipe' });

  // State left by a killed run: a stale lock (dead pid) and a wrapper config
  // that was never removed. The next run must recover from both.
  fs.mkdirSync(corpusOut, { recursive: true });
  fs.writeFileSync(path.join(corpusOut, 'run.lock'), JSON.stringify({ pid: 2 ** 22 + 1 }));
  const staleWrapper = path.join(corpusDir, 'jest-pkg', 'stale.dom-trace.cjs');
  fs.writeFileSync(staleWrapper, '// left behind by a killed run\n');
  fs.writeFileSync(path.join(corpusOut, 'pending-wrappers.json'), JSON.stringify([staleWrapper]));

  harness(['--max-workers', '1']);
  assert.ok(!fs.existsSync(staleWrapper), 'corpus: wrapper left by a killed run removed');
  assert.ok(!fs.existsSync(path.join(corpusOut, 'run.lock')), 'corpus: lock released');
  assert.match(fs.readFileSync(path.join(corpusOut, 'logs/fixture-corpus/vitest-pkg.traced.log'), 'utf8'),
    /--maxWorkers=1/, 'corpus: vitest worker cap');
  assert.match(fs.readFileSync(path.join(corpusOut, 'logs/fixture-corpus/jest-pkg.baseline.log'), 'utf8'),
    /--maxWorkers=1/, 'corpus: jest worker cap');

  // A second run while one is active must refuse to start.
  fs.writeFileSync(path.join(corpusOut, 'run.lock'), JSON.stringify({ pid: process.pid }));
  assert.throws(() => harness(), (err) => /already running/.test(String(err.stderr)), 'corpus: concurrent run refused');
  fs.rmSync(path.join(corpusOut, 'run.lock'));

  const status = JSON.parse(fs.readFileSync(path.join(corpusOut, 'status.json'), 'utf8'));
  const project = status.projects['fixture-corpus'];
  assert.equal(project.build?.exitCode, 0, 'corpus: build command ran');
  assert.match(fs.readFileSync(path.join(corpusOut, 'logs/fixture-corpus/build.log'), 'utf8'), /fixture build ran/, 'corpus: build log');
  const pkgs = Object.fromEntries(project.packages.map((p) => [p.dir, p]));
  // vitest-pkg checks the corpus-supplied env; both record their DOM.
  for (const [dir, passes] of [['vitest-pkg', 4], ['jest-pkg', 3]]) {
    assert.equal(pkgs[dir].status, 'traced', `${dir}: status (${pkgs[dir].error || ''})`);
    assert.equal(pkgs[dir].baseline.passed, passes, `${dir}: baseline passes`);
    assert.equal(pkgs[dir].traced.passed, passes, `${dir}: traced passes`);
    assert.equal(pkgs[dir].traceFiles, 1, `${dir}: one trace per test file`);
    assert.equal(pkgs[dir].traced.files, 1, `${dir}: files counts test files, not suites`);
  }
  // Projects with `extends: true` inherit the root setupFiles: one trace per file, not two.
  assert.equal(pkgs['projects-pkg'].status, 'traced', `projects-pkg: status (${pkgs['projects-pkg'].error || ''})`);
  assert.equal(pkgs['projects-pkg'].traceFiles, 1, 'projects-pkg: one trace per test file');
  assert.equal(pkgs['browser-pkg'].status, 'skipped', 'browser-pkg: skipped');
  assert.match(pkgs['browser-pkg'].reason, /browser/, 'browser-pkg: skip reason');

  const traceDir = path.join(corpusOut, 'traces', 'fixture-corpus');
  const runsOut = fs.readdirSync(traceDir).filter((f) => f.startsWith('run-'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(traceDir, f), 'utf8')));
  assert.equal(runsOut.length, 5, 'corpus: trace files');
  for (const r of runsOut.filter((r) => !String(r.testFile).includes('pinned'))) {
    assert.equal(r.project, 'fixture-corpus', 'corpus: packages share the project name');
    assert.equal(r.usage['Document#createElement']?.call, 2, `corpus: createElement in ${r.testFile}`);
  }

  const leftovers = fs.readdirSync(corpusDir, { recursive: true }).filter((f) => String(f).includes('.dom-trace.'));
  assert.deepEqual(leftovers, [], 'corpus: generated wrapper configs removed');
  assert.ok(fs.existsSync(path.join(corpusOut, 'report', 'summary.md')), 'corpus: report written');
  console.log('• corpus harness          ok');
} catch (err) {
  failures++;
  console.log('• corpus harness          FAILED\n' + (String(err.stdout || '') + String(err.stderr || '') || '') + err.message);
}

// Environment mode: the same suites on another DOM, untraced, with CPU
// profiles, and a profile breakdown by where the time went.
try {
  const corpusDir = path.join(root, 'test/fixtures/corpus');
  const envOut = path.join(out, 'corpus-env');
  const envLog = path.join(out, 'env.log');
  execFileSync(process.execPath, [path.join(root, 'scripts/trace-corpus.mjs'), path.join(corpusDir, 'corpus.json'),
    '--out', envOut, '--environment', 'happy-dom', '--profile', '--max-workers', '1'],
    { cwd: root, stdio: 'pipe', env: { ...process.env, FIXTURE_ENV_LOG: envLog } });
  const envStatus = JSON.parse(fs.readFileSync(path.join(envOut, 'status.json'), 'utf8')).projects['fixture-corpus'];
  const pk = Object.fromEntries(envStatus.packages.map((p) => [p.dir, p]));
  for (const [dir, passes] of [['vitest-pkg', 4], ['jest-pkg', 3]]) {
    assert.equal(pk[dir].status, 'ran', `env mode: ${dir} status (${pk[dir].error || ''})`);
    assert.equal(pk[dir].environment, 'happy-dom', `env mode: ${dir} environment recorded`);
    assert.equal(pk[dir].run.passed, passes, `env mode: ${dir} passes`);
  }
  const ran = fs.readFileSync(envLog, 'utf8').trim().split('\n');
  assert.ok(ran.some((l) => l.startsWith('vitest ') && /HappyDOM/.test(l)), 'env mode: vitest ran on happy-dom');
  assert.ok(ran.some((l) => l.startsWith('jest ') && /HappyDOM/.test(l)), 'env mode: jest ran on happy-dom');
  // A file pinning jsdom with a comment is switched too, and counted.
  assert.ok(ran.some((l) => l.startsWith('pinned ') && /HappyDOM/.test(l)), 'env mode: pinned file ran on happy-dom');
  assert.equal(pk['pinned-pkg'].pinnedSwitched, 1, 'env mode: pinned file switch counted');
  assert.ok(ran.some((l) => l.startsWith('jest-pinned ') && /HappyDOM/.test(l)), 'env mode: Jest file pinned to jsdom ran on happy-dom');
  assert.ok(!fs.existsSync(path.join(corpusDir, 'jest-pinned-pkg', 'node_modules', 'jest-environment-jest-environment-jsdom')), 'env mode: Jest pinned package removed');
  assert.ok(!fs.existsSync(path.join(envOut, 'traces', 'fixture-corpus')), 'env mode: no tracing');

  const profiles = fs.readdirSync(path.join(envOut, 'profiles', 'fixture-corpus'), { recursive: true }).filter((f) => String(f).endsWith('.cpuprofile'));
  assert.ok(profiles.length >= 2, 'env mode: CPU profiles written');
  const shareOut = execFileSync(process.execPath, [path.join(root, 'scripts/profile-share.mjs'), path.join(envOut, 'profiles'), '--json'], { cwd: root });
  const share = JSON.parse(String(shareOut))['fixture-corpus'];
  const total = Object.values(share.categories).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, 'profile share: categories sum to 100%');
  assert.ok(share.categories.dom > 0, 'profile share: time in the DOM implementation');

  // --environment warpdom needs a warpdom checkout.
  assert.throws(() => execFileSync(process.execPath, [path.join(root, 'scripts/trace-corpus.mjs'), path.join(corpusDir, 'corpus.json'),
    '--out', path.join(out, 'corpus-warpdom'), '--environment', 'warpdom', '--warpdom', path.join(out, 'no-warpdom-here')], { stdio: 'pipe' }),
    (err) => /warpdom not found/.test(String(err.stderr)), 'env mode: missing warpdom checkout reported');

  // A DOM package the project lacks is linked from this repo, then removed.
  const { provideDomPackage, removeWrappers } = await import(path.join(root, 'scripts/trace-corpus.mjs'));
  const fakeModules = path.join(out, 'fake-project', 'node_modules');
  fs.mkdirSync(fakeModules, { recursive: true });
  const link = provideDomPackage(fakeModules, 'happy-dom');
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(root, 'node_modules', 'happy-dom')), 'env mode: package linked');
  removeWrappers([link]);
  assert.ok(!fs.existsSync(link) && fs.existsSync(path.join(root, 'node_modules', 'happy-dom', 'package.json')), 'env mode: link removed, package intact');
  console.log('• environment mode        ok');
} catch (err) {
  failures++;
  console.log('• environment mode        FAILED\n' + (String(err.stdout || '') + String(err.stderr || '')).slice(-1500) + err.message);
}

// setup-cost: Vitest's duration breakdown in both formats, and a run on the
// fixture corpus with and without isolation.
try {
  const { parseDuration } = await import(path.join(root, 'scripts/setup-cost.mjs?parse'));
  const old = parseDuration('   Duration  4.08s (transform 1.26s, setup 3.09s, collect 8.04s, tests 7.96s, environment 8.50s, prepare 1.91s)');
  assert.equal(old.wallMs, 4080, 'setup-cost: wall time');
  assert.ok(Math.abs(old.shares.environment - 8.5 / 30.76) < 1e-9 && old.shares.import > 0, 'setup-cost: absolute format, collect counted as import');
  const pct = parseDuration('   Duration  640ms (environment 95%, transform 2%, tests 1%, setup 1%, worker 1%)');
  assert.ok(Math.abs(pct.shares.environment - 0.95) < 1e-9 && pct.wallMs === 640, 'setup-cost: percent format');

  const scOut = path.join(out, 'setup-cost');
  execFileSync(process.execPath, [path.join(root, 'scripts/setup-cost.mjs'), path.join(root, 'test/fixtures/corpus/corpus.json'),
    '--out', scOut, '--max-workers', '1'], { cwd: root, stdio: 'pipe', env: { ...process.env, FIXTURE_ENV_LOG: '' } });
  const sc = JSON.parse(fs.readFileSync(path.join(scOut, 'results.json'), 'utf8'))['fixture-corpus/vitest-pkg'];
  for (const mode of ['isolated', 'shared']) {
    assert.ok(sc[mode].tests === 4 && sc[mode].breakdown?.shares?.environment > 0, `setup-cost: ${mode} run with breakdown`);
  }
  console.log('• setup cost              ok');
} catch (err) {
  failures++;
  console.log('• setup cost              FAILED\n' + (String(err.stdout || '') + String(err.stderr || '')).slice(-800) + err.message);
}

// Listener wrappers must be transparent to code that inspects registered
// listeners, like zone.js + Angular's DebugElement (ngx-formly), which finds
// Angular's listeners by their source text.
try {
  const { JSDOM } = await import('jsdom');
  const { default: tracer } = await import(path.join(root, 'src/tracer.cjs'));
  const dom = new JSDOM('<!doctype html><body><button></button></body>');
  const proto = dom.window.EventTarget.prototype;
  const seen = [];
  const original = proto.addEventListener;
  // Like zone.js: patched before the tracer installs, records what it receives.
  proto.addEventListener = function (type, fn, opts) { seen.push(fn); return original.call(this, type, fn, opts); };
  tracer.install({ window: dom.window, document: dom.window.document });
  const listener = function angularListener(e) { if (e === '__ngUnwrap__') return 'unwrapped'; };
  dom.window.document.querySelector('button').addEventListener('click', listener);
  const stored = seen[seen.length - 1];
  assert.equal(String(stored), String(listener), 'listener wrapper: toString is the original source');
  assert.equal(stored('__ngUnwrap__'), 'unwrapped', 'listener wrapper: calls pass through');
  console.log('• listener wrapper        ok');
} catch (err) {
  failures++;
  console.log('• listener wrapper        FAILED\n' + err.message);
}

// A runner may replace the window on the same global between test files
// (Vitest 2 with isolate: false, as in solid): each new window must be
// instrumented, not just the first.
try {
  const { JSDOM } = await import('jsdom');
  const { default: tracer } = await import(path.join(root, 'src/tracer.cjs'));
  const g = {};
  const first = new JSDOM('<!doctype html><body></body>');
  Object.assign(g, { window: first.window, document: first.window.document });
  const registry = tracer.install(g);
  const second = new JSDOM('<!doctype html><body></body>');
  Object.assign(g, { window: second.window, document: second.window.document });
  assert.equal(tracer.install(g), registry, 'window swap: same registry');
  second.window.document.createElement('div');
  assert.equal(tracer.snapshot(registry, { reset: true })['Document#createElement']?.call, 1, 'window swap: new window instrumented');
  console.log('• window swap             ok');
} catch (err) {
  failures++;
  console.log('• window swap             FAILED\n' + err.message);
}

// The generated Vitest wrapper, evaluated directly: mixed configs keep their
// DOM projects (vuetify: jsdom "unit" + real-browser "browser"), browser
// projects never get the tracer, and all-browser configs are skipped.
try {
  const { vitestWrapper } = await import(path.join(root, 'scripts/trace-corpus.mjs'));
  const dir = path.join(out, 'wrapper');
  fs.mkdirSync(dir, { recursive: true });
  const browser = { enabled: true, instances: [{ browser: 'chromium' }] };
  const load = async (name, config) => {
    const base = path.join(dir, `${name}.config.mjs`);
    fs.writeFileSync(base, `export default ${JSON.stringify(config)};`);
    const wrapper = path.join(dir, `${name}.dom-trace.mjs`);
    fs.writeFileSync(wrapper, vitestWrapper(base));
    return (await import(wrapper)).default({ mode: 'test' });
  };
  const hasTracer = (t) => (t?.setupFiles ?? []).some((f) => f.endsWith('vitest-setup.mjs'));

  const mixed = await load('mixed', { test: { projects: [
    { test: { name: 'unit', environment: 'jsdom' } },
    { test: { name: 'browser', browser } },
  ] } });
  assert.ok(hasTracer(mixed.test.projects[0].test), 'wrapper: DOM project gets the tracer');
  assert.ok(!hasTracer(mixed.test.projects[1].test), 'wrapper: browser project does not');
  // Inline projects without \`extends: true\` do not inherit the root server
  // options (radix): each must be allowed to load the tracer from outside.
  assert.equal(mixed.test.projects[0].server?.fs?.strict, false, 'wrapper: project may load the tracer');

  await assert.rejects(load('all-browser', { test: { projects: [{ test: { name: 'b', browser } }] } }),
    /browser mode/, 'wrapper: all-browser config skipped');
  await assert.rejects(load('root-browser', { test: { browser } }), /browser mode/, 'wrapper: root browser config skipped');
  // Jest: \`projects: ['<rootDir>']\` (react-spectrum) makes Jest reload the
  // original config file for that project, bypassing the wrapper.
  const { jestWrapper } = await import(path.join(root, 'scripts/trace-corpus.mjs'));
  const jestBase = path.join(dir, 'jest.config.cjs');
  fs.writeFileSync(jestBase, `module.exports = ${JSON.stringify({ testEnvironment: 'jsdom', projects: ['<rootDir>'], setupFilesAfterEnv: ['./own.js'] })};`);
  fs.writeFileSync(path.join(dir, 'jest.dom-trace.cjs'), jestWrapper(jestBase));
  const jestCfg = await (await import(path.join(dir, 'jest.dom-trace.cjs'))).default();
  assert.equal(jestCfg.projects, undefined, 'jest wrapper: self-referencing projects dropped');
  assert.ok(jestCfg.setupFilesAfterEnv[0].endsWith('jest-setup.cjs') && jestCfg.setupFilesAfterEnv[1] === './own.js', 'jest wrapper: tracer first');
  // TS Jest configs (mantine): Jest 30 on Node >= 22.18 loads them with
  // native type stripping, which needs explicit extensions.
  const tsWrapper = jestWrapper(path.join(dir, 'jest.config.ts'));
  assert.match(tsWrapper, /await import\(\['\.\/jest\.config', '\.ts'\]\.join\(''\)\)/, 'jest wrapper: TS config loaded with import() and its extension');
  assert.match(tsWrapper, /^export default async/m, 'jest wrapper: TS wrapper is a module like the original');
  if (process.features.typescript) {
    // Native path, in an ESM package. (CommonJS packages go through Jest's
    // ts-node fallback, which the real corpus exercises: mantine, ngx-formly.)
    const esm = path.join(dir, 'esm');
    fs.mkdirSync(esm, { recursive: true });
    fs.writeFileSync(path.join(esm, 'package.json'), '{ "type": "module" }');
    fs.writeFileSync(path.join(esm, 'jest.config.ts'), `export default { testEnvironment: 'jsdom' as string };`);
    fs.writeFileSync(path.join(esm, 'jest.dom-trace.ts'), jestWrapper(path.join(esm, 'jest.config.ts')));
    const tsCfg = await (await import(path.join(esm, 'jest.dom-trace.ts'))).default();
    assert.equal(tsCfg.testEnvironment, 'jsdom', 'jest wrapper: TS config with export default loads');
  }
  const { slugFor } = await import(path.join(root, 'scripts/trace-corpus.mjs'));
  assert.deepEqual(['.', './', 'packages/react', 'packages/@scope/x'].map(slugFor),
    ['root', 'root', 'packages_react', 'packages_scope_x'], 'harness: package file names');
  console.log('• vitest wrapper          ok');
} catch (err) {
  failures++;
  console.log('• vitest wrapper          FAILED\n' + err.message);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
console.log('\nAll checks passed.');
