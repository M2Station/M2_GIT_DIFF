/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { useTheme } from '../lib/theme.js';
import {
  getCommitLimit,
  setCommitLimit,
  COMMIT_LIMIT_MIN,
  COMMIT_LIMIT_MAX,
  getPreloadCount,
  setPreloadCount,
  PRELOAD_MIN,
  PRELOAD_MAX,
  getAutoFillRange,
  setAutoFillRange,
  AUTOFILL_MIN,
  AUTOFILL_MAX
} from '../lib/settings.js';

// Centered modal opened from the toolbar ⚙ Settings button. Hosts the language
// and theme pickers; both lists are discovered automatically from the JSON
// files in src/locales and src/themes. Closes on the ✕ button, a backdrop
// click, or Escape.
export default function SettingsPopup({ onClose, onShowUpdate }) {
  const { t, lang, setLang, locales } = useI18n();
  const { theme, setTheme, themes } = useTheme();
  const [commitLimit, setCommitLimitState] = useState(() => String(getCommitLimit()));
  const [preload, setPreloadState] = useState(() => String(getPreloadCount()));
  const [autoFill, setAutoFillState] = useState(() => String(getAutoFillRange()));
  const [version, setVersion] = useState('');
  // idle | checking | latest | error
  const [updateState, setUpdateState] = useState('idle');
  const [updateMsg, setUpdateMsg] = useState('');

  // Show the running app version next to the check button.
  useEffect(() => {
    let alive = true;
    window.api.getAppVersion?.()
      .then((v) => { if (alive) setVersion(v || ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Manual "Check for updates": hands a found update off to the full prompt
  // (via onShowUpdate) and otherwise reports "up to date" / an error inline.
  const runCheck = async () => {
    setUpdateState('checking');
    setUpdateMsg('');
    try {
      const res = await window.api.checkUpdate();
      if (res && res.hasUpdate) {
        onShowUpdate?.(res);
        setUpdateState('idle');
      } else if (res && res.updateWithoutAsset) {
        setUpdateState('latest');
        setUpdateMsg(t('update.noAssetYet', { version: res.latestVersion }));
      } else if (res && res.error) {
        setUpdateState('error');
        setUpdateMsg(res.error);
      } else {
        setUpdateState('latest');
        setUpdateMsg(t('update.upToDate'));
      }
    } catch (e) {
      setUpdateState('error');
      setUpdateMsg(String(e?.message || e));
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div className="settings-popup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">{t('settings.title')}</span>
          <span className="settings-spacer" />
          <button className="settings-x" onClick={onClose} title={t('common.closeEsc')} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-lang">
              {t('settings.language')}
            </label>
            <select
              id="settings-lang"
              className="settings-select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              {locales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="settings-hint">{t('settings.languageHint')}</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-theme">
              {t('settings.theme')}
            </label>
            <select
              id="settings-theme"
              className="settings-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {themes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
            <p className="settings-hint">{t('settings.themeHint')}</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-commit-limit">
              {t('settings.commitLimit')}
            </label>
            <input
              id="settings-commit-limit"
              className="settings-select"
              type="number"
              min={COMMIT_LIMIT_MIN}
              max={COMMIT_LIMIT_MAX}
              step="100"
              value={commitLimit}
              onChange={(e) => setCommitLimitState(e.target.value)}
              onBlur={() => setCommitLimitState(String(setCommitLimit(commitLimit)))}
            />
            <p className="settings-hint">{t('settings.commitLimitHint')}</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-preload">
              {t('settings.preload')}
            </label>
            <input
              id="settings-preload"
              className="settings-select"
              type="number"
              min={PRELOAD_MIN}
              max={PRELOAD_MAX}
              step="50"
              value={preload}
              onChange={(e) => setPreloadState(e.target.value)}
              onBlur={() => setPreloadState(String(setPreloadCount(preload)))}
            />
            <p className="settings-hint">{t('settings.preloadHint')}</p>
          </div>

          <div className="settings-field">
            <label className="settings-label" htmlFor="settings-autofill">
              {t('settings.autoFill')}
            </label>
            <input
              id="settings-autofill"
              className="settings-select"
              type="number"
              min={AUTOFILL_MIN}
              max={AUTOFILL_MAX}
              step="50"
              value={autoFill}
              onChange={(e) => setAutoFillState(e.target.value)}
              onBlur={() => setAutoFillState(String(setAutoFillRange(autoFill)))}
            />
            <p className="settings-hint">{t('settings.autoFillHint')}</p>
          </div>

          <div className="settings-field">
            <label className="settings-label">{t('settings.updates')}</label>
            <div className="settings-update-row">
              <span className="settings-version">
                {t('settings.currentVersion', { version: version || '—' })}
              </span>
              <button
                type="button"
                className="btn"
                onClick={runCheck}
                disabled={updateState === 'checking'}
              >
                {updateState === 'checking' ? t('update.checking') : t('settings.checkUpdate')}
              </button>
            </div>
            {updateState === 'latest' ? (
              <p className="settings-hint ok">✓ {updateMsg}</p>
            ) : updateState === 'error' ? (
              <p className="settings-hint err">⚠ {updateMsg}</p>
            ) : (
              <p className="settings-hint">{t('settings.updatesHint')}</p>
            )}
          </div>
        </div>

        <div className="settings-foot">
          <button type="button" className="btn primary" onClick={() => { setCommitLimit(commitLimit); setPreloadCount(preload); setAutoFillRange(autoFill); onClose(); }}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
