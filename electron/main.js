/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const git = require('./git');
const db = require('./db');
const fsdialog = require('./fsdialog');

const isDev = process.env.NODE_ENV === 'development';

const APP_NAME = 'M2_GIT_DIFF';
// Window title shows the app version (read from package.json via Electron).
const APP_TITLE = `${APP_NAME} v${app.getVersion()}`;

let mainWindow = null;

// Parse `-L <path>` / `-R <path>` (also --left / --right) from the launch
// argv so repros can be auto-opened. Relative paths resolve against the
// directory the app was launched from. Returns { left, right }.
function parseRepoArgs(argv) {
  const out = { left: null, right: null };
  // In dev the args follow the "." entry (electron . -L x -R y); in a packaged
  // build they follow the exe. Scanning the whole argv works for both.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let key = null;
    if (a === '-L' || a === '--left') key = 'left';
    else if (a === '-R' || a === '--right') key = 'right';
    else if (a.startsWith('--left=')) { out.left = a.slice(7); continue; }
    else if (a.startsWith('--right=')) { out.right = a.slice(8); continue; }
    if (key) {
      const val = argv[i + 1];
      if (val && !val.startsWith('-')) {
        out[key] = val;
        i++;
      }
    }
  }
  const resolve = (p) => (p ? path.resolve(process.cwd(), p) : null);
  // Fall back to env vars (REPRO_L / REPRO_R) when not given on argv. This is
  // how start.cmd forwards paths in dev mode, where argv can't reliably pass
  // through the concurrently -> wait-on -> electron chain.
  return {
    left: resolve(out.left ?? process.env.REPRO_L ?? null),
    right: resolve(out.right ?? process.env.REPRO_R ?? null)
  };
}

const initialRepos = parseRepoArgs(process.argv);

// Valid CSS hex color (#rgb, #rrggbb, #rrggbbaa, ...). Shared by the startup
// background reader below and the app:setStartupBg writer further down.
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

// First-paint background used when no cached theme color is available. Matches
// the default theme (low_key) so the very first frame already looks right.
const DEFAULT_STARTUP_BG = '#0a0e14';

// Read the background color the renderer cached on its last run from
// userData/startup.json so a cold start can paint the correct theme color on
// the first frame (dark-theme users never see a white flash). Falls back to the
// default on first launch or any read/parse error -- never throws.
function startupBackground() {
  try {
    const file = path.join(app.getPath('userData'), 'startup.json');
    const bg = JSON.parse(fs.readFileSync(file, 'utf8')).bg;
    if (typeof bg === 'string' && HEX_COLOR.test(bg)) return bg;
  } catch {
    /* no cache yet (first launch) or unreadable/invalid -- use the default */
  }
  return DEFAULT_STARTUP_BG;
}

// Default window geometry, used on first launch or whenever the saved state is
// missing / unusable. Electron centers a window with no explicit x/y.
const DEFAULT_WINDOW = { width: 1480, height: 920 };
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;

// True when the rectangle overlaps the work area of ANY connected display, so a
// restored window is at least partially on-screen (and thus draggable). Guards
// against reopening on a monitor that has since been disconnected.
function isVisibleOnSomeDisplay(x, y, width, height) {
  try {
    return screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return (
        x < wa.x + wa.width &&
        x + width > wa.x &&
        y < wa.y + wa.height &&
        y + height > wa.y
      );
    });
  } catch {
    return false;
  }
}

// Read the window bounds + maximized flag saved on the last run
// (userData/window-state.json) so the window reopens where the user left it.
// Falls back to the default size (Electron-centered) on first launch, any
// read/parse error, or when the saved position is no longer on a connected
// display. Never throws. Must be called after `app` is ready (uses `screen`).
function readWindowState() {
  const fallback = { ...DEFAULT_WINDOW, isMaximized: false };
  try {
    const file = path.join(app.getPath('userData'), 'window-state.json');
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const width = Math.max(MIN_WINDOW_WIDTH, Math.round(s.width) || DEFAULT_WINDOW.width);
    const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(s.height) || DEFAULT_WINDOW.height);
    const state = { width, height, isMaximized: !!s.isMaximized };
    // Only restore an explicit position when it's still visible somewhere, so a
    // window saved on a since-removed monitor doesn't open off-screen.
    if (
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      isVisibleOnSomeDisplay(s.x, s.y, width, height)
    ) {
      state.x = Math.round(s.x);
      state.y = Math.round(s.y);
    }
    return state;
  } catch {
    return fallback;
  }
}

