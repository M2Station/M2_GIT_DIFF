/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Lightweight caching layer for parsed git logs. Persistence prefers Node's
// built-in SQLite (node:sqlite), which needs no native build toolchain and is
// bundled with modern Electron; it falls back to the better-sqlite3 native
// module when present, and finally to an in-memory cache — so the app always
// works, gaining on-disk persistence whenever any SQLite driver is available.

const path = require('node:path');

let db = null;
let usingSqlite = false;
let sqliteDriver = '';
const memCache = new Map();

// Open the cache database with the first available SQLite driver. node:sqlite is
// preferred (zero native build, always ABI-matched to Electron); better-sqlite3
// is used only when node:sqlite is missing (older runtimes). Both expose the
// same prepare()/get()/run()/exec() surface the rest of this module relies on.
function openDatabase(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(file), driver: 'node:sqlite' };
  } catch {
    /* runtime without node:sqlite — try the optional native module instead */
  }
  const BetterSqlite3 = require('better-sqlite3');
  return { db: new BetterSqlite3(file), driver: 'better-sqlite3' };
}

function init(userDataDir) {
  try {
    const file = path.join(userDataDir, 'repro-diff-cache.sqlite');
    const opened = openDatabase(file);
    db = opened.db;
    sqliteDriver = opened.driver;
    // Run PRAGMA via exec() so it works on both drivers (node:sqlite has no
    // better-sqlite3-style .pragma() helper).
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS repo_cache (
        key TEXT PRIMARY KEY,
        head TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    usingSqlite = true;
    // eslint-disable-next-line no-console
    console.log(`[db] persistent cache enabled via ${sqliteDriver}`);
  } catch (err) {
    usingSqlite = false;
    // eslint-disable-next-line no-console
    console.warn('[db] SQLite unavailable, using in-memory cache:', err.message);
  }
}

// Bump when the cached repo payload shape changes so stale entries written by
// an older build are ignored instead of silently served back without the new
// fields (e.g. `hasMore`, which gates lazy pagination / backfill).
const CACHE_VERSION = 2;

function cacheKey(repoPath, branch, limit) {
  return `v${CACHE_VERSION}::${repoPath}::${branch || 'HEAD'}::${limit}`;
}

function get(key, head) {
  if (usingSqlite && db) {
    const row = db.prepare('SELECT head, payload FROM repo_cache WHERE key = ?').get(key);
    if (row && row.head === head) {
      try {
        return JSON.parse(row.payload);
      } catch {
        return null;
      }
    }
    return null;
  }
  const entry = memCache.get(key);
  if (entry && entry.head === head) return entry.payload;
  return null;
}

function set(key, head, payload) {
  if (usingSqlite && db) {
    db.prepare(
      `INSERT INTO repo_cache (key, head, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET head=excluded.head, payload=excluded.payload, updated_at=excluded.updated_at`
    ).run(key, head, JSON.stringify(payload), Date.now());
    return;
  }
  memCache.set(key, { head, payload });
}

// ---- Generic key/value settings (e.g. last-opened folder) ----

const memSettings = new Map();

function getSetting(key, fallback = null) {
  if (usingSqlite && db) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }
  return memSettings.has(key) ? memSettings.get(key) : fallback;
}

function setSetting(key, value) {
  if (value == null) return;
  if (usingSqlite && db) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run(key, String(value));
    return;
  }
  memSettings.set(key, String(value));
}

// ---- Repo open-history learning (frequency + recents) ----
//
// The folder picker learns where the user keeps their repos so it can offer
// one-click shortcuts and a smart default start location. Two small JSON blobs
// are stored in the generic `settings` table (so they ride the sqlite/in-memory
// fallback for free):
//   repoParentFreq : { [parentDir]: { count, last } }   — how often repos under
//                    each parent folder were opened (for "frequent folders").
//   recentRepos    : [ { path, last } ]  newest-first    — the last repos opened.

const REPO_FREQ_KEY = 'repoParentFreq';
const RECENT_REPOS_KEY = 'recentRepos';
const MAX_RECENT = 12;
const DAY_MS = 86400000;

function readJsonSetting(key, fallback) {
  const raw = getSetting(key, null);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

// Record that a repo was opened: bump its parent-folder frequency and push it
// to the front of the recent list (deduped, capped).
function recordRepoOpen(repoPath, parentDir) {
  if (!repoPath) return;
  const now = Date.now();

  if (parentDir) {
    const freq = readJsonSetting(REPO_FREQ_KEY, {});
    const e = freq[parentDir] || { count: 0, last: 0 };
    e.count = (e.count || 0) + 1;
    e.last = now;
    freq[parentDir] = e;
    setSetting(REPO_FREQ_KEY, JSON.stringify(freq));
  }

  let recents = readJsonSetting(RECENT_REPOS_KEY, []);
  if (!Array.isArray(recents)) recents = [];
  recents = recents.filter((r) => r && r.path && r.path !== repoPath);
  recents.unshift({ path: repoPath, last: now });
  if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);
  setSetting(RECENT_REPOS_KEY, JSON.stringify(recents));
}

// Top parent folders ranked by a time-decayed frequency score, so folders you
// use often *and recently* float up. Returns [{ path, count, last, score }].
function getTopRepoParents(n = 5) {
  const freq = readJsonSetting(REPO_FREQ_KEY, {});
  const now = Date.now();
  const scored = Object.entries(freq).map(([dir, e]) => {
    const count = (e && e.count) || 0;
    const last = (e && e.last) || 0;
    const days = Math.max(0, (now - last) / DAY_MS);
    return { path: dir, count, last, score: count * Math.pow(0.97, days) };
  });
  scored.sort((a, b) => b.score - a.score || b.last - a.last);
  return scored.slice(0, Math.max(0, n));
}

// The most recently opened repos, newest first.
function getRecentRepos(n = 5) {
  const recents = readJsonSetting(RECENT_REPOS_KEY, []);
  if (!Array.isArray(recents)) return [];
  return recents.slice(0, Math.max(0, n));
}

module.exports = {
  init,
  get,
  set,
  cacheKey,
  getSetting,
  setSetting,
  recordRepoOpen,
  getTopRepoParents,
  getRecentRepos,
  isSqlite: () => usingSqlite
};
