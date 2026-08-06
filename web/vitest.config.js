import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

// 前端测试 harness（P3）：vitest + jsdom + @vue/test-utils
// - jsdom 提供 localStorage / DOM，使 client.js 的 import.meta.env / localStorage 可用
// - @vitejs/plugin-vue 编译 .vue 单文件组件
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{js,ts}'],
    // 单测不应触发 vite build 的全量类型检查
    css: false
  }
});
