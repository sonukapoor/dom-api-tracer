// Used by test/verify.mjs: two test files sharing one worker without
// isolation, each checking that it starts clean and then leaving state behind.
export default {
  test: {
    environment: 'jsdom',
    include: ['*.test.mjs'],
  },
};
