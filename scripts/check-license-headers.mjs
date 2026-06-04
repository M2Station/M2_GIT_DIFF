#!/usr/bin/env node
/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/*
 * Verifies that every source file carries the MIT SPDX license header.
 * Exits with code 1 (and lists offending files) if any are missing it.
 *
 *   node scripts/check-license-headers.mjs            # check all tracked files
 *   node scripts/check-license-headers.mjs a.js b.css # check only the given files
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const REQUIRED = 'SPDX-License-Identifier: MIT';
const EXTENSIONS = ['.js', '.jsx', '.mjs', '.css', '.ps1'];
const EXCLUDE_DIRS = ['node_modules', 'release', 'build', 'dist', '.git'];

function listTrackedFiles() {
  // Use git so we only check files in the repo (respects .gitignore).
  const out = execSync('git ls-files', { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function isCheckable(f) {
  if (!EXTENSIONS.includes(path.extname(f).toLowerCase())) return false;
  const parts = f.split('/');
  return !parts.some((p) => EXCLUDE_DIRS.includes(p));
}

// Files may be passed as CLI args (e.g. only changed files in CI). Falling back
// to every tracked file keeps a manual `npm run check:license` exhaustive.
const argFiles = process.argv.slice(2).map((a) => a.replace(/\\/g, '/'));
const source = argFiles.length > 0 ? argFiles : listTrackedFiles();
const files = source.filter(isCheckable);

if (files.length === 0) {
  console.log('\u2705 License header check: no applicable files to verify.');
  process.exit(0);
}

const missing = [];
for (const f of files) {
  let content = '';
  try {
    content = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (!content.includes(REQUIRED)) missing.push(f);
}

if (missing.length > 0) {
  console.error(`\u274c License header check failed. ${missing.length} file(s) missing "${REQUIRED}":`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error('\nAdd the MIT header (see LICENSE) to the top of each file listed above.');
  process.exit(1);
}

console.log(`\u2705 License header check passed (${files.length} file(s) verified).`);
