/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Theme auto-discovery
// ---------------------------------------------------------------------------
// Every *.json file dropped into ./themes is picked up automatically at build
// time by Vite's import.meta.glob — exactly like the locale system. The number
// of files in that folder decides which themes the app offers: add
// `oceanic.json` and Oceanic shows up in the Settings theme list with no code
// changes. The filename (minus `.json`) is the theme id; the file's
// `_meta.name` is the display name; the `vars` object maps CSS custom
// properties (e.g. `--accent`) to the values applied on <html>.
const modules = import.meta.glob('../themes/*.json', { eager: true });

const THEMES = {};
for (const [path, mod] of Object.entries(modules)) {
  const id = path.split('/').pop().replace(/\.json$/i, '');
  const data = mod.default || mod;
  THEMES[id] = {
    id,
    name: (data && data._meta && data._meta.name) || id,
    vars: (data && data.vars) || {}
  };
}

// Sorted list of { id, name } for the theme picker.
export const availableThemes = () =>
  Object.values(THEMES)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.id.localeCompare(b.id));

// Default theme: a previously saved choice → low_key (the app's native look)
// → whatever was scanned first.
function defaultTheme() {
  try {
    const saved = localStorage.getItem('appTheme');
    if (saved && THEMES[saved]) return saved;
  } catch {
    /* localStorage unavailable */
  }
  if (THEMES['low_key']) return 'low_key';
  const first = Object.keys(THEMES)[0];
  return first || 'low_key';
}

// Write a theme's CSS custom properties onto the document root so every
// `var(--…)` reference in styles.css picks them up live.
function applyTheme(id) {
  const theme = THEMES[id];
  if (!theme || typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.vars)) {
    root.style.setProperty(name, value);
  }
  root.setAttribute('data-theme', id);
}

// Apply the saved/default theme synchronously at module load — before React
// renders — to prevent a flash of the wrong theme (FOUC). This mirrors the
// pre-render theme apply that M2_DEVOPS does via an inline <script> in its
// index.html, but is CSP-safe here because it runs from the bundled module
// (M2_GIT_DIFF's CSP blocks inline scripts via script-src 'self').
applyTheme(defaultTheme());

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(defaultTheme);

  // Apply on mount and whenever the theme changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES[next]) return;
    setThemeState(next);
    try {
      localStorage.setItem('appTheme', next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      themes: availableThemes()
    }),
    [theme, setTheme]
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

// Main hook: `const { theme, setTheme, themes } = useTheme();`
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback if a component is rendered outside the provider.
    return { theme: defaultTheme(), setTheme: () => {}, themes: availableThemes() };
  }
  return ctx;
}
