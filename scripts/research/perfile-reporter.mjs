// A Vitest reporter that appends one JSON line per test file to the file
// named by PERFILE_OUT: where the file's time went (environment setup,
// prepare, collect = importing the test file, setup files, tests), in ms.
// Read with perfile.cjs. Add it next to the run's other reporters:
//
//   PERFILE_OUT=out.jsonl vitest run --reporter=default --reporter=<this file>
//
// Vitest 2 calls onFinished(files) with tasks; Vitest 3 and later call
// onTestRunEnd(testModules) with diagnostics.
import fs from 'node:fs';

const out = process.env.PERFILE_OUT;
const write = (rows) => {
  if (out && rows.length) fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

export default class PerFileReporter {
  onTestRunEnd(modules) {
    this.done = true;
    write(modules.map((m) => {
      const d = m.diagnostic();
      return {
        file: m.moduleId, environment: d.environmentSetupDuration, prepare: d.prepareDuration,
        collect: d.collectDuration, setup: d.setupDuration, tests: d.duration,
      };
    }));
  }

  onFinished(files = []) {
    if (this.done) return;
    write(files.map((f) => ({
      file: f.filepath, environment: f.environmentLoad, prepare: f.prepareDuration,
      collect: f.collectDuration, setup: f.setupDuration, tests: f.result?.duration,
    })));
  }
}
