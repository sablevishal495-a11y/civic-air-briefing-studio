'use strict';

/** Lint rules for the whole project. Run with: npm run lint */
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly', fetch: 'readonly',
  FileReader: 'readonly', Blob: 'readonly', URL: 'readonly', setTimeout: 'readonly', self: 'readonly', module: 'readonly', CustomEvent: 'readonly',
};
const nodeGlobals = {
  require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly', Buffer: 'readonly', __dirname: 'readonly',
  URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly',
};
const rules = {
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-arrow-callback': 'error',
  'prefer-template': 'error',
  'object-shorthand': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-unused-vars': ['error', { caughtErrors: 'none' }],
  'no-undef': 'error',
  'no-shadow': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  curly: ['error', 'multi-line'],
};

module.exports = [
  { files: ['server.js', 'src/**/*.js', 'test/**/*.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals }, rules },
  { files: ['public/**/*.js'], ignores: ['public/samples.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals }, rules },
  { files: ['public/samples.js'], languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: browserGlobals }, rules },
];
