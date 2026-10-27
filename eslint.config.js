import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // Architectural boundaries: the server domain layer must stay free of I/O and frameworks.
    files: ['packages/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/application/**', '**/infrastructure/**'], message: 'Domain must not depend on outer layers.' },
            { group: ['node:*', 'ws'], message: 'Domain code must stay free of I/O.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/server/src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/infrastructure/**'], message: 'Application depends on ports, not adapters.' }] },
      ],
    },
  },
  {
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*', 'three', 'ws'], message: 'Shared code must run in both Node and the browser.' }] },
      ],
    },
  },
);
