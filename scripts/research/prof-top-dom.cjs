#!/usr/bin/env node
// Top functions by self time across a directory tree of V8 CPU profiles
// (e.g. one corpus run with `trace-corpus.mjs --profile`), counting only
// frames whose URL matches a pattern: by default warpdom's own source as
// the harness runs it, a copy at <package>/node_modules/warpdom.dom-trace.copy/src/.
// Built-in frames (no URL) are charged to their nearest caller with a
// source file; idle time is excluded. Prints the matched share of all CPU
// time, then each function's share of the matched time.
//
//   node scripts/research/prof-top-dom.cjs <profiles-dir> [urlPattern] [topN=30]
//   e.g. node scripts/research/prof-top-dom.cjs .corpus-env/prof-mui/profiles
// Category split of the same profiles: node scripts/profile-share.mjs <dir>
const fs = require('fs');
const path = require('path');
const [dir, pattern = 'warpdom.dom-trace.copy/src/', topN = 30] = process.argv.slice(2);
const re = new RegExp(pattern.replace(/[.]/g, '\\.'));
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.cpuprofile')) files.push(p);
  }
};
walk(dir);
const self = new Map();
let total = 0,
  matched = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(f));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const time = new Map();
  p.samples.forEach((id, i) => time.set(id, (time.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
  for (const [id, t] of time) {
    let n = byId.get(id);
    if (n.callFrame.functionName === '(idle)') continue;
    total += t;
    while (n && !n.callFrame.url && parent.has(n.id)) n = byId.get(parent.get(n.id));
    if (!n || !re.test(n.callFrame.url)) continue;
    matched += t;
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/src/').pop()}:${n.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + t);
  }
}
console.log(
  `${files.length} profiles; matched ${(matched / 1e6).toFixed(1)} s of ${(total / 1e6).toFixed(1)} s (${((matched / total) * 100).toFixed(1)}%)`,
);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +topN))
  console.log(`${((v / matched) * 100).toFixed(1).padStart(5)}%  ${(v / 1e6).toFixed(2).padStart(6)} s  ${k}`);