// Persist the window's geometry + maximized flag to userData/window-state.json.
// Saves the NORMAL (restored) bounds even while maximized so un-maximizing after
// a restart returns to a sane size. Best-effort: a failed write just means the
// next launch uses the last good state (or the default). Never throws.
function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    const state = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized: win.isMaximized()
    };
    const file = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* best-effort: keep the previous saved state */
  }
}

function createWindow() {
  const ws = readWindowState();
  mainWindow = new BrowserWindow({
    width: ws.width,
    height: ws.height,
    // Restore the saved position when present; otherwise let Electron center it.
    ...(ws.x != null && ws.y != null ? { x: ws.x, y: ws.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    // Paint the last-known theme color on the first frame (from the renderer's
    // cache) instead of a fixed dark value, so the window shows the right
    // backdrop the instant it appears.
    backgroundColor: startupBackground(),
    title: APP_TITLE,
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    // Show the window the moment it's created instead of waiting for the
    // renderer's first paint (`ready-to-show`). The window appears immediately
    // with the correct theme backgroundColor; the React content fills in a beat
    // later. This trades a brief empty (but correctly colored) frame for a much
    // faster time-to-window.
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Restore the maximized state after construction; the bounds above hold the
  // normal size so a later un-maximize returns to it.
  if (ws.isMaximized) mainWindow.maximize();

  // The bundled page ships its own <title>; keep the versioned window title by
  // overriding the page-driven update.
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    if (mainWindow) mainWindow.setTitle(APP_TITLE);
  });

  // Persist the window geometry so the next launch reopens where the user left
  // it. resize/move fire rapidly while dragging, so the disk write is debounced;
  // a final synchronous save on `close` captures the very last state.
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('maximize', scheduleSave);
  mainWindow.on('unmaximize', scheduleSave);
  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(mainWindow);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  if (process.platform === 'win32') app.setAppUserModelId('com.tool.gitreprodiff');
  // Create the window first so the renderer starts loading right away, then
  // initialise the cache DB (loading the native better-sqlite3 module is a
  // synchronous, blocking step). The cache is only read once the user opens a
  // repo, which is well after first paint, so this ordering shaves the DB
  // startup cost off the time-to-window.
  createWindow();
  db.init(app.getPath('userData'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers ----

ipcMain.handle('app:getInitialRepos', () => initialRepos);

// Persist the renderer's current theme background to userData/startup.json so
// the next cold start can paint the correct color on its first frame (read by
// startupBackground above). Validates the value is a hex color before writing
// and never throws -- a rejected or failed write just means the next launch
// falls back to the default background.
ipcMain.handle('app:setStartupBg', (_evt, color) => {
  try {
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) return false;
    const file = path.join(app.getPath('userData'), 'startup.json');
    fs.writeFileSync(file, JSON.stringify({ bg: color }));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('dialog:pickFolder', async (_evt, opts) => {
  const dialogOpts = {
    properties: ['openDirectory'],
    title: 'Select a local git repository'
  };
  // Open the native picker at a caller-supplied directory (e.g. the repo's own
  // folder) so worktree-parent / mirror selection starts next to the repo
  // instead of a default location. Electron ignores a blank/missing path.
  const startAt = opts && typeof opts.defaultPath === 'string' ? opts.defaultPath.trim() : '';
  if (startAt) dialogOpts.defaultPath = startAt;
  const result = await dialog.showOpenDialog(mainWindow, dialogOpts);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- In-app keyboard folder picker ----

const LAST_DIR_KEY = 'lastPickerDir';

// Pick a smart default start folder for the picker's first open: the folder
// where the user opens repos most (and most recently), then one level up from
// the last-used location, finally the home directory.
function smartStartDir() {
  const tops = db.getTopRepoParents(5);
  const best = tops.find((t) => t.path && existsSafe(t.path));
  if (best) return best.path;
  const last = db.getSetting(LAST_DIR_KEY);
  if (last && last !== fsdialog.DRIVES && existsSafe(last)) {
    const up = path.dirname(last);
    return up && up !== last ? up : last;
  }
  return os.homedir();
}

function existsSafe(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

// List the directories under `dirPath`, flagging git repos. When no path is
// given (first open) it starts at the smartest learned location (see
// smartStartDir), so the user lands ready to pick a repo.
ipcMain.handle('dialog:listDir', async (_evt, payload) => {
  const requested = payload && payload.path;
  let target = requested;
  if (!target) target = smartStartDir();
  try {
    return { ok: true, ...(await fsdialog.listDir(target)) };
  } catch (err) {
    // Fall back to home if the remembered/target path is gone or unreadable.
    if (!requested) {
      try {
        return { ok: true, ...(await fsdialog.listDir(os.homedir())) };
      } catch {
        /* ignore — report the original error below */
      }
    }
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Remember the directory the user last browsed to so the picker reopens there.
ipcMain.handle('dialog:rememberDir', async (_evt, payload) => {
  const dir = payload && payload.path;
  if (typeof dir === 'string' && dir && dir !== fsdialog.DRIVES) {
    db.setSetting(LAST_DIR_KEY, dir);
  }
  return { ok: true };
});

ipcMain.handle('repo:load', async (_evt, payload) => {
  const { repoPath, branch, limit } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');

  if (!git.isGitRepo(repoPath)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const lim = Number.isFinite(limit) ? limit : 2000;
  const head = await safeHead(repoPath);
  const key = db.cacheKey(repoPath, branch, lim);

  const cached = db.get(key, head);
  if (cached) {
    return { ...cached, cached: true };
  }

  const repo = await git.loadRepo(repoPath, { branch, limit: lim });
  db.set(key, repo.head, repo);
  return { ...repo, cached: false };
});

// Page in the next batch of older commits for a truncated repo window. Kept
// out of the cache (it's a cheap, bounded `git log --skip`) so pagination never
// pollutes the per-head load cache.
ipcMain.handle('repo:loadMore', async (_evt, payload) => {
  const { repoPath, branch, skip, batch, since } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  if (!git.isGitRepo(repoPath)) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
  return git.loadMoreCommits(repoPath, { branch, skip, batch, since });
});

// Record an opened repo so the picker can learn frequent folders and recents.
// Called explicitly by the renderer when the user picks a repo, so automatic
// reloads/branch-switches don't inflate the counts.
ipcMain.handle('picker:recordOpen', async (_evt, payload) => {
  const repoPath = payload && payload.repoPath;
  if (typeof repoPath === 'string' && repoPath) {
    db.recordRepoOpen(repoPath, path.dirname(repoPath));
  }
  return { ok: true };
});

// Top "frequent folders" shortcuts: existing parent dirs ranked by learned use.
ipcMain.handle('picker:topParents', async (_evt, payload) => {
  const n = (payload && Number(payload.n)) || 5;
  return db
    .getTopRepoParents(n * 2)
    .filter((t) => existsSafe(t.path))
    .slice(0, n)
    .map((t) => ({ path: t.path, name: path.basename(t.path) || t.path, count: t.count }));
});

// Recently opened repos that still exist on disk, newest first.
ipcMain.handle('picker:recentRepos', async (_evt, payload) => {
  const n = (payload && Number(payload.n)) || 5;
  return db
    .getRecentRepos(n * 2)
    .filter((r) => r && existsSafe(r.path) && git.isGitRepo(r.path))
    .slice(0, n)
    .map((r) => ({
      path: r.path,
      name: path.basename(r.path) || r.path,
      parent: path.dirname(r.path),
      last: r.last
    }));
});

ipcMain.handle('repo:patchIds', async (_evt, payload) => {
  const { repoPath, shas } = payload || {};
  if (!repoPath || !Array.isArray(shas) || shas.length === 0) return {};
  if (!git.isGitRepo(repoPath)) return {};
  // git.getPatchIds returns a Map; convert to a plain object so it survives
  // IPC serialization.
  const map = await git.getPatchIds(repoPath, shas);
  return Object.fromEntries(map);
});

ipcMain.handle('repo:diffTexts', async (_evt, payload) => {
  const { repoPath, shas } = payload || {};
  if (!repoPath || !Array.isArray(shas) || shas.length === 0) return {};
  if (!git.isGitRepo(repoPath)) return {};
  // git.getDiffTexts returns a Map<sha, string[]>; convert to a plain object so
  // it survives IPC serialization.
  const map = await git.getDiffTexts(repoPath, shas);
  return Object.fromEntries(map);
});

ipcMain.handle('repo:commitDiff', async (_evt, payload) => {
  const { repoPath, sha } = payload || {};
  if (!repoPath || !sha) return '';
  if (!git.isGitRepo(repoPath)) return '';
  // Returns the raw unified-diff text the commit introduced (or '' on failure).
  return git.getCommitDiff(repoPath, sha);
});

ipcMain.handle('repo:gitOp', async (_evt, payload) => {
  const { repoPath, op } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.gitOp(repoPath, op);
});

ipcMain.handle('repo:listBranches', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.listBranches(repoPath);
});

ipcMain.handle('repo:switchBranch', async (_evt, payload) => {
  const { repoPath, branch, isRemote } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.switchBranch(repoPath, branch, !!isRemote);
});

ipcMain.handle('repo:updateAllBranches', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.updateAllBranches(repoPath);
});

ipcMain.handle('repo:addWorktree', async (_evt, payload) => {
  const { repoPath, parentDir, name, ref, newBranch } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.addWorktree(repoPath, { parentDir, name, ref, newBranch });
});

ipcMain.handle('repo:createMirror', async (evt, payload) => {
  const { repoPath, parentDir, streamId } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.createMirror(repoPath, parentDir, onData);
});

ipcMain.handle('repo:updateWorktreeSubmodules', async (evt, payload) => {
  const { worktreePath, mainRepoPath, streamId } = payload || {};
  if (!worktreePath) throw new Error('worktreePath is required');
  if (!mainRepoPath) throw new Error('mainRepoPath is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.updateWorktreeSubmodules(worktreePath, mainRepoPath, onData);
});

ipcMain.handle('repo:mergeWorktreeMain', async (evt, payload) => {
  const { worktreePath, source, streamId } = payload || {};
  if (!worktreePath) throw new Error('worktreePath is required');
  if (!source) throw new Error('source is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.mergeMainIntoWorktree(worktreePath, source, onData);
});

ipcMain.handle('repo:setWorktreeBranch', async (_evt, payload) => {
  const { worktreePath, branch } = payload || {};
  if (!worktreePath) throw new Error('worktreePath is required');
  if (!branch) throw new Error('branch is required');
  return git.setWorktreeBranch(worktreePath, branch);
});

ipcMain.handle('repo:buildSubmoduleMirrorCache', async (evt, payload) => {
  const { mainRepoPath, cacheRoot, streamId } = payload || {};
  if (!mainRepoPath) throw new Error('mainRepoPath is required');
  if (!cacheRoot) throw new Error('cacheRoot is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.buildSubmoduleMirrorCache(mainRepoPath, cacheRoot, onData);
});

ipcMain.handle('repo:getMirrorCache', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.getMirrorCache(repoPath);
});

ipcMain.handle('repo:getMirrorCacheInfo', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.getMirrorCacheInfo(repoPath);
});

ipcMain.handle('repo:updateMirrorCache', async (evt, payload) => {
  const { mainRepoPath, streamId } = payload || {};
  if (!mainRepoPath) throw new Error('mainRepoPath is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.updateMirrorCache(mainRepoPath, onData);
});

ipcMain.handle('repo:listWorktrees', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.listWorktrees(repoPath);
});

ipcMain.handle('repo:removeWorktree', async (_evt, payload) => {
  const { repoPath, worktreePath, force } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.removeWorktree(repoPath, worktreePath, force !== false);
});

ipcMain.handle('repo:pruneWorktrees', async (_evt, payload) => {
  const { repoPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  return git.pruneWorktrees(repoPath);
});

// Export the aligned diff (with notes, forced colors, and manual links) to a
// styled .xlsx via a save dialog. Returns { ok, path } or { canceled: true }.
ipcMain.handle('excel:export', async (_evt, payload) => {
  const data = payload || {};
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export diff to Excel',
    defaultPath: (data.defaultName || 'git-diff') + '.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const excel = require('./excel');
  const fs = require('node:fs');
  const buf = await excel.buildWorkbook(data);
  await fs.promises.writeFile(result.filePath, buf);
  return { ok: true, path: result.filePath };
});

// Export a shareable Markdown review report using the same aligned rows as the
// Excel export. The report is table-heavy so it can be pasted into PRs, issues,
// Teams, or archived beside review notes without requiring Excel.
ipcMain.handle('markdown:export', async (_evt, payload) => {
  const data = payload || {};
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export review report to Markdown',
    defaultPath: (data.defaultName || 'git-diff-review') + '.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const markdown = require('./markdownReport');
  const text = markdown.buildMarkdown(data);
  await fs.promises.writeFile(result.filePath, text, 'utf8');
  return { ok: true, path: result.filePath };
});

// Export a single commit as a .patch file (git format-patch) the user can
// import into another repo. The patch text is produced in the source repo,
// then written to a location the user picks.
ipcMain.handle('commit:exportPatch', async (_evt, payload) => {
  const { repoPath, sha, defaultName } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  if (!sha) throw new Error('sha is required');
  const patch = await git.exportCommitPatch(repoPath, sha);
  const fs = require('node:fs');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export commit as patch',
    defaultPath: (defaultName || String(sha).slice(0, 12)) + '.patch',
    filters: [{ name: 'Patch', extensions: ['patch', 'diff'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.promises.writeFile(result.filePath, patch, 'utf8');
  return { ok: true, path: result.filePath };
});

// Let the user pick a .patch file to import.
ipcMain.handle('patch:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a patch to import',
    properties: ['openFile'],
    filters: [
      { name: 'Patch', extensions: ['patch', 'diff'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) return { canceled: true };
  return { path: result.filePaths[0] };
});

// Inspect a patch against a repo (content + diffstat + conflict check) without
// applying it, so the renderer can preview and warn before Apply.
ipcMain.handle('patch:inspect', async (_evt, payload) => {
  const { repoPath, patchPath } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  if (!patchPath) throw new Error('patchPath is required');
  return git.inspectPatch(repoPath, patchPath);
});

// Apply a patch to the repo's working tree only (no commit).
ipcMain.handle('patch:apply', async (evt, payload) => {
  const { repoPath, patchPath, streamId } = payload || {};
  if (!repoPath) throw new Error('repoPath is required');
  if (!patchPath) throw new Error('patchPath is required');
  const onData = streamId
    ? (chunk) => {
        try { evt.sender.send('repo:gitProgress', { streamId, chunk }); } catch { /* window gone */ }
      }
    : null;
  return git.applyPatch(repoPath, patchPath, onData);
});

// Open an external URL in the user's default browser. Only http(s) URLs are
// allowed so the renderer can never launch arbitrary protocols / executables.
ipcMain.handle('shell:openExternal', async (_evt, url) => {
  if (typeof url !== 'string') throw new Error('url is required');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('invalid url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('unsupported protocol');
  }
  await shell.openExternal(parsed.href);
  return { ok: true };
});

// Open an existing local directory in the OS file manager. Restricted to
// directories so the renderer can never launch a file / executable via its
// default handler.
ipcMain.handle('shell:openPath', async (_evt, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath) throw new Error('path is required');
  let stat;
  try {
    stat = await fs.promises.stat(targetPath);
  } catch {
    throw new Error('path does not exist');
  }
  if (!stat.isDirectory()) throw new Error('path is not a directory');
  const err = await shell.openPath(targetPath);
  return { ok: !err, error: err || '' };
});

// Launch the OS process manager so the user can end whatever is holding a
// worktree folder (surfaced when a worktree removal fails with a lock). Windows
// only — Task Manager; resolves ok:false elsewhere so the UI can stay generic.
ipcMain.handle('shell:openTaskManager', async () => {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'unsupported platform' };
  }
  try {
    const { spawn } = require('node:child_process');
    const child = spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

// Resolve the VS Code launcher once. On Windows the `code` shim is `code.cmd`;
// `where` returns its full path. Returns null when VS Code is not installed /
// not on PATH so callers can surface a friendly message.
let _codeCmd;
function resolveCodeCommand() {
  if (_codeCmd !== undefined) return _codeCmd;
  try {
    const { execFileSync } = require('node:child_process');
    if (process.platform === 'win32') {
      const out = execFileSync('where', ['code.cmd'], { windowsHide: true })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      _codeCmd = out || null;
    } else {
      execFileSync('which', ['code'], { windowsHide: true });
      _codeCmd = 'code';
    }
  } catch {
    _codeCmd = null;
  }
  return _codeCmd;
}

// Build an English context document for a commit: metadata followed by the
// full `git show` diff. Kept in English so it survives any encoding quirks and
// reads naturally to the chat model. The diff is captured with a generous
// buffer so large commits aren't truncated.
function buildCommitChatContext(repoPath, commit) {
  const lines = [
    `# Commit ${commit.short || commit.sha} - ${commit.subject || ''}`,
    '',
    'Context for the assistant: the section below is a Git commit (metadata +',
    'full diff) the user wants to discuss. Wait for the user to type their',
    'question in the chat input before responding.',
    '',
    `Repo: ${repoPath || '(unknown)'}`,
    `Commit: ${commit.sha}`,
    `Author: ${commit.author || ''}${commit.authorEmail ? ` <${commit.authorEmail}>` : ''}`,
    `Date: ${commit.authorDate || ''}`,
    `Subject: ${commit.subject || ''}`,
    '',
    'Commit message:',
    commit.body || '(no body)',
    '',
    '---',
    '',
    '## Full diff (`git show --no-color`)',
    ''
  ];
  let diff = '';
  if (repoPath && fs.existsSync(repoPath)) {
    try {
      const { execFileSync } = require('node:child_process');
      diff = execFileSync('git', ['show', '--no-color', commit.sha], {
        cwd: repoPath,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024
      }).toString();
    } catch (e) {
      diff = `(failed to read diff: ${e.message})`;
    }
  } else {
    diff = '(repo path unavailable; run `git show ' + commit.sha + '` locally)';
  }
  return lines.join('\n') + '\n```diff\n' + diff + '\n```\n';
}

// Remove our own stale chat context temp files. `code chat --add-file` reads
// the file lazily — only when the user submits their first message — so we must
// NOT delete it right after spawn. Instead we sweep files older than 6 hours on
// each launch, which is long enough for any realistic chat session.
function sweepStaleChatTemps() {
  const dir = os.tmpdir();
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!/^m2gd-chat-[0-9a-f]+\.txt$/i.test(name)) continue;
    const full = path.join(dir, name);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* best-effort */
    }
  }
}

// Open the commit in a NEW VS Code chat session, preloaded with the commit
// context as an attached file, and WAIT for the user to type their own prompt.
// `code chat -n --add-file <file>` (with no prompt argument) opens a fresh
// session with the file attached and an empty input box — passing a prompt
// instead would auto-submit immediately, which is not what we want here.
// Every command-line token is constant/whitelisted or our crypto-generated temp
// path, so there is no shell-injection surface despite shell:true (needed to
// launch the `code.cmd` batch shim on Windows).
ipcMain.handle('vscode:chat', async (_evt, payload) => {
  const { repoPath, commit, mode } = payload || {};
  if (!commit || typeof commit !== 'object' || !commit.sha) {
    throw new Error('commit is required');
  }

  const codeCmd = resolveCodeCommand();
  if (!codeCmd) {
    // Sentinel the renderer maps to a friendly "VS Code not installed" message.
    const err = new Error('VSCODE_NOT_FOUND');
    err.code = 'VSCODE_NOT_FOUND';
    throw err;
  }

  const { spawn } = require('node:child_process');
  const crypto = require('node:crypto');
  const chatMode = ['ask', 'edit', 'agent'].includes(mode) ? mode : 'agent';
  const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : undefined;

  // Clean up any leftover context files from previous sessions before writing
  // a new one (the new file is read lazily, so it can't be deleted on spawn).
  sweepStaleChatTemps();

  const context = buildCommitChatContext(repoPath, commit);
  const tmpFile = path.join(
    os.tmpdir(),
    `m2gd-chat-${crypto.randomBytes(8).toString('hex')}.txt`
  );
  try {
    fs.writeFileSync(tmpFile, context, 'utf8');
  } catch (e) {
    throw new Error('Failed to prepare chat context: ' + e.message);
  }

  return await new Promise((resolve, reject) => {
    let child;
    try {
      // Constant command string: only the validated chatMode, the trusted
      // resolved code path, and our generated temp path are interpolated —
      // no user content. No prompt argument, so the session waits for the user.
      const cmdLine = `"${codeCmd}" chat -n -m ${chatMode} --add-file "${tmpFile}"`;
      child = spawn(cmdLine, { cwd, windowsHide: true, shell: true });
    } catch (e) {
      reject(new Error('Failed to launch VS Code: ' + e.message));
      return;
    }
    child.on('error', (e) => {
      reject(new Error('Failed to launch VS Code: ' + e.message));
    });
    child.on('spawn', () => {
      resolve({ ok: true });
    });
  });
});

async function safeHead(repoPath) {
  try {
    const { execFileSync } = require('node:child_process');
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      windowsHide: true
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}
