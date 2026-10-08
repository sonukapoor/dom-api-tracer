// Used by test/verify.mjs.
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/test/fixtures/jest/**/*.test.cjs'],
  setupFilesAfterEnv: ['<rootDir>/src/jest-setup.cjs'],
};
