import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Locale auto-discovery
// ---------------------------------------------------------------------------
// Every *.json file dropped into ./locales is picked up automatically at build
// time by Vite's import.meta.glob. The number of files in that folder decides
// which languages the app offers — add `ja.json` and Japanese shows up in the
// Settings language list with no code changes. The filename (minus `.json`) is
// the locale code; the file's `_meta.name` is the display name shown to users.
const modules = import.meta.glob('../locales/*.json', { eager: true });

const LOCALES = {};
for (const [path, mod] of Object.entries(modules)) {
  const code = path.split('/').pop().replace(/\.json$/i, '');
  const data = mod.default || mod;
  LOCALES[code] = {
    code,
    name: (data && data._meta && data._meta.name) || code,
    strings: data
  };
}

// Sorted list of { code, name } for the language picker.
export const availableLocales = () =>
  Object.values(LOCALES)
    .map(({ code, name }) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));

// Default language: a previously saved choice → zh-TW (the app's native
// language) → en → whatever was scanned first.
function defaultLang() {
  try {
    const saved = localStorage.getItem('appLang');
    if (saved && LOCALES[saved]) return saved;
  } catch {
    /* localStorage unavailable */
  }
  if (LOCALES['zh-TW']) return 'zh-TW';
  if (LOCALES['en']) return 'en';
  const first = Object.keys(LOCALES)[0];
  return first || 'en';
}

const FALLBACK = LOCALES['en'] ? 'en' : Object.keys(LOCALES)[0];

// Resolve a dot-path key ("toolbar.search") inside a locale's string tree.
function lookup(code, key) {
  const root = LOCALES[code] && LOCALES[code].strings;
  if (!root) return undefined;
  let cur = root;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// Interpolate {name} placeholders from `vars`.
function interpolate(str, vars) {
  if (!vars || typeof str !== 'string') return str;
  return str.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
  );
}

// Build a translate function bound to a language. Falls back to the fallback
// locale, then to the key itself, so a missing string is always visible (and
// debuggable) rather than rendering blank.
export function makeT(lang) {
  return (key, vars) => {
    let val = lookup(lang, key);
    if (val === undefined && lang !== FALLBACK) val = lookup(FALLBACK, key);
    if (val === undefined) return key;
    if (Array.isArray(val) || typeof val === 'object') return val;
    return interpolate(val, vars);
  };
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(defaultLang);

  const setLang = useCallback((next) => {
    if (!LOCALES[next]) return;
    setLangState(next);
    try {
      localStorage.setItem('appLang', next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t: makeT(lang),
      locales: availableLocales()
    }),
    [lang, setLang]
  );

  return React.createElement(I18nContext.Provider, { value }, children);
}

// Main hook: `const { t, lang, setLang, locales } = useI18n();`
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback if a component is rendered outside the provider.
    return { lang: FALLBACK, setLang: () => {}, t: makeT(FALLBACK), locales: availableLocales() };
  }
  return ctx;
}

// Convenience: just the translate function.
export function useT() {
  return useI18n().t;
}
