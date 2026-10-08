'use strict';
// Usage: add "dom-api-tracer/jest" as the FIRST entry in setupFilesAfterEnv.
const tracer = require('./tracer.cjs');
const writer = require('./report-writer.cjs');

// Files can opt out of the DOM (`@jest-environment node`): nothing to trace.
if (tracer.hasDom(globalThis)) {
  const registry = tracer.install(globalThis);
  const testPath = expect.getState().testPath;

  afterAll(() => {
    writer.writeFileReport(registry, { testPath, runner: 'jest' });
  });
}
