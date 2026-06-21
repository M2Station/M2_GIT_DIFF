/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect } from 'react';
import { useT } from '../lib/i18n.js';

// Centered modal that lists every keyboard shortcut / hotkey in the app.
// Closes on the ✕ button, the OK button, a backdrop click, or Escape.
// The footer carries the same "Powered by OA Hsiao" credit badge as the
// home (empty-state) screen, linking out to the author's GitHub.
const GH_URL = 'https://github.com/oahsiao';

// Keyboard keys are language-neutral; only the descriptions are translated
// (via the `help.shortcuts` array, matched by index).
const SHORTCUT_KEYS = [
  ['Ctrl', 'F'],
  ['Alt', 'F'],
  ['F3'],
  ['Shift', 'F3'],
  ['↑'],
  ['↓'],
  ['←'],
  ['→'],
  ['Enter'],
  ['Ctrl', 'Click'],
  ['Shift', 'Click'],
  ['Esc'],
  ['Del'],
  ['Ctrl', 'Enter'],
  ['Ctrl', 'Z'],
  ['Ctrl', 'Y']
];

function openGitHub(e) {
  e.preventDefault();
  window.api?.openExternal?.(GH_URL);
}

export default function HelpPopup({ onClose }) {
  const t = useT();
  const descs = t('help.shortcuts');
  const SHORTCUTS = SHORTCUT_KEYS.map((keys, i) => ({
    keys,
    desc: Array.isArray(descs) ? descs[i] : ''
  }));
  // Close on Escape (capture so it wins over global handlers).
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
    <div className="help-backdrop" onMouseDown={onClose}>
      <div className="help-popup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="help-head">
          <span className="help-title">{t('help.title')}</span>
          <span className="help-spacer" />
          <button className="help-x" onClick={onClose} title={t('common.closeEsc')}>✕</button>
        </div>

        <div className="help-body">
          <table className="help-table">
            <tbody>
              {SHORTCUTS.map((s, i) => (
                <tr key={i}>
                  <td className="help-keys">
                    {s.keys.map((k, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className="help-plus">+</span>}
                        <kbd className="help-kbd">{k}</kbd>
                      </React.Fragment>
                    ))}
                  </td>
                  <td className="help-desc">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="help-foot">
          <a
            className="stage-empty-badge help-credit"
            href={GH_URL}
            onClick={openGitHub}
            title={t('help.githubTitle')}
          >
            <svg
              className="seb-gh-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span className="seb-by">Powered by</span>
            <span className="seb-name">OA Hsiao</span>
          </a>
        </div>
      </div>
    </div>
  );
}
