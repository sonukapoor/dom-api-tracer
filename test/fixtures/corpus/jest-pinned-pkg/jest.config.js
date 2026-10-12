// The project runs on node; one file pins jsdom with a docblock comment,
// which the harness must switch like a config environment.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.test.cjs'],
};
