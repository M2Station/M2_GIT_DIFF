/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const git = require('./git');
const db = require('./db');
const fsdialog = require('./fsdialog');

const isDev = process.env.NODE_ENV === 'development';

const APP_NAME = 'M2_GIT_DIFF';

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0e14',
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'public', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
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
  db.init(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers ----

ipcMain.handle('app:getInitialRepos', () => initialRepos);

ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select a local git repository'
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- In-app keyboard folder picker ----

const LAST_DIR_KEY = 'lastPickerDir';

// List the directories under `dirPath`, flagging git repos. When no path is
// given (first open) it starts at the last-used location, falling back to the
// user's home directory.
ipcMain.handle('dialog:listDir', async (_evt, payload) => {
  const requested = payload && payload.path;
  let target = requested;
  if (!target) {
    target = db.getSetting(LAST_DIR_KEY) || os.homedir();
  }
  try {
    return { ok: true, ...fsdialog.listDir(target) };
  } catch (err) {
    // Fall back to home if the remembered/target path is gone or unreadable.
    if (!requested) {
      try {
        return { ok: true, ...fsdialog.listDir(os.homedir()) };
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

// Open the locally installed VS Code chat with a prepared prompt. The prompt is
// streamed via stdin (never the command line), and every command-line token is
// constant or whitelisted, so there is no shell-injection surface even though
// shell:true is required to launch the `code.cmd` batch shim.
ipcMain.handle('vscode:chat', async (_evt, payload) => {
  const { repoPath, prompt, mode } = payload || {};
  if (!prompt || typeof prompt !== 'string') throw new Error('prompt is required');

  const codeCmd = resolveCodeCommand();
  if (!codeCmd) {
    // Sentinel the renderer maps to a friendly "VS Code not installed" message.
    const err = new Error('VSCODE_NOT_FOUND');
    err.code = 'VSCODE_NOT_FOUND';
    throw err;
  }

  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const chatMode = ['ask', 'edit', 'agent'].includes(mode) ? mode : 'agent';
  const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : undefined;

  return await new Promise((resolve, reject) => {
    let child;
    try {
      // Constant command string: only the validated chatMode and the trusted
      // resolved code path are interpolated — no user content.
      const cmdLine = `"${codeCmd}" chat -r -m ${chatMode} -`;
      child = spawn(cmdLine, { cwd, windowsHide: true, shell: true });
    } catch (e) {
      reject(new Error('Failed to launch VS Code: ' + e.message));
      return;
    }
    child.on('error', (e) => reject(new Error('Failed to launch VS Code: ' + e.message)));
    child.on('spawn', () => {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
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
