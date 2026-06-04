/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Lightweight caching layer for parsed git logs. better-sqlite3 is a native
// module; if it fails to load (e.g. not rebuilt for the current Electron ABI)
// we degrade gracefully to an in-memory cache so the app still works.

const path = require('node:path');

let Database = null;
let db = null;
let usingSqlite = false;
const memCache = new Map();

function init(userDataDir) {
  try {
    Database = require('better-sqlite3');
    const file = path.join(userDataDir, 'repro-diff-cache.sqlite');
    db = new Database(file);
    db.pragma('journal_mode = WAL');
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
  } catch (err) {
    usingSqlite = false;
    // eslint-disable-next-line no-console
    console.warn('[db] better-sqlite3 unavailable, using in-memory cache:', err.message);
  }
}

function cacheKey(repoPath, branch, limit) {
  return `${repoPath}::${branch || 'HEAD'}::${limit}`;
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

module.exports = { init, get, set, cacheKey, getSetting, setSetting, isSqlite: () => usingSqlite };
