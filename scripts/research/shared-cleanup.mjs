// Generic cleanup between test files for Vitest without isolation (the
// baseline jsdom-sharedclean: jsdom, --no-isolate, this file first in
// setupFiles). It is what a practitioner could copy into a project to make
// `isolate: false` safer: the same file for every project, no per-project
// tuning, and it never looks inside the DOM implementation.
//
// When it runs: Vitest runs setupFiles before each test file, also without
// isolation, in the same global scope (Vitest docs, config "setupFiles";
// guide "Improving Performance": isolate false). So the reset happens at the
// start of every file and undoes what the previous file in the same worker
// left behind; in the first file of a worker it only records the starting
// state. The harness (trace-corpus.mjs --project-setup) copies this file
// next to the project's Vitest config for the run, so its imports
// ('vitest', Testing Library) resolve to the same modules as the tests'.
//
// Steps, in order:
//  1. Testing Library's cleanup(): unmounts the components the previous file
//     rendered and removes their containers (Testing Library docs, "API":
//     cleanup; it runs automatically after each test only when the test
//     framework's afterEach is global, i.e. Vitest with globals: true,
//     otherwise the docs say to call it yourself). For each of
//     @testing-library/{react,preact,vue,svelte} and
//     @solidjs/testing-library that the project has installed, a guarded
//     dynamic import; absent packages are skipped. Unmounting also removes
//     the listeners those components added to document and window.
//     The automatic cleanup is registered when the library's module is
//     evaluated, and without isolation that happens in the first file
//     only; so where it applies (afterEach global, the library's
//     *_SKIP_AUTO_CLEANUP variable unset) this file registers
//     afterEach(cleanup) again, as the docs show for doing it by hand, and
//     every file gets it as it would isolated.
//  2. vi.useRealTimers(): a file that left fake timers on (Vitest docs,
//     "Mocking > Timers": restore real timers after using fake ones).
//  3. vi.restoreAllMocks(), vi.unstubAllGlobals(), vi.unstubAllEnvs(): the
//     spies, stubbed globals and environment variables the previous file
//     left (Vitest docs, "vi" API; the same reset the config options
//     restoreMocks, unstubGlobals and unstubEnvs do). Called once per file
//     rather than through those options, which act before every test and
//     would change behavior within a file (a file relying on a mock across
//     its own tests). The four functions exist in every Vitest from 1 to 5
//     (restoreAllMocks restores only vi.spyOn spies from Vitest 3 on,
//     every mock before; as in each version's restoreMocks option).
//  4. document.body: all children removed (what Testing Library's cleanup
//     does for its own containers, extended to nodes added with plain DOM
//     calls), and the attributes of <html> and <body> restored to their
//     values at the start of the worker's first file (modals and scroll
//     locks set styles, classes and aria-hidden there).
//     document.head is left alone: libraries insert their styles there once
//     per module instance (emotion and styled-components caches, Vuetify's
//     theme stylesheet), and without isolation those modules stay loaded,
//     so removing the head nodes a file added would leave later files
//     without styles the libraries think are present. Head leftovers stay
//     shared, as in a plain isolate: false run.
//  5. localStorage.clear(), sessionStorage.clear() (Web Storage API).
//  6. document.title back to its starting value (only when it changed:
//     setting it creates a <title> element when there is none),
//     document.cookie: every cookie visible from the current URL expired
//     (path / and each prefix of the current path; cookies with other
//     paths or domains are not visible to script and stay), then the URL
//     restored with history.replaceState to the starting URL (jsdom does
//     not navigate, so a test can only change the URL through history or
//     the hash), and cookies visible from that URL expired too.
// Each step is guarded: a missing API or an error skips that step only.
import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = Symbol.for('dom-api-tracer.shared-cleanup');
const state = globalThis[KEY];
const doc = globalThis.document;
const attrs = (el) => (el ? [...el.attributes].map((a) => [a.name, a.value]) : []);

// Each library and the variable that turns its automatic cleanup off.
const TESTING_LIBRARIES = {
  '@testing-library/react': 'RTL_SKIP_AUTO_CLEANUP',
  '@testing-library/preact': 'PTL_SKIP_AUTO_CLEANUP',
  '@testing-library/vue': 'VTL_SKIP_AUTO_CLEANUP',
  '@testing-library/svelte': 'STL_SKIP_AUTO_CLEANUP',
  '@solidjs/testing-library': 'STL_SKIP_AUTO_CLEANUP',
};
// Installed: a node_modules/<name> directory from this file's directory up.
function installed(name) {
  let dir;
  try { dir = path.dirname(fileURLToPath(import.meta.url)); } catch { dir = process.cwd(); }
  for (; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', name, 'package.json'))) return true;
    if (dir === path.dirname(dir)) return false;
  }
}

const step = async (fn) => { try { await fn(); } catch {} };

if (!state) {
  // The worker's first file: record the starting state.
  globalThis[KEY] = {
    url: globalThis.location?.href,
    title: doc?.title,
    html: attrs(doc?.documentElement),
    body: attrs(doc?.body),
    libraries: Object.keys(TESTING_LIBRARIES).filter(installed),
  };
} else {
  // 1. Testing Library: the previous file's components, and the automatic
  // cleanup after each test of this file.
  for (const name of state.libraries) {
    await step(async () => {
      const lib = await import(/* @vite-ignore */ name);
      if (typeof lib.cleanup !== 'function') return;
      await lib.cleanup();
      if (typeof globalThis.afterEach === 'function' && !process.env[TESTING_LIBRARIES[name]]) {
        globalThis.afterEach(async () => { await lib.cleanup(); });
      }
    });
  }
  // 2 and 3. Vitest's per-file runtime state.
  await step(() => vi.useRealTimers());
  await step(() => vi.restoreAllMocks());
  await step(() => vi.unstubAllGlobals?.());
  await step(() => vi.unstubAllEnvs?.());
  if (doc) {
    // 4. Body and the attributes of <html> and <body>.
    await step(() => { doc.body.replaceChildren(); });
    const restore = (el, saved) => {
      if (!el) return;
      const want = new Map(saved);
      for (const a of [...el.attributes]) if (!want.has(a.name)) el.removeAttribute(a.name);
      for (const [n, v] of want) if (el.getAttribute(n) !== v) el.setAttribute(n, v);
    };
    await step(() => restore(doc.documentElement, state.html));
    await step(() => restore(doc.body, state.body));
  }
  // 5. Storage.
  await step(() => globalThis.localStorage?.clear());
  await step(() => globalThis.sessionStorage?.clear());
  if (doc) {
    // 6. Title, cookies, URL.
    await step(() => { if (doc.title !== state.title) doc.title = state.title; });
    const expireCookies = () => {
      const names = doc.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean);
      if (!names.length) return;
      const parts = (globalThis.location?.pathname ?? '/').split('/').filter(Boolean);
      const paths = ['/', ...parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/'))];
      for (const n of names) for (const p of paths) doc.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${p}`;
    };
    await step(expireCookies);
    await step(() => { if (state.url && globalThis.location.href !== state.url) globalThis.history.replaceState(null, '', state.url); });
    await step(expireCookies);
  }
}
