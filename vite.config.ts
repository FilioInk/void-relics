import { defineConfig } from 'vite';

// Relative base so the same build works at https://<owner>.github.io/<repo>/ and locally.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
