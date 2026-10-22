// A Vitest (>= 3) reporter that writes each Vitest run's per-test results
// to its own file in FAST_CAPTURE_DIR, in the shape of Vitest's JSON
// reporter (testResults[].name/status/assertionResults[].fullName/status,
// same names and status mapping), plus the run's fast-mode settings and
// wall time. trace-corpus.mjs --fast-cli adds it to `warpdom vitest run`,
// which starts several Vitest runs (learning, safety-net reruns) and keeps
// only its own temporary JSON report.
import fs from 'node:fs';
import path from 'node:path';

const StatusMap = {
  fail: 'failed',
  only: 'pending',
  pass: 'passed',
  run: 'pending',
  skip: 'skipped',
  todo: 'todo',
  queued: 'pending',
};

function tests(task) {
  return task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(tests);
}

export default class CaptureReporter {
  onInit() {
    this.start = Date.now();
  }

  onTestRunEnd(testModules) {
    const dir = process.env.FAST_CAPTURE_DIR;
    if (!dir) return;
    const testResults = testModules.map((m) => {
      const file = m.task;
      const ts = tests(file);
      const assertionResults = ts.map((t) => {
        const ancestors = [];
        for (let s = t.suite; s; s = s.suite) ancestors.push(s.name);
        ancestors.reverse();
        return {
          fullName: t.name ? [...ancestors, t.name].join(' ') : ancestors.join(' '),
          status: StatusMap[t.result?.state || t.mode] || 'skipped',
        };
      });
      const failed = file.result?.state === 'fail' || ts.some((t) => t.result?.state === 'fail');
      return { name: file.filepath, status: failed ? 'failed' : 'passed', assertionResults };
    });
    fs.mkdirSync(dir, { recursive: true });
    const run = {
      mode: process.env.WARPDOM_FAST_MODE ?? null,
      rerun: process.env.WARPDOM_FAST_RERUN === '1',
      isolate: process.env.WARPDOM_FAST_ISOLATE ?? null,
      started: this.start,
      ended: Date.now(),
      testResults,
    };
    fs.writeFileSync(path.join(dir, `${Date.now()}-${process.pid}.json`), JSON.stringify(run));
  }
}
