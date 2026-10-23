#!/usr/bin/env node
// Records of warpdom fast mode's learning and learned runs, one JSON line
// each (ablation-isolation.sh writes them to <csv>.learning.jsonl;
// ablation-report.cjs reads them).
//
//   learning.cjs cli <results dir> <jsonl> <round> <project> <learn|run>
//       from the <slug>.fastcli.json files that trace-corpus.mjs --fast-cli
//       writes (the shipped `warpdom vitest run`, one per package)
//   learning.cjs harness <jsonl> <round> <project> <learn|run> <project dir> [--key value ...]
//       from the harness emulation: --t_iso --t_sh --t_split --mode
//       --leaky "<abs files>" --seconds --rerun "<abs files>" --new "<abs files>"
//       --isolate "<abs files>" --reason --mode_after --config
//
// Fields: round (0 = the warm-up, whose learning is the state the timed
// learned runs start from), project, kind (learn: learning from scratch;
// run: a timed learned run), method (cli | harness), seconds (whole
// learning or run), t_iso / t_sh / t_split (learning: isolated, shared
// and split runs, seconds; for cli, t_iso and t_split as warpdom measured
// them and t_sh the rest of the learning time, i.e. the shared run plus
// the CLI's own overhead), mode (isolated | split; per package
// "slug=mode;..." when a project has several), leaky (files, relative to
// the project checkout, cli: "slug::file"), and for runs: isolated (files
// run isolated), rerun (files re-run isolated by the safety net), new_leaky.
// warpdom's state version 2 adds, for cli: isolate (learn: files run
// isolated, leaky ones and those failing without isolation), reasons
// (learn: why each package's mode), new_isolated and mode_after (run: the
// state after the run; a split run can switch to isolated).
const fs = require('fs');
const path = require('path');

const [cmd, ...args] = process.argv.slice(2);
const num = (v) => (v === undefined || v === '' || v === 'NA' || Number.isNaN(+v) ? null : +v);
const round3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const sum = (a) => (a.some((v) => v == null) ? null : a.reduce((s, v) => s + v, 0));

if (cmd === 'cli') {
  const [dir, jsonl, round, project, kind] = args;
  const pkgs = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.fastcli.json'))
        .sort()
        .map((f) => ({
          slug: f.slice(0, -'.fastcli.json'.length),
          ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
        }))
    : [];
  // No package ran the CLI (e.g. unsupported Vitest): nothing to record.
  if (!pkgs.length) process.exit(0);
  const modeOf = (p) => (kind === 'learn' ? p.after?.mode : p.before?.mode) ?? null;
  const rel = (p, list) => (list ?? []).map((f) => `${p.slug}::${f}`);
  const rec = {
    round: +round,
    project,
    kind,
    method: 'cli',
    packages: pkgs.length,
    seconds: round3(sum(pkgs.map((p) => (p.timedOut ? null : p.ms / 1000)))),
    mode: pkgs.length === 1 ? modeOf(pkgs[0]) : pkgs.map((p) => `${p.slug}=${modeOf(p)}`).join(';'),
    vitest: [...new Set(pkgs.map((p) => p.vitest))].join(';'),
  };
  if (kind === 'learn') {
    const iso = pkgs.map((p) => num(p.after?.learned?.isolated));
    const split = pkgs.map((p) => num(p.after?.learned?.split));
    Object.assign(rec, {
      t_iso: round3(sum(iso)),
      t_split: round3(sum(split)),
      isolate: pkgs.flatMap((p) => rel(p, p.after?.isolate ?? p.after?.leaky)),
      reasons: pkgs.map((p) => `${p.slug}: ${p.after?.reason ?? ''}`).filter((r) => !r.endsWith(': ')),
      t_sh: round3(
        sum(
          pkgs.map((p, i) =>
            iso[i] == null || split[i] == null || p.timedOut ? null : p.ms / 1000 - iso[i] - split[i],
          ),
        ),
      ),
      t_sh_runs: round3(
        sum(pkgs.map((p) => p.runs.filter((r) => r.mode === 'fast').reduce((s, r) => s + r.seconds, 0))),
      ),
      leaky: pkgs.flatMap((p) => rel(p, p.after?.leaky)),
    });
  } else {
    // warpdom state version 2: isolate (files run isolated: leaky ones and
    // ones failing without isolation) and leaky; version 1: leaky only.
    const isolateOf = (s) => s?.isolate ?? s?.leaky;
    const before = pkgs.flatMap((p) => rel(p, p.before?.leaky));
    const after = pkgs.flatMap((p) => rel(p, p.after?.leaky));
    const isoBefore = pkgs.flatMap((p) => rel(p, isolateOf(p.before)));
    const isoAfter = pkgs.flatMap((p) => rel(p, isolateOf(p.after)));
    Object.assign(rec, {
      isolated: isoBefore.length,
      rerun: pkgs.reduce((s, p) => s + p.runs.filter((r) => r.rerun).reduce((t, r) => t + r.files, 0), 0),
      new_leaky: after.filter((f) => !before.includes(f)),
      new_isolated: isoAfter.filter((f) => !isoBefore.includes(f)),
      mode_after:
        pkgs.length === 1
          ? (pkgs[0].after?.mode ?? null)
          : pkgs.map((p) => `${p.slug}=${p.after?.mode ?? null}`).join(';'),
      leaky: after,
    });
  }
  fs.appendFileSync(jsonl, JSON.stringify(rec) + '\n');
} else if (cmd === 'harness') {
  const [jsonl, round, project, kind, root, ...rest] = args;
  const o = {};
  for (let i = 0; i < rest.length; i += 2) o[rest[i].replace(/^--/, '')] = rest[i + 1];
  const files = (s) =>
    (s ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((f) => (f.startsWith(root + '/') ? f.slice(root.length + 1) : f));
  const rec = { round: +round, project, kind, method: 'harness', seconds: num(o.seconds), mode: o.mode ?? null };
  // The configuration (warpdom-learned, jsdom-learned); records without one are warpdom-learned's.
  if (o.config) rec.config = o.config;
  // --isolate (files run isolated) and --reason / --mode_after come from
  // the emulation of warpdom's state version 2; without --isolate, the
  // leaky files were the isolated ones.
  const isolate = o.isolate !== undefined ? files(o.isolate) : null;
  if (kind === 'learn') {
    Object.assign(rec, { t_iso: num(o.t_iso), t_sh: num(o.t_sh), t_split: num(o.t_split), leaky: files(o.leaky) });
    if (isolate) Object.assign(rec, { isolate, reasons: o.reason ? [o.reason] : [] });
  } else {
    const rerun = files(o.rerun);
    const isolated = isolate
      ? isolate.filter((f) => !rerun.includes(f)).length
      : files(o.leaky).length - files(o.new).length;
    Object.assign(rec, { isolated, rerun: rerun.length, new_leaky: files(o.new), leaky: files(o.leaky) });
    if (o.mode_after) rec.mode_after = o.mode_after;
  }
  fs.appendFileSync(jsonl, JSON.stringify(rec) + '\n');
} else {
  process.stderr.write('usage: learning.cjs cli|harness ... (see the header)\n');
  process.exit(2);
}
