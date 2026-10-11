// Which shorthands a jsdom version expands into longhands and which it
// composes back from longhands (black box), using warpdom's shorthand and
// initial-value tables (src/css-data.js) as the property list. Used to
// build warpdom's per-jsdom-version shorthand behavior.
//
//   node scripts/research/css-parity/shorthand-sets.mjs [jsdom|jsdom26|<dir>]
//
// Prints JSON { expands, composes } (shorthand names).
import { warpdomImport, loadJsdom } from './warpdom-dir.mjs';
const { JSDOM } = loadJsdom(process.argv[2] ?? 'jsdom');
const { SHORTHANDS, LONGHANDS } = await warpdomImport('src/css-data.js');
const w = new JSDOM('').window;
const expands = [], composes = [];
for (const [sh, longs] of Object.entries(SHORTHANDS)) {
  // Expansion: set each longhand's initial value through the shorthand ('initial' is special-cased by jsdom, so use a value).
  let expanded = false;
  for (const lh of longs) {
    const init = LONGHANDS[lh]?.[0];
    if (!init || /\s|,/.test(init)) continue;
    const s = w.document.createElement('div').style; s.setProperty(sh, init);
    if (s.getPropertyValue(sh) !== '' && longs.some((l) => s.getPropertyValue(l) !== '')) { expanded = true; break; }
  }
  if (expanded) expands.push(sh);
  const s2 = w.document.createElement('div').style; let ok = true;
  for (const lh of longs) { const init = LONGHANDS[lh]?.[0]; if (!init || /,/.test(init)) { ok = false; break; } s2.setProperty(lh, init); }
  if (ok && s2.getPropertyValue(sh) !== '') composes.push(sh);
}
console.log(JSON.stringify({ expands, composes }));
