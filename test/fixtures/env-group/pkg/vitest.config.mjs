// Used by test/verify.mjs: two test files on the config's environment and
// two pinned to it with a comment. Run without isolation on one worker, they
// share one worker when both resolve to the same environment name.
export default {
  test: {
    environment: 'jsdom',
    include: ['*.test.mjs'],
  },
};
