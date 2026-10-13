// Per-file timing of two environments from perfile-reporter.mjs output:
// the median of each phase per test file over the rounds, the phase totals,
// and the files where the second environment loses the most time.
//
//   node scripts/research/perfile.cjs <a-label>=<a.jsonl>[,<a2.jsonl>...] <b-label>=<b.jsonl>[,...] [--top 20]
//
// Phases (ms): environment setup, prepare, collect (importing the test file
// and its dependencies), setup files, tests.
const fs = require('fs');

const PHASES = ['environment', 'prepare', 'collect', 'setup', 'tests'];
const args = process.argv.slice(2);
const topIndex = args.indexOf('--top');
const top = topIndex >= 0 ? +args.splice(topIndex, 2)[1] : 20;
if (args.length !== 2) {
  console.error('usage: perfile.cjs <a-label>=<a.jsonl>[,...] <b-label>=<b.jsonl>[,...] [--top n]');
  process.exit(2);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

// label -> Map(file -> { phase: median ms })
function load(spec) {
  const [label, list] = spec.split('=');
  const runs = new Map();
  for (const file of list.split(',')) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (!runs.has(r.file)) runs.set(r.file, []);
      runs.get(r.file).push(r);
    }
  }
  const files = new Map();
  for (const [file, rs] of runs) {
    files.set(file, Object.fromEntries(PHASES.map((p) => [p, median(rs.map((r) => r[p] ?? 0))])));
  }
  return { label, files };
}

const [a, b] = args.map(load);
const total = (t) => PHASES.reduce((s, p) => s + t[p], 0);
const common = [...a.files.keys()].filter((f) => b.files.has(f));
const fmt = (ms) => (ms / 1000).toFixed(2).padStart(8);

console.log(`${common.length} test files in both (${a.files.size} ${a.label}, ${b.files.size} ${b.label})\n`);
console.log(`phase totals, seconds (summed over files; workers run files in parallel)`);
console.log(`${'phase'.padEnd(12)}${a.label.padStart(9)}${b.label.padStart(9)}  ratio`);
for (const p of [...PHASES, 'total']) {
  const sum = (env) => common.reduce((s, f) => s + (p === 'total' ? total(env.files.get(f)) : env.files.get(f)[p]), 0);
  const [sa, sb] = [sum(a), sum(b)];
  console.log(`${p.padEnd(12)}${fmt(sa)} ${fmt(sb)}  ${(sa / sb).toFixed(2)}x`);
}

const rows = common.map((f) => {
  const [ta, tb] = [a.files.get(f), b.files.get(f)];
  return { f, ta, tb, delta: total(tb) - total(ta) };
}).sort((x, y) => y.delta - x.delta);
const slower = rows.filter((r) => r.delta > 0);
console.log(`\n${slower.length} of ${rows.length} files slower on ${b.label}; the ${Math.min(top, slower.length)} that lose the most (ms, ${a.label} -> ${b.label}):`);
const short = (f) => f.split('/').slice(-3).join('/');
for (const { f, ta, tb, delta } of slower.slice(0, top)) {
  const phases = PHASES.map((p) => `${p} ${Math.round(ta[p])}->${Math.round(tb[p])}`).join(', ');
  console.log(`  +${Math.round(delta)} ms  ${short(f)}  (${phases})`);
}
