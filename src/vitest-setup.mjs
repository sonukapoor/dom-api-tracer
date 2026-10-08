// Usage: add "dom-api-tracer/vitest" as the FIRST entry in test.setupFiles.
import { afterAll, expect } from 'vitest';
import tracer from './tracer.cjs';
import writer from './report-writer.cjs';

// Files can opt out of the DOM (`// @vitest-environment node`): nothing to trace.
if (tracer.hasDom(globalThis)) {
  const registry = tracer.install(globalThis);
  const testPath = expect.getState().testPath;

  afterAll(() => {
    writer.writeFileReport(registry, { testPath: testPath || expect.getState().testPath, runner: 'vitest' });
  });
}
