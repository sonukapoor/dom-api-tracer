// Runs in a real browser, which the tracer cannot instrument: must be skipped.
export default {
  test: {
    include: ['**/*.test.mjs'],
    browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }] },
  },
};
