/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
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
    // The renderer only ever runs inside Electron's bundled Chromium, so emit
    // modern JS directly instead of down-levelling for legacy browsers. This
    // yields a smaller, faster bundle and a quicker build.
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true
  }
});
