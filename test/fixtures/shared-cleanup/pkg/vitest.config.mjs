// Used by test/verify.mjs: two test files sharing one worker without
// isolation, each checking that it starts clean and then leaving state behind.
// Globals on: Testing Library's automatic cleanup after each test applies.
export default {
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['*.test.mjs'],
  },
};
