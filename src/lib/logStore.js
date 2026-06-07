/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
// Centralized in-app log/diagnostics store. A tiny framework-agnostic pub/sub
// ring buffer that ANY module (React component, plain lib, IPC callback) can
// push events into — git command failures, cache save/parse problems, export
// errors, etc. — so they can all be reviewed in one place (the Log panel)
// instead of vanishing into a transient toast or a swallowed `catch {}`.
//
// Entries are session-only (not persisted): the panel is a live debugging aid,
// and writing diagnostics to the same localStorage that may itself be failing
// would be self-defeating.
import { useSyncExternalStore } from 'react';
import { LOG_LIMIT } from './constants.js';

// Immutable snapshot array, replaced (never mutated) on every change so React's
// useSyncExternalStore can compare references to decide when to re-render.
let entries = [];
let seq = 0;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

// Record one event. `level` is 'error' | 'warn' | 'info'; `category` is a short
// tag ('git', 'cache', 'export', …); `message` is a one-line summary; `detail`
// is optional multi-line context (a git transcript, a stack, the bad value).
// Returns the created entry.
export function logEvent({ level = 'info', category = 'app', message = '', detail = '' }) {
  const entry = {
    id: ++seq,
    ts: Date.now(),
    level,
    category,
    message: String(message || ''),
    detail: detail == null ? '' : String(detail)
  };
  // Append then trim from the FRONT so the newest LOG_LIMIT entries are kept.
  const next = entries.length >= LOG_LIMIT ? entries.slice(entries.length - LOG_LIMIT + 1) : entries.slice();
  next.push(entry);
  entries = next;
  emit();
  return entry;
}

export const logError = (category, message, detail) =>
  logEvent({ level: 'error', category, message, detail });
export const logWarn = (category, message, detail) =>
  logEvent({ level: 'warn', category, message, detail });
export const logInfo = (category, message, detail) =>
  logEvent({ level: 'info', category, message, detail });

// Wipe every entry.
export function clearLog() {
  if (!entries.length) return;
  entries = [];
  emit();
}

// Current snapshot (oldest-first; the panel reverses for newest-first display).
export function getLogEntries() {
  return entries;
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// React hook: re-renders the caller whenever the log changes. Returns the
// (stable until next change) entries array.
export function useLog() {
  return useSyncExternalStore(subscribe, getLogEntries, getLogEntries);
}
