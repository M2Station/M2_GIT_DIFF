/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import { DEFAULT_LIMIT } from './constants.js';

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
