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
            <span className="seb-spark">✦</span>
            <span className="seb-text">Powered by <b>OA Hsiao</b></span>
            <span className="seb-gh">↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}
