// ESLint flat config cho toàn monorepo (api + web + packages).
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.*',
      '.claude/**',
      '.superpowers/**',
      'apps/api/prisma/**',
      'apps/web/scripts/**',
      'apps/api/scripts/**',
    ],
  },
  // Chỉ lint code TypeScript; file .mjs/.js (script) nằm ngoài tầm của type-aware lint.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Bật dần: mức "recommended" trước, "strict" sau khi nợ cũ được trả.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Hạ 'warn' tạm vì các nhánh song song còn đang sửa import; nâng lại 'error' sau khi gộp
      // (xem docs/superpowers/plans/lint-debt.md).
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tirapro/shared'],
              importNames: ['IssueStatusCategory'],
              message: 'Enum nhập từ @tirapro/types',
            },
          ],
        },
      ],
    },
  },
  {
    // Nợ "any lan truyền": phản hồi axios/JSON chưa có kiểu → cả họ rule no-unsafe-* kêu.
    // Hạ 'warn' (không tắt) để trả dần theo từng module; số lượng ghi ở lint-debt.md.
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // NestJS dùng decorator + DI: nới vài rule gây nhiễu.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
