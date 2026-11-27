import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Images are only read by src/artists/images.ts, one at a time, which nothing else may bypass, but tests.
  {
    files: ['**/*.ts'],
    ignores: ['src/artists/images.ts', '**/*.test.ts', '**/test-*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'sharp', message: 'Images are read by src/artists/images.ts, one at a time.' }],
          patterns: [{ group: ['sharp/*'], message: 'Images are read by src/artists/images.ts, one at a time.' }],
        },
      ],
    },
  },
])
