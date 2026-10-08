#!/usr/bin/env node
// Where does test time go? Reads the V8 CPU profiles written by
// `trace-corpus.mjs --environment <env> --profile` (<dir>/<project>/<package>/
// *.cpuprofile) and splits sampled CPU time (self time) by what was running:
// the DOM implementation, the UI framework, Testing Library, the test runner,
// code transforms, project code (tests and the library under test), garbage
// collection and other. Idle time is reported separately and excluded.
//
//   node scripts/profile-share.mjs <profiles-dir> [--json]
import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = [
  ['dom', /node_modules\/(jsdom|happy-dom|@happy-dom|cssstyle|nwsapi|parse5|@asamuzakjp|rrweb-cssom|cssom|whatwg-url|whatwg-mimetype|whatwg-encoding|data-urls|html-encoding-sniffer|saxes|symbol-tree|w3c-xmlserializer|xml-name-validator|decimal\.js|css-tree|@csstools|domexception|webidl-conversions|tr46|is-potential-custom-element-name|jest-environment-jsdom)\//],
  ['testing-library', /node_modules\/(@testing-library|pretty-format|dom-accessibility-api|aria-query|lz-string)\//],
  ['framework', /node_modules\/(react|react-dom|scheduler|vue|@vue|svelte|solid-js|@solidjs|@angular|zone\.js|lit|lit-html|@lit|preact|rxjs)\//],
  ['runner', /node_modules\/(vitest|@vitest|jest|@jest|jest-[^/]+|tinypool|tinyspy|tinybench|chai|expect|vite-node|@sinonjs|jest-circus|jest-jasmine2|istanbul-[^/]+|babel-plugin-istanbul)\//],
  ['transform', /node_modules\/(vite|esbuild|@esbuild|@babel|babel-[^/]+|typescript|ts-jest|ts-node|@swc|rollup|@rollup|rolldown|@rolldown|oxc-[^/]+|@oxc-[^/]+|sucrase|source-map|source-map-support|@jridgewell|es-module-lexer|lightningcss|postcss|esbuild-jest|@vitejs|vite-plugin-[^/]+|@analogjs)\//],
];

function categorize(node) {
  const { url, functionName } = node.callFrame;
  if (functionName === '(idle)') return 'idle';
  if (functionName === '(garbage collector)') return 'gc';
  if (!url) return 'other';
  for (const [name, re] of CATEGORIES) if (re.test(url)) return name;
  if (url.includes('/node_modules/')) return 'other-deps';
  if (url.startsWith('node:') || !url.includes('/')) return 'node';
  return 'project';
}

function profileTimes(file) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const times = {};
  for (let i = 0; i < p.samples.length; i++) {
    const node = byId.get(p.samples[i]);
    const cat = node ? categorize(node) : 'other';
    times[cat] = (times[cat] || 0) + (p.timeDeltas[i] || 0);
  }
  return times;
}

function summarize(times) {
  const busy = Object.entries(times).filter(([k]) => k !== 'idle').reduce((a, [, v]) => a + v, 0);
  const categories = {};
  for (const [k, v] of Object.entries(times)) if (k !== 'idle') categories[k] = busy ? v / busy : 0;
  return { cpuSeconds: +(busy / 1e6).toFixed(2), idleSeconds: +((times.idle || 0) / 1e6).toFixed(2), categories };
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: profile-share.mjs <profiles-dir> [--json]'); process.exit(1); }

const result = {};
for (const project of fs.readdirSync(dir)) {
  const projectDir = path.join(dir, project);
  if (!fs.statSync(projectDir).isDirectory()) continue;
  const total = {};
  const packages = {};
  for (const pkg of fs.readdirSync(projectDir)) {
    const pkgDir = path.join(projectDir, pkg);
    if (!fs.statSync(pkgDir).isDirectory()) continue;
    const times = {};
    const files = fs.readdirSync(pkgDir).filter((f) => f.endsWith('.cpuprofile'));
    for (const f of files) {
      for (const [k, v] of Object.entries(profileTimes(path.join(pkgDir, f)))) {
        times[k] = (times[k] || 0) + v;
        total[k] = (total[k] || 0) + v;
      }
    }
    packages[pkg] = { profiles: files.length, ...summarize(times) };
  }
  result[project] = { ...summarize(total), packages };
}

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2));
} else {
  const cols = ['dom', 'framework', 'testing-library', 'runner', 'transform', 'project', 'gc', 'node', 'other-deps', 'other'];
  console.log(['project'.padEnd(22), 'cpu s'.padStart(8), ...cols.map((c) => c.slice(0, 10).padStart(11))].join(''));
  for (const [name, r] of Object.entries(result)) {
    console.log([name.padEnd(22), String(r.cpuSeconds).padStart(8), ...cols.map((c) => `${((r.categories[c] || 0) * 100).toFixed(1)}%`.padStart(11))].join(''));
  }
}
