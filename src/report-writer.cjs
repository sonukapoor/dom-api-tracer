'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { snapshot } = require('./tracer.cjs');

const SCHEMA_VERSION = 1;

function outputDir() {
  return path.resolve(process.env.DOM_TRACE_DIR || '.dom-trace');
}

/**
 * Write one JSON report for a finished test file and reset counters so the
 * next file (when environments are shared) starts from zero.
 */
function writeFileReport(registry, { testPath, runner }) {
  const dir = outputDir();
  fs.mkdirSync(dir, { recursive: true });

  const rel = testPath ? path.relative(process.cwd(), testPath) : 'unknown';
  const usage = snapshot(registry, { reset: true });
  const hash = crypto.createHash('sha1').update(`${rel}:${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12);

  const report = {
    schemaVersion: SCHEMA_VERSION,
    // Monorepo packages run from their own directories; DOM_TRACE_PROJECT lets
    // them all report under one project name.
    project: process.env.DOM_TRACE_PROJECT || path.basename(process.cwd()),
    testFile: rel,
    runner,
    environment: registry.environment,
    createdAt: new Date().toISOString(),
    usage,
  };
  fs.writeFileSync(path.join(dir, `run-${hash}.json`), JSON.stringify(report));

  // The catalog (everything that *could* be called) is identical across files
  // for one environment, so write it once per environment.
  const catalogFile = path.join(dir, `catalog-${registry.environment}.json`);
  if (!fs.existsSync(catalogFile)) {
    const catalog = {
      schemaVersion: SCHEMA_VERSION,
      environment: registry.environment,
      members: [...registry.catalog].sort(),
      skipped: registry.skipped,
    };
    try { fs.writeFileSync(catalogFile, JSON.stringify(catalog), { flag: 'wx' }); } catch {}
  }
}

module.exports = { writeFileReport, outputDir };
