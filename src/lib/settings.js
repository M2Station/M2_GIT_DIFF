/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { DEFAULT_LIMIT, DEFAULT_PRELOAD, DEFAULT_AUTOFILL } from './constants.js';

// ---------------------------------------------------------------------------
// User-configurable commit load limit
// ---------------------------------------------------------------------------
// How many commits the app loads per repo on open/refresh. Defaults to
// DEFAULT_LIMIT (2000) but can be overridden in Settings; the choice persists
// in localStorage. A value of 0 means "no limit" (load the full history).
const STORAGE_KEY = 'commitLimit';
export const COMMIT_LIMIT_MIN = 0; // 0 = unlimited
export const COMMIT_LIMIT_MAX = 100000;

// Clamp an incoming value to a sane integer in [MIN, MAX]. Non-numeric input
// falls back to DEFAULT_LIMIT.
function sanitize(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  if (n < COMMIT_LIMIT_MIN) return COMMIT_LIMIT_MIN;
  if (n > COMMIT_LIMIT_MAX) return COMMIT_LIMIT_MAX;
  return n;
}

// Read the current commit limit. Reads localStorage every call so the latest
// saved value is always picked up at the moment a repo is loaded.
export function getCommitLimit() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved != null && saved !== '') return sanitize(saved);
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_LIMIT;
}

// Persist a new commit limit and return the sanitized value that was stored.
export function setCommitLimit(value) {
  const next = sanitize(value);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore persistence failure */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pre-load commit count (fast initial open)
// ---------------------------------------------------------------------------
// How many commits to load the FIRST time a repo opens, so the view appears
// quickly. The full commit limit (getCommitLimit) is only fetched when the user
// clicks "Load all logs". Defaults to DEFAULT_PRELOAD (250) and persists in
// localStorage. Always at least 1 — a zero pre-load would show nothing on open.
const PRELOAD_KEY = 'preloadCount';
export const PRELOAD_MIN = 1;
export const PRELOAD_MAX = 100000;

function sanitizePreload(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_PRELOAD;
  if (n < PRELOAD_MIN) return PRELOAD_MIN;
  if (n > PRELOAD_MAX) return PRELOAD_MAX;
  return n;
}

// Read the current pre-load count. Reads localStorage every call so the latest
// saved value is always picked up at the moment a repo is opened.
export function getPreloadCount() {
  try {
    const saved = localStorage.getItem(PRELOAD_KEY);
    if (saved != null && saved !== '') return sanitizePreload(saved);
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_PRELOAD;
}

// Persist a new pre-load count and return the sanitized value that was stored.
export function setPreloadCount(value) {
  const next = sanitizePreload(value);
  try {
    localStorage.setItem(PRELOAD_KEY, String(next));
  } catch {
    /* ignore persistence failure */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Auto-fill (cross-repo backfill) range
// ---------------------------------------------------------------------------
// Each side is loaded newest-first and may be truncated at the commit limit, so
// a commit that lives in BOTH repos can show as "unique" only because the OTHER
// side stopped before reaching its match. The app watches the oldest
// `autoFillRange` loaded commits on each side and, when it finds unmatched rows
// there, auto-loads the other side a little deeper to recover those matches.
// This value is BOTH the scan window and the per-head ceiling on how many
// commits the backfill may pull, so the cost stays bounded. 0 disables it.
const AUTOFILL_KEY = 'autoFillRange';
export const AUTOFILL_MIN = 0; // 0 = off
export const AUTOFILL_MAX = 5000;

function sanitizeAutoFill(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_AUTOFILL;
  if (n < AUTOFILL_MIN) return AUTOFILL_MIN;
  if (n > AUTOFILL_MAX) return AUTOFILL_MAX;
  return n;
}

// Read the current auto-fill range. Reads localStorage every call so a change
// in Settings takes effect on the next diff without reloading the repos.
export function getAutoFillRange() {
  try {
    const saved = localStorage.getItem(AUTOFILL_KEY);
    if (saved != null && saved !== '') return sanitizeAutoFill(saved);
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_AUTOFILL;
}

// Persist a new auto-fill range and return the sanitized value that was stored.
export function setAutoFillRange(value) {
  const next = sanitizeAutoFill(value);
  try {
    localStorage.setItem(AUTOFILL_KEY, String(next));
  } catch {
    /* ignore persistence failure */
  }
  return next;
}

// ---------------------------------------------------------------------------
// Default submodule-skip list (app-wide template)
// ---------------------------------------------------------------------------
// A user-defined default set of submodule names to skip, stored in the app
// (localStorage) rather than any repo. The Submodule-skip picker saves the
// current selection here ("Set default") and applies it back later ("Apply
// default") across repos. Defaults to an empty list — nothing is skipped until
// the user configures it. Stored as a JSON array of submodule leaf names.
const DEFAULT_SKIP_KEY = 'defaultSubmoduleSkip';

// Read the saved default skip list (array of names). Empty when unset/invalid.
export function getDefaultSubmoduleSkip() {
  try {
    const saved = localStorage.getItem(DEFAULT_SKIP_KEY);
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) return arr.map((s) => String(s || '').trim()).filter(Boolean);
    }
  } catch {
    /* unset or corrupt */
  }
  return [];
}

// Persist a new default skip list (array of names) and return the stored value.
export function setDefaultSubmoduleSkip(list) {
  const uniq = Array.from(
    new Set((Array.isArray(list) ? list : []).map((s) => String(s || '').trim()).filter(Boolean))
  );
  try {
    localStorage.setItem(DEFAULT_SKIP_KEY, JSON.stringify(uniq));
  } catch {
    /* ignore persistence failure */
  }
  return uniq;
}
