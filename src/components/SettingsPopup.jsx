import React, { useEffect } from 'react';
import { useI18n } from '../lib/i18n.js';

// Centered modal opened from the toolbar ⚙ Settings button. Currently hosts the
// language picker; the available languages are discovered automatically from
// the JSON files in src/locales. Closes on the ✕ button, a backdrop click, or
// Escape.
export default function SettingsPopup({ onClose }) {
  const { t, lang, setLang, locales } = useI18n();

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
        </div>

        <div className="settings-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
