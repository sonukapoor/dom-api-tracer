// For each CSS property in @webref/css: does this jsdom know it (keeps the
// value 'initial'), and does it reject an invalid value ('#qqq %% 1q2')?
// Shows which jsdom versions validate CSS values (26: a few dozen
// properties; 27 and later: all it knows). Black-box use of jsdom only.
//
//   node scripts/research/css-parity/val-sweep.mjs [jsdom|jsdom26|<dir>] > sweep.json
//
// Prints JSON { known, validates, acceptsInvalid } (property name lists).
import { warpdomRequire, loadJsdom } from './warpdom-dir.mjs';
const { JSDOM } = loadJsdom(process.argv[2] ?? 'jsdom');
const { properties } = warpdomRequire('@webref/css/css.json');
const w = new JSDOM('').window;
const result = { known: [], validates: [], acceptsInvalid: [] };
for (const { name } of properties) {
  const s = w.document.createElement('div').style;
  s.setProperty(name, 'initial');
  if (s.getPropertyValue(name) === '') continue; // unknown to this jsdom
  result.known.push(name);
  const t = w.document.createElement('div').style;
  t.setProperty(name, '#qqq %% 1q2');
  (t.getPropertyValue(name) === '' ? result.validates : result.acceptsInvalid).push(name);
}
console.log(JSON.stringify(result));
