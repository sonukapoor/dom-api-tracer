// Shared by the CSS parity scripts: the warpdom checkout (WARPDOM_DIR, else
// ../warpdom next to this repository) and a require() that resolves from it,
// so jsdom ('jsdom' is v30, 'jsdom26' is v26.1) and @webref/css come from
// warpdom's devDependencies. jsdom is only a black-box behavior reference.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WARPDOM_DIR = path.resolve(process.env.WARPDOM_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'warpdom'));
export const warpdomRequire = createRequire(path.join(WARPDOM_DIR, 'package.json'));
export const warpdomImport = (file) => import(pathToFileURL(path.join(WARPDOM_DIR, file)).href);
// A jsdom by package name resolved from warpdom ('jsdom', 'jsdom26'), or by
// path: a jsdom package directory, or a directory with node_modules/jsdom
// (e.g. `npm install jsdom@27` in a scratch directory for another version).
export function loadJsdom(which = 'jsdom') {
  if (!which.startsWith('/') && !which.startsWith('.')) return warpdomRequire(which);
  const dir = path.resolve(which);
  const req = createRequire(path.join(dir, 'package.json'));
  return fs.existsSync(path.join(dir, 'lib', 'api.js')) ? req(dir) : req('jsdom');
}
