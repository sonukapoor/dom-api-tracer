#!/usr/bin/env node
// Compute the figures used in the stage 1 report from a traced corpus:
// .corpus/traces (per-file traces), .corpus/status.json (harness results),
// .corpus/report/usage.json (dom-trace report) and corpus/corpus.json (labels).
// Writes .corpus/report/report-data.json.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, '.corpus'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const corpus = readJson(path.join(root, 'corpus/corpus.json')).projects;
const status = readJson(path.join(out, 'status.json')).projects;
const usage = readJson(path.join(out, 'report/usage.json'));
const meta = Object.fromEntries(corpus.map((p) => [p.name, p]));

// Same rule as bin/dom-trace.cjs: only well-known symbols are DOM API.
const isPublic = (id) => { const k = id.slice(id.indexOf('#') + 1); return !k.startsWith('[') || k.startsWith('[Symbol.'); };
const iface = (id) => id.slice(0, id.indexOf('#'));
// Host APIs: environment, timing and platform services rather than the document tree.
const HOST = new Set(['window', 'Performance', 'Navigator', 'Location', 'History', 'Storage', 'Crypto', 'Screen', 'MediaQueryList']);
const isHost = (id) => HOST.has(iface(id));

// Per project: test files, operations, members and the environments seen.
const perProject = {};
const fileOps = []; // { project, file, ops }
for (const name of fs.readdirSync(path.join(out, 'traces'))) {
  const dir = path.join(out, 'traces', name);
  const p = { files: 0, ops: 0, members: new Set(), environments: new Set() };
  for (const f of fs.readdirSync(dir).filter((n) => n.startsWith('run-'))) {
    const run = readJson(path.join(dir, f));
    let ops = 0;
    for (const [id, c] of Object.entries(run.usage)) {
      if (!isPublic(id)) continue;
      const n = (c.call || 0) + (c.get || 0) + (c.set || 0);
      ops += n;
      p.members.add(id);
    }
    p.files++; p.ops += ops; p.environments.add(run.environment);
    fileOps.push({ project: name, file: run.testFile, ops });
  }
  perProject[name] = p;
}
const projectNames = Object.keys(perProject);
const totalOps = fileOps.reduce((a, f) => a + f.ops, 0);

// 1. Corpus table.
const corpusTable = corpus.filter((c) => perProject[c.name]).map((c) => {
  const s = status[c.name];
  const pkgs = (s?.packages || []).filter((k) => k.status === 'traced');
  const sum = (k, field) => pkgs.reduce((a, x) => a + (x[k]?.[field] || 0), 0);
  return {
    name: c.name, repo: c.repo, commit: s?.commit, frameworks: c.frameworks, kind: c.kind,
    environments: [...perProject[c.name].environments].sort(),
    packages: pkgs.length, testFiles: perProject[c.name].files, tests: sum('traced', 'tests'),
    passedTraced: sum('traced', 'passed'), passedBaseline: sum('baseline', 'passed'),
    baselineSeconds: Math.round(sum('baseline', 'ms') / 1000), tracedSeconds: Math.round(sum('traced', 'ms') / 1000),
    opsPerFile: Math.round(perProject[c.name].ops / perProject[c.name].files),
    membersUsed: perProject[c.name].members.size,
  };
});

// 2. Core set: members used by at least half of the projects, by interface.
const half = Math.ceil(projectNames.length / 2);
const core = usage.members.filter((m) => m.projects >= half);
const coreByInterface = {};
for (const m of core) (coreByInterface[m.interface] ||= []).push(m.id.slice(m.id.indexOf('#') + 1));

// 3. Breadth and hot paths, DOM tree vs host APIs.
const pick = (m) => ({ id: m.id, projects: m.projects, files: m.files, ops: m.ops, topFileShare: +m.topFileShare.toFixed(3), environments: m.environments });
const byBreadth = [...usage.members].sort((a, b) => b.projects - a.projects || b.files - a.files || b.ops - a.ops);
const byOps = [...usage.members].sort((a, b) => b.ops - a.ops);
const hostOps = usage.members.filter((m) => isHost(m.id)).reduce((a, m) => a + m.ops, 0);

