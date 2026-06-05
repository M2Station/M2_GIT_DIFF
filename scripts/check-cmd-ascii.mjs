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
 * Guards against the cmd.exe multi-byte parsing bug.
 *
 * cmd.exe seeks through a .cmd/.bat file by byte offset. When such a file
 * contains multi-byte (non-ASCII, e.g. 中文) characters, those offsets desync
 * and cmd.exe splits commands mid-token (e.g. "ExecutionPolicy" -> "ionPolicy"),
 * silently breaking the script. The fix is to keep every .cmd/.bat file pure
 * ASCII and move any localized text / real logic into a .ps1 the wrapper calls.
 *
 * This check fails (exit 1) if any tracked .cmd/.bat file contains a byte >=
 * 0x80, reporting the exact line/column so it can be fixed.
 *
 *   node scripts/check-cmd-ascii.mjs            # check all tracked .cmd/.bat
 *   node scripts/check-cmd-ascii.mjs start.cmd  # check only the given files
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const EXTENSIONS = ['.cmd', '.bat'];
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

// Locate every non-ASCII byte and translate its offset into line/column so the
// report points the author straight at the offending character.
function findNonAscii(buf) {
  const hits = [];
  let line = 1;
  let col = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0a) {
      line++;
      col = 1;
      continue;
    }
    if (b >= 0x80) {
      hits.push({ line, col, byte: b });
    }
    if (b !== 0x0d) col++;
  }
  return hits;
}

// Files may be passed as CLI args (e.g. only changed files in CI). Falling back
// to every tracked file keeps a manual run exhaustive.
const argFiles = process.argv.slice(2).map((a) => a.replace(/\\/g, '/'));
const source = argFiles.length > 0 ? argFiles : listTrackedFiles();
const files = source.filter(isCheckable);

if (files.length === 0) {
  console.log('\u2705 cmd ASCII check: no applicable .cmd/.bat files to verify.');
  process.exit(0);
}

const offenders = [];
for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue;
  }
  const hits = findNonAscii(buf);
  if (hits.length > 0) offenders.push({ file: f, hits });
}

if (offenders.length > 0) {
  console.error(
    `\u274c cmd ASCII check failed. ${offenders.length} batch file(s) contain non-ASCII bytes,\n` +
      '   which cmd.exe parses incorrectly (it splits commands mid-token and the\n' +
      '   script silently breaks). Keep .cmd/.bat pure ASCII; move localized text\n' +
      '   and real logic into a .ps1 that the .cmd wraps.\n'
  );
  for (const { file, hits } of offenders) {
    const first = hits[0];
    console.error(
      `  - ${file}  (${hits.length} non-ASCII byte(s); first at line ${first.line}, col ${first.col})`
    );
  }
  process.exit(1);
}

console.log(`\u2705 cmd ASCII check passed (${files.length} batch file(s) verified).`);
