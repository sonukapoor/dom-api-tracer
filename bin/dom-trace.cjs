#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HELP = `dom-trace — aggregate DOM API usage reports

Usage:
  dom-trace report [dirs...] [--out <dir>] [--top <n>]
      Aggregate run-*.json files from one or more trace directories
      (default: ./.dom-trace). Writes summary.md, usage.json and usage.csv.

  dom-trace clean [dir]
      Delete a trace directory (default: ./.dom-trace).

Options:
  --out <dir>   Where to write the analysis (default: ./dom-trace-report)
  --top <n>     Rows in the "most used" tables (default: 50)
  -h, --help    Show this help
`;

function parseArgs(argv) {
  const args = { _: [], out: 'dom-trace-report', top: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '-h' || a === '--help') args.help = true;
    else args._.push(a);
  }
  return args;
}

function readJsonFiles(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (err) { console.warn(`  skipping unreadable ${f}: ${err.message}`); return null; }
    })
    .filter(Boolean);
}

function interfaceOf(id) {
  return id.slice(0, id.indexOf('#'));
}

function pct(n, d) {
  return d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a';
}

function aggregate(dirs) {
  const runs = [];
  const catalogs = new Map(); // env -> Set(members)
  for (const dir of dirs) {
    runs.push(...readJsonFiles(dir, 'run-'));
    for (const cat of readJsonFiles(dir, 'catalog-')) {
      const set = catalogs.get(cat.environment) || new Set();
      for (const m of cat.members) set.add(m);
      catalogs.set(cat.environment, set);
    }
  }

  const members = new Map(); // id -> { call, get, set, ops, files:Set, projects:Set }
  const projects = new Set();
  const environments = new Set();
  for (const run of runs) {
    const fileKey = `${run.project}::${run.testFile}`;
    projects.add(run.project);
    environments.add(run.environment);
    for (const [id, c] of Object.entries(run.usage || {})) {
      let m = members.get(id);
      if (!m) { m = { id, call: 0, get: 0, set: 0, ops: 0, files: new Set(), projects: new Set() }; members.set(id, m); }
      m.call += c.call || 0; m.get += c.get || 0; m.set += c.set || 0;
      m.ops += (c.call || 0) + (c.get || 0) + (c.set || 0);
      m.files.add(fileKey);
      m.projects.add(run.project);
    }
  }

  const list = [...members.values()].map((m) => ({
    id: m.id,
    interface: interfaceOf(m.id),
    call: m.call, get: m.get, set: m.set, ops: m.ops,
    files: m.files.size,
    projects: m.projects.size,
  }));

  const catalog = new Set();
  for (const set of catalogs.values()) for (const m of set) catalog.add(m);

  return { runs, list, projects, environments, catalog };
}

function coverageCurve(list, thresholds = [0.5, 0.8, 0.9, 0.95, 0.99, 1]) {
  const sorted = [...list].sort((a, b) => b.ops - a.ops);
  const total = sorted.reduce((s, m) => s + m.ops, 0);
  const out = [];
  let acc = 0; let i = 0;
  for (const t of thresholds) {
    while (i < sorted.length && acc < t * total) { acc += sorted[i].ops; i++; }
    out.push({ threshold: t, members: i });
  }
  return { total, curve: out };
}

function interfaceRollup(list, catalog) {
  const byIface = new Map();
  const ensure = (name) => {
    let r = byIface.get(name);
    if (!r) { r = { interface: name, ops: 0, used: 0, available: 0 }; byIface.set(name, r); }
    return r;
  };
  for (const m of catalog) ensure(interfaceOf(m)).available++;
  for (const m of list) { const r = ensure(m.interface); r.ops += m.ops; r.used++; }
  return [...byIface.values()].filter((r) => r.used > 0).sort((a, b) => b.ops - a.ops);
}

function table(headers, rows) {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

function renderMarkdown({ runs, list, projects, environments, catalog }, top) {
  const { total, curve } = coverageCurve(list);
  const projectCount = projects.size;
  const byOps = [...list].sort((a, b) => b.ops - a.ops).slice(0, top);
  const byBreadth = [...list].sort((a, b) => b.projects - a.projects || b.files - a.files || b.ops - a.ops).slice(0, top);
  const core = list.filter((m) => projectCount && m.projects / projectCount >= 0.5).length;
  const common = list.filter((m) => projectCount && m.projects / projectCount >= 0.1).length;
  const ifaces = interfaceRollup(list, catalog).slice(0, top);

  const s = [];
  s.push('# DOM API usage report', '');
  s.push(`Generated ${new Date().toISOString()} from **${runs.length}** test files across **${projectCount}** project(s).`);
  s.push(`Environments observed: ${[...environments].join(', ') || 'none'}.`, '');

  s.push('## Surface area', '');
  s.push(table(['Metric', 'Value'], [
    ['Instrumentable members (catalog)', catalog.size.toLocaleString()],
    ['Members actually used', `${list.length.toLocaleString()} (${pct(list.length, catalog.size)} of catalog)`],
    ['Used by ≥50% of projects ("core")', core.toLocaleString()],
    ['Used by ≥10% of projects ("common")', common.toLocaleString()],
    ['Total recorded operations', total.toLocaleString()],
  ]), '');

  s.push('## Coverage curve', '');
  s.push('How many members account for a given share of all recorded operations.', '');
  s.push(table(['Share of operations', 'Members needed'], curve.map((c) => [`${Math.round(c.threshold * 100)}%`, c.members.toLocaleString()])), '');

  s.push(`## Most widely used members (top ${byBreadth.length})`, '');
  s.push('Breadth matters more than raw counts: a member used lightly by every project is a must-have.', '');
  s.push(table(['Member', 'Projects', 'Files', 'Ops'], byBreadth.map((m) => [`\`${m.id}\``, m.projects, m.files, m.ops.toLocaleString()])), '');

  s.push(`## Hottest members by operation count (top ${byOps.length})`, '');
  s.push('These are the paths a fast implementation must optimize first.', '');
  s.push(table(['Member', 'Calls', 'Gets', 'Sets', 'Ops'], byOps.map((m) => [`\`${m.id}\``, m.call, m.get, m.set, m.ops.toLocaleString()])), '');

  s.push(`## Interfaces (top ${ifaces.length} by operations)`, '');
  s.push(table(['Interface', 'Ops', 'Members used', 'Members available', 'Used %'], ifaces.map((r) => [r.interface, r.ops.toLocaleString(), r.used, r.available || 'n/a', pct(r.used, r.available)])), '');

  return s.join('\n');
}

