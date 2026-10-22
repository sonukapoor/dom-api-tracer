// Readability rules only; formatting is Prettier's job (npm run format).
export default [
  { ignores: ['test/fixtures/', '.corpus/', '.corpus-env/', 'dom-trace-report/'] },
  {
    files: ['**/*.{js,mjs,cjs}'],
    // Some files carry disable comments for rules this config doesn't enable.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-nested-ternary': 'error',
    },
  },
];
