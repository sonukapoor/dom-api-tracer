// CSS value validation parity: for each property jsdom knows (from
// @webref/css) and a set of generic values plus the keywords in the
// property's grammar, does warpdom's validator (src/css-values.js
// isValidValue) agree with jsdom on validity? jsdom is a black-box
// reference: a value counts as valid when style.setProperty keeps it.
//
//   node scripts/research/css-parity/val-parity.mjs [warpdomDir] [jsdom|jsdom26|<dir>] [out.json]
//   ONLY=width,margin node scripts/research/css-parity/val-parity.mjs   (only these properties)
//
// Prints the number of pairs checked and both kinds of disagreement; the
// lists go to out.json. warpdomDir defaults to WARPDOM_DIR or ../warpdom.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WARPDOM_DIR, warpdomRequire, loadJsdom } from './warpdom-dir.mjs';
const wdDir = path.resolve(process.argv[2] ?? WARPDOM_DIR);
const { JSDOM } = loadJsdom(process.argv[3] ?? 'jsdom');
const { isValidValue } = await import(pathToFileURL(path.join(wdDir, 'src', 'css-values.js')).href);
const { properties } = warpdomRequire('@webref/css/css.json');
const w = new JSDOM('').window;
const GENERIC = ['0', '10px', '-10px', '50%', '1', '1.5', '-1', '2.5', 'auto', 'none', 'normal', 'red', '#fff', 'url(x.png)', '"str"', 'foo', '1s', '200ms', '45deg',
  'calc(1px + 2px)', '1px 2px', '1px 2px 3px 4px 5px', 'a, b', '10px solid red', 'rgb(1, 2, 3)', 'rgba(0,0,0,.5)', 'linear-gradient(red, blue)', 'translateX(10px)', '1fr',
  'repeat(2, 1fr)', 'span 2', '2 / 3', 'italic bold 12px/30px Georgia, serif', 'center', 'left top', 'bold', 'hidden', 'pointer', 'block', 'flex', 'ease-in-out', '0 0 2px red'];
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const disagree = { wdRejects: [], wdAccepts: [] };
let total = 0;
for (const p of properties) {
  const probe = w.document.createElement('div').style;
  probe.setProperty(p.name, 'initial');
  if (probe.getPropertyValue(p.name) === '') continue; // unknown to jsdom
  if (ONLY && !ONLY.has(p.name)) continue;
  const keywords = [...new Set((p.syntax ?? '').match(/(?<![<'\w-])[a-z][a-z-]*(?![\w(-])/g) ?? [])];
  for (const value of [...GENERIC, ...keywords]) {
    const s = w.document.createElement('div').style;
    s.setProperty(p.name, value);
    const jsdomOk = s.getPropertyValue(p.name) !== '';
    let ours;
    try { ours = isValidValue(p.name, value); } catch (e) { ours = 'THROW ' + e.message; }
    total++;
    if (ours === true && !jsdomOk) disagree.wdAccepts.push(`${p.name}: ${value}`);
    else if (ours !== true && jsdomOk) disagree.wdRejects.push(`${p.name}: ${value}${ours === false ? '' : ' (' + ours + ')'}`);
  }
}
console.log('checked', total, '| warpdom rejects, jsdom accepts:', disagree.wdRejects.length, '| warpdom accepts, jsdom rejects:', disagree.wdAccepts.length);
if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(disagree, null, 1));
