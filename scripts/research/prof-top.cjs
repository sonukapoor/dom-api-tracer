#!/usr/bin/env node
// Top functions by self time in one V8 CPU profile (the first *.cpuprofile
// in a directory), over all code; percentages of the profile's sampled time
// (idle included). For a micro-benchmark profile, e.g.
//   node --cpu-prof --cpu-prof-dir=/tmp/prof bench/hot.js   (in warpdom)
//   node scripts/research/prof-top.cjs /tmp/prof [topN=20]
// For corpus runs (many profiles) use prof-top-dom.cjs or
// scripts/profile-share.mjs.
const fs = require('fs'); const dir = process.argv[2];
const f = fs.readdirSync(dir).filter((x) => x.endsWith('.cpuprofile')).map((x) => dir + '/' + x)[0];
const p = JSON.parse(fs.readFileSync(f));
const counts = new Map(); p.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
const self = new Map();
for (const n of p.nodes) { const k = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) ?? 0) + (counts.get(n.id) ?? 0)); }
const total = [...self.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +(process.argv[3] ?? 20))) console.log((v / total * 100).toFixed(1).padStart(5) + '%', k);
