// Experiment: with --no-isolate, give every test file a fresh jsdom window
// (Vitest otherwise keeps one window per worker). Runs first in setupFiles.
import { JSDOM } from 'jsdom';
import { populateGlobal } from 'vitest/environments';

const g = globalThis;
if (g.__freshWindowRestore) g.__freshWindowRestore();
const dom = new JSDOM('<!DOCTYPE html>', {
  pretendToBeVisual: true,
  runScripts: 'dangerously',
  url: 'http://localhost:3000',
  resources: 'usable',
});
const { keys, originals } = populateGlobal(g, dom.window, { bindFunctions: true });
g.jsdom = dom;
g.__freshWindowRestore = () => {
  for (const key of keys) delete g[key];
  for (const [key, value] of originals) g[key] = value;
  dom.window.close();
};
g.__freshWindowCount = (g.__freshWindowCount ?? 0) + 1;
