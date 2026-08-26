import eslint from '@eslint/js';
import globals from 'globals';
import vue from 'eslint-plugin-vue';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', 'server/data/**', 'server/captures/**'] },
  { linterOptions: { reportUnusedDisableDirectives: false } },
  eslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['server/**/*.{js,mjs}', 'tools/**/*.{js,mjs}', '*.{js,mjs}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['server/test/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.nodeBuiltin } }
  },
  {
    files: ['web/src/**/*.{js,vue}', 'web/test/**/*.js', 'web/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.vitest }
    }
  },
  {
    files: ['tools/cookie-grabber.user.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        GM_cookie: 'readonly',
        GM_xmlhttpRequest: 'readonly',
        __SERVER__: 'readonly',
        __TOKEN__: 'readonly'
      }
    }
  },
  {
    rules: {
      // 现有代码存在少量刻意保留的 catch/兼容参数；保持为警告，避免 lint
      // 因非功能性存量问题阻断发布，同时持续把新增问题显示出来。
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // ESLint 10 新增的控制流/错误风格规则先作为渐进治理项；项目当前
      // 仍支持兼容性赋值和面向用户重新包装错误，不能让存量风格阻断 CI。
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'off',
      'no-self-assign': 'warn',
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    files: ['server/test/**/*.js', 'web/test/**/*.js'],
    rules: { 'no-unused-vars': 'off', 'no-useless-assignment': 'off' }
  }
];
