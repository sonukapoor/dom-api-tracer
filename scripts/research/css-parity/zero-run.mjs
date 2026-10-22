// Declared-value serialization of zero lengths and box shorthands
// (e.g. margin: 0 0, inset: 0) on warpdom or a jsdom version: for each
// property in a props module, set each value and read it back. Run it for
// several DOMs and diff the JSON outputs to see where jsdom versions differ
// and whether warpdom's jsdom profile follows them.
//
//   node scripts/research/css-parity/zero-run.mjs warpdom <props.mjs> [jsdomMajor=30]
//   node scripts/research/css-parity/zero-run.mjs <jsdom|jsdom26|<dir>> <props.mjs>
//
// props modules export PROPS and VALUES: zero-props.mjs (zero lengths
// across length properties), zero-props2.mjs (box shorthands),
// zero-props3.mjs (margin/padding/border-width shortening).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { warpdomImport, loadJsdom } from './warpdom-dir.mjs';
const { PROPS, VALUES } = await import(pathToFileURL(path.resolve(process.argv[3])).href);
let style;
if (process.argv[2] === 'warpdom') {
  const { createWindow } = await warpdomImport('src/node.js');
  style = () => createWindow({ jsdom: Number(process.argv[4] ?? 30) }).document.createElement('div').style;
} else {
  const { JSDOM } = loadJsdom(process.argv[2]);
  const w = new JSDOM('').window;
  style = () => w.document.createElement('div').style;
}
const out = {};
for (const p of PROPS)
  out[p] = VALUES.map((v) => {
    const s = style();
    s.setProperty(p, v);
    return s.getPropertyValue(p);
  }).join(' | ');
console.log(JSON.stringify(out));