// 4. Distinctive members per kind of library: used by at least half of that
//    kind's projects and by no more than 20% of the others.
const kinds = {};
for (const c of corpusTable) (kinds[c.kind] ||= []).push(c.name);
const distinctive = {};
for (const [kind, names] of Object.entries(kinds)) {
  if (names.length < 2) continue;
  const others = projectNames.filter((n) => !names.includes(n));
  const rows = [];
  for (const m of usage.members) {
    const inKind = names.filter((n) => perProject[n].members.has(m.id)).length;
    const inOthers = others.filter((n) => perProject[n].members.has(m.id)).length;
    if (inKind >= Math.ceil(names.length / 2) && inOthers <= 0.2 * others.length) rows.push({ id: m.id, inKind, inOthers, ops: m.ops });
  }
  distinctive[kind] = { projects: names, members: rows.sort((a, b) => b.inKind - a.inKind || b.ops - a.ops).slice(0, 25) };
}

// 5. Interfaces nobody used, per environment.
const unusedInterfaces = {};
for (const env of usage.environments) {
  const catalog = new Set();
  for (const name of projectNames) {
    const f = path.join(out, 'traces', name, `catalog-${env}.json`);
    if (fs.existsSync(f)) for (const id of readJson(f).members) if (isPublic(id)) catalog.add(id);
  }
  const used = new Set(usage.members.filter((m) => m.environments.includes(env)).map((m) => m.id));
  const byIface = {};
  for (const id of catalog) { const r = (byIface[iface(id)] ||= { available: 0, used: 0 }); r.available++; if (used.has(id)) r.used++; }
  const rows = Object.entries(byIface).map(([name, r]) => ({ interface: name, ...r }));
  unusedInterfaces[env] = {
    interfaces: rows.length,
    untouched: rows.filter((r) => r.used === 0).length,
    largestUntouched: rows.filter((r) => r.used === 0).sort((a, b) => b.available - a.available).slice(0, 30),
  };
}

// 6. Concentration of operations across test files and projects.
const sortedFiles = [...fileOps].sort((a, b) => b.ops - a.ops);
const share = (n) => sortedFiles.slice(0, n).reduce((a, f) => a + f.ops, 0) / totalOps;
const concentration = {
  totalOps, testFiles: fileOps.length,
  top10FilesShare: +share(10).toFixed(3), top100FilesShare: +share(100).toFixed(3),
  medianOpsPerFile: sortedFiles[Math.floor(sortedFiles.length / 2)].ops,
  topFiles: sortedFiles.slice(0, 10),
  opsByProject: Object.fromEntries(projectNames.map((n) => [n, perProject[n].ops]).sort((a, b) => b[1] - a[1])),
};

const data = {
  generatedAt: new Date().toISOString(),
  projects: projectNames.length, testFiles: usage.testFiles,
  environmentCoverage: usage.environmentCoverage,
  membersUsed: usage.members.length,
  coverage: usage.coverage,
  corpus: corpusTable,
  core: { threshold: half, count: core.length, byInterface: coreByInterface },
  breadthTop: byBreadth.slice(0, 40).map(pick),
  hotDom: byOps.filter((m) => !isHost(m.id)).slice(0, 30).map(pick),
  hotHost: byOps.filter((m) => isHost(m.id)).slice(0, 10).map(pick),
  hostShareOfOps: +(hostOps / totalOps).toFixed(3),
  distinctive,
  unusedInterfaces,
  concentration,
};
fs.writeFileSync(path.join(out, 'report/report-data.json'), JSON.stringify(data, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), path.join(out, 'report/report-data.json'))}`);
