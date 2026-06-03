import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build config. Electron loads from the dev server in development
// and from dist/index.html in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
