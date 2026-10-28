import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.SF_PORT ?? 5180}`;

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    // Spark ships its own WASM; pre-bundling it breaks the URL to the .wasm file.
    exclude: ['@sparkjsdev/spark'],
  },
});
