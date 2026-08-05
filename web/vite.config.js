import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 开发时把 /api 代理到后端（默认 3000）
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    // 关闭自动清空输出目录：避免构建时对 dist 调用 fs.rmSync（部分环境下被安全删除包装拦截导致构建失败）；
    // 旧哈希产物会残留但不会被引用，不影响运行。如需彻底清理可手动删除 dist 后重建。
    emptyOutDir: false,
    chunkSizeWarningLimit: 1200
  }
});