function renderCsv(list) {
  const rows = ['member,interface,calls,gets,sets,ops,files,projects'];
  for (const m of [...list].sort((a, b) => b.ops - a.ops)) {
    rows.push([m.id, m.interface, m.call, m.get, m.set, m.ops, m.files, m.projects].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  return rows.join('\n') + '\n';
}

function cmdReport(args) {
  const dirs = (args._.length ? args._ : ['.dom-trace']).map((d) => path.resolve(d));
  const data = aggregate(dirs);
  if (!data.runs.length) {
    console.error(`No run-*.json reports found in: ${dirs.join(', ')}`);
    process.exit(1);
  }
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'summary.md'), renderMarkdown(data, args.top));
  fs.writeFileSync(path.join(out, 'usage.csv'), renderCsv(data.list));
  fs.writeFileSync(path.join(out, 'usage.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    testFiles: data.runs.length,
    projects: [...data.projects],
    environments: [...data.environments],
    catalogSize: data.catalog.size,
    coverage: coverageCurve(data.list),
    members: data.list.sort((a, b) => b.ops - a.ops),
    unusedCatalogMembers: (() => { const used = new Set(data.list.map((u) => u.id)); return [...data.catalog].filter((m) => !used.has(m)).sort(); })(),
  }, null, 2));

  const { curve } = coverageCurve(data.list);
  const c90 = curve.find((c) => c.threshold === 0.9);
  console.log(`Analyzed ${data.runs.length} test files from ${data.projects.size} project(s).`);
  console.log(`Used ${data.list.length} of ${data.catalog.size} instrumentable members (${pct(data.list.length, data.catalog.size)}).`);
  console.log(`${c90.members} members cover 90% of all operations.`);
  console.log(`Wrote ${path.relative(process.cwd(), out) || '.'}/summary.md, usage.json, usage.csv`);
}

function cmdClean(args) {
  const dir = path.resolve(args._[0] || '.dom-trace');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!cmd || cmd === '-h' || cmd === '--help' || args.help) { console.log(HELP); return; }
  if (cmd === 'report') return cmdReport(args);
  if (cmd === 'clean') return cmdClean(args);
  console.error(`Unknown command: ${cmd}\n`);
  console.log(HELP);
  process.exit(1);
}

main();
