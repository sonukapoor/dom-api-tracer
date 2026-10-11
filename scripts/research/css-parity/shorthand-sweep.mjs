// Shorthand parity, warpdom vs jsdom 30: for every shorthand warpdom knows
// (src/css-data.js SHORTHANDS), (a) set a typical value and read each
// longhand; (b) set each longhand to its initial value and read the
// shorthand. Prints the first 40 differences and the count.
//
//   WARPDOM_DIR=~/Projects/warpdom node scripts/research/css-parity/shorthand-sweep.mjs [jsdom|jsdom26|<dir>]
import { warpdomImport, loadJsdom } from './warpdom-dir.mjs';
const { JSDOM } = loadJsdom(process.argv[2] ?? 'jsdom');
const { createWindow } = await warpdomImport('src/node.js');
const { SHORTHANDS, LONGHANDS } = await warpdomImport('src/css-data.js');
const SAMPLE = { margin: '1px 2px', padding: '1px 2px', border: '1px solid red', 'border-top': '1px solid red', 'border-width': '1px 2px', 'border-style': 'solid', 'border-color': 'red blue',
  background: 'red', font: 'italic bold 12px/2 Arial', flex: '1', outline: '1px solid red', overflow: 'hidden', inset: '1px', gap: '1px 2px', 'border-radius': '3px', 'list-style': 'none',
  transition: 'opacity 1s', animation: 'spin 1s', 'text-decoration': 'underline', 'flex-flow': 'row wrap', 'place-items': 'center', 'grid-area': 'a', columns: '2', 'column-rule': '1px solid red', 'border-inline': '1px solid red' };
const LONG_VALUE = (lh) => { const init = LONGHANDS[lh]?.[0]; return init && !/\s/.test(init) && init !== 'auto' ? init : null; };
const run = (w) => {
  const out = {};
  for (const sh of Object.keys(SHORTHANDS)) {
    const v = SAMPLE[sh];
    if (v) { const s = w.document.createElement('div').style; s.setProperty(sh, v); out[`${sh}: ${v} -> longhands`] = SHORTHANDS[sh].map((lh) => `${lh}=${s.getPropertyValue(lh)}`).join(' '); }
    const s2 = w.document.createElement('div').style;
    let all = true;
    for (const lh of SHORTHANDS[sh]) { const lv = LONG_VALUE(lh); if (!lv) { all = false; break; } s2.setProperty(lh, lv); }
    if (all) out[`all longhands -> ${sh}`] = s2.getPropertyValue(sh);
  }
  return out;
};
const j = run(new JSDOM('').window), wd = run(createWindow());
let n = 0;
for (const k of Object.keys(j)) if (j[k] !== wd[k]) { n++; if (n <= 40) console.log(k, '\n   jsdom:', JSON.stringify(j[k]), '\n   wd:   ', JSON.stringify(wd[k])); }
console.log('differences', n, 'of', Object.keys(j).length);
