// Exported as a function to check that the harness resolves config factories.
export default () => ({
  test: {
    environment: 'jsdom',
    include: ['**/*.test.mjs'],
    setupFiles: ['./setup.mjs'],
  },
});
