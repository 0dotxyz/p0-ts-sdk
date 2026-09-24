module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-unresolved': 'off',
    'import/named': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // code_rules.md §2: generated clients are only used through their wrapper module.
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['~/generated/*', '**/generated/*'],
            allowTypeImports: true,
            message:
              'Use the wrapper in src/instructions.ts or src/vendor/<program> instead of the generated client.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['src/instructions.ts', 'src/vendor/**/*.ts'],
      rules: { '@typescript-eslint/no-restricted-imports': 'off' },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.config.ts', '*.config.js', 'src/generated'],
};
