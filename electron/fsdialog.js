/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Backend for the in-app keyboard-driven folder picker. Lists the
// subdirectories of a path and flags which ones are git repositories so the
// renderer can colour them and offer a "repos only" filter. A git repo is any
// directory that contains a `.git` entry — this is a folder for a normal repo
// and a file for a submodule / worktree, so existsSync covers both and nested
// submodule repos are detected just like top-level ones.

const fs = require('node:fs');
const path = require('node:path');

// Sentinel path that represents the Windows "This PC" level (the list of
// drive roots) reached by going up from a drive root such as C:\.
const DRIVES = ':drives:';

function isRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

// Probe C: through Z: for existing drive roots (A:/B: are skipped — legacy
// floppy letters that block for seconds when empty).
function listDrives() {
  const drives = [];
  for (let code = 67 /* C */; code <= 90 /* Z */; code++) {
    const root = String.fromCharCode(code) + ':\\';
    try {
      if (fs.existsSync(root)) {
        drives.push({ name: root, path: root, isRepo: false, isDrive: true });
      }
    } catch {
      /* drive not ready / access denied — skip */
    }
  }
  return drives;
}

// List the directories directly under `dirPath`. Returns a descriptor the
// renderer can render and navigate:
//   { path, parent, canGoUp, isRepo, isDriveList, entries[] }
// where each entry is { name, path, isRepo, isDrive? }.
function listDir(dirPath) {
  if (dirPath === DRIVES && process.platform === 'win32') {
    return {
      path: DRIVES,
      parent: null,
      canGoUp: false,
      isRepo: false,
      isDriveList: true,
      entries: listDrives()
    };
  }

  const abs = path.resolve(dirPath);
  const dirents = fs.readdirSync(abs, { withFileTypes: true });

  const entries = [];
  for (const de of dirents) {
    if (de.name === '.git') continue; // never list the repo's own .git
    let isDir = de.isDirectory();
    if (de.isSymbolicLink()) {
      // Follow links so junctions/symlinks to folders still show up.
      try {
        isDir = fs.statSync(path.join(abs, de.name)).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    const full = path.join(abs, de.name);
    entries.push({ name: de.name, path: full, isRepo: isRepo(full) });
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const parent = path.dirname(abs);
  const atRoot = parent === abs; // e.g. C:\ or / — dirname returns itself
  return {
    path: abs,
    // On Windows, going up from a drive root surfaces the drive list; on
    // POSIX the filesystem root has no parent.
    parent: atRoot ? (process.platform === 'win32' ? DRIVES : null) : parent,
    canGoUp: process.platform === 'win32' ? true : !atRoot,
    isRepo: isRepo(abs),
    isDriveList: false,
    entries
  };
}

module.exports = { listDir, isRepo, DRIVES };
