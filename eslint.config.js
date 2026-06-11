import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'convex/_generated', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // node scripts (build-time tooling)
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly', fetch: 'readonly', console: 'readonly' } },
  },
);
