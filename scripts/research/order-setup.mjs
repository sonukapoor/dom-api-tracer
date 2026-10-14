// A Vitest setup file that records which worker ran which test file, and
// when: one JSON line per test file appended to FILE_ORDER_OUT (nothing
// when it is unset). Vitest runs setup files again before every test file,
// also when files share a worker (--no-isolate), so the lines of one
// worker, in time order, are the order its files ran in: what a file's
// tests could see left behind. g2-shuffle.sh adds it with --first-setup;
// g2-report.cjs reads it (orders).
//
//   { file, worker, main, isolate, project, pool, t }
//     worker   the JavaScript realm: "<pid>" (a forks child) or
//              "<pid>:<threadId>" (a worker thread)
//     main     the Vitest process that started the worker (one per Vitest
//              run; warpdom vitest run may start several)
//     isolate  the worker's isolate setting (false: files share it)
//     pool     VITEST_POOL_ID, the worker slot
//     seq      the file's position in its worker (1, 2, ...; kept on
//              `process`, which a DOM reset between files leaves alone)
//     t        Date.now() when the file's setup started
//
// A setup file listed twice (warpdom's withFastMode merges the setup files
// of the config it wraps, the wrapper's included) runs twice per file:
// the second time for the same file in a row is not recorded.
//
// The file comes from Vitest's worker state (`filepath`, set before each
// file's setup files run since Vitest 1), with `current` as a fallback.
import fs from 'node:fs';
import { threadId } from 'node:worker_threads';

const out = process.env.FILE_ORDER_OUT;
const SEQ = Symbol.for('dom-api-tracer.file-order');
const LAST = Symbol.for('dom-api-tracer.file-order.last');
const state = globalThis.__vitest_worker__ ?? {};
const file = state.filepath ?? state.current?.file?.filepath ?? state.current?.filepath ?? null;
if (out && (file === null || process[LAST] !== file)) {
  process[LAST] = file;
  process[SEQ] = (process[SEQ] ?? 0) + 1;
  const row = {
    file,
    worker: threadId ? `${process.pid}:${threadId}` : String(process.pid),
    main: threadId ? process.pid : process.ppid,
    isolate: state.config?.isolate ?? null,
    project: state.ctx?.projectName ?? state.config?.name ?? null,
    pool: process.env.VITEST_POOL_ID ?? null,
    seq: process[SEQ],
    t: Date.now(),
  };
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
}
