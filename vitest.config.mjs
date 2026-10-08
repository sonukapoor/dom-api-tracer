// Used by test/verify.mjs. Environment and output dir are set per run.
export default {
  test: {
    include: ['test/fixtures/vitest/**/*.test.mjs'],
    setupFiles: ['./src/vitest-setup.mjs'],
  },
};
