/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { defineConfig } from 'vitest/config';

// Unit-test config kept separate from vite.config.js so the test run does not
// pull in the React renderer plugin. The `node` environment is required because
// the git tests shell out to a real `git` binary via node:child_process and the
// diff/markdown logic is plain JS with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/diff.js', 'src/lib/markdown.js', 'electron/git.js'],
      reporter: ['text', 'lcov']
    }
  }
});
