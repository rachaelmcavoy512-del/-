import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：React 插件、开发端口 5173、/api 代理到后端 3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
