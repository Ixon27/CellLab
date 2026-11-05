import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      // regex key: a plain '/api' prefix would also swallow the module '/api.ts'
      '^/api/': { target: 'http://127.0.0.1:4327', changeOrigin: false },
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
