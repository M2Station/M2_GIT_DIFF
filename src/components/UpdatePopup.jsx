/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n.js';

function fmtMB(bytes) {
  if (!bytes) return '0';
  return (bytes / 1048576).toFixed(1);
}

// Centered modal shown when a newer release is available. Walks the user
// through download -> install: the download streams progress from the main
// process; installing launches the NSIS installer and quits so it can replace
// the running exe (the leftover file is swept on the next launch). "Later"
// dismisses the prompt and deletes any partial/complete download so nothing is
// left lying around. The backdrop and Esc are inert while a download/install is
// in flight so the flow can't be interrupted halfway.
export default function UpdatePopup({ info, onClose }) {
  const t = useT();
  // prompt | downloading | ready | installing | error
  const [phase, setPhase] = useState('prompt');
  const [progress, setProgress] = useState({ received: 0, total: (info && info.asset && info.asset.size) || 0 });
  const [error, setError] = useState('');
  const filePathRef = useRef('');
  const unsubRef = useRef(null);

  const busy = phase === 'downloading' || phase === 'installing';

  // Drop the progress subscription if the popup unmounts mid-download.
  useEffect(() => () => { if (unsubRef.current) unsubRef.current(); }, []);

  const dismiss = () => {
    // Best-effort: remove any partial/complete download we won't use right now.
    try { window.api.cleanupUpdate?.(); } catch { /* ignore */ }
    onClose();
  };

  // Esc closes only when idle (never mid-transfer).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);

  const startDownload = async () => {
    if (!info || !info.asset) return;
    setError('');
    setPhase('downloading');
    setProgress({ received: 0, total: info.asset.size || 0 });
    unsubRef.current = window.api.onUpdateProgress(({ received, total }) => {
      setProgress({ received, total: total || info.asset.size || 0 });
    });
    try {
      const res = await window.api.downloadUpdate(info.asset);
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      filePathRef.current = res.path;
      setPhase('ready');
    } catch (e) {
      if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      setError(String(e?.message || e));
      setPhase('error');
    }
  };

  const install = async () => {
    setPhase('installing');
    try {
      await window.api.installUpdate(filePathRef.current);
      // The app quits from the main process; nothing more to do here.
    } catch (e) {
      setError(String(e?.message || e));
      setPhase('error');
    }
  };

  const pct = progress.total
    ? Math.min(100, Math.round((progress.received / progress.total) * 100))
    : 0;

  return (
    <div className="update-backdrop" onMouseDown={busy ? undefined : dismiss}>
      <div
        className="update-popup"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('update.title')}
      >
        <div className="update-head">
          <span className="update-spark" aria-hidden="true">⬆</span>
          <span className="update-title">{t('update.title')}</span>
          <span className="update-spacer" />
          {!busy && (
            <button className="update-x" onClick={dismiss} title={t('common.closeEsc')} aria-label={t('common.close')}>
              ✕
            </button>
          )}
        </div>

        <div className="update-body">
          <div className="update-versions">
            <span className="uv-cur">v{info?.currentVersion}</span>
            <span className="uv-arrow" aria-hidden="true">→</span>
            <span className="uv-new">v{info?.latestVersion}</span>
          </div>

          {info?.notes ? (
            <div className="update-notes-wrap">
              <div className="update-notes-label">{t('update.notes')}</div>
              <pre className="update-notes">{info.notes}</pre>
            </div>
          ) : null}

          {info?.htmlUrl && (
            <button
              type="button"
              className="update-link"
              onClick={() => window.api.openExternal(info.htmlUrl)}
            >
              {t('update.viewRelease')}
            </button>
          )}

          {phase === 'downloading' && (
            <div className="update-progress" role="status" aria-live="polite">
              <div className="update-bar">
                <div className="update-bar-fill" style={{ width: pct + '%' }} />
              </div>
              <div className="update-progress-text">
                {t('update.downloading', {
                  pct,
                  received: fmtMB(progress.received),
                  total: fmtMB(progress.total)
                })}
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <div className="update-ready" role="status" aria-live="polite">
              ✓ {t('update.readyMsg')}
            </div>
          )}

          {phase === 'error' && (
            <div className="update-error" role="alert">⚠ {error}</div>
          )}
        </div>

        <div className="update-foot">
          {phase === 'prompt' && (
            <>
              <button type="button" className="btn ghost" onClick={dismiss}>{t('update.later')}</button>
              <button type="button" className="btn primary" onClick={startDownload}>{t('update.download')}</button>
            </>
          )}
          {phase === 'downloading' && (
            <button type="button" className="btn" disabled>{t('update.downloadingShort')}</button>
          )}
          {phase === 'ready' && (
            <>
              <button type="button" className="btn ghost" onClick={dismiss}>{t('update.later')}</button>
              <button type="button" className="btn primary" onClick={install}>{t('update.install')}</button>
            </>
          )}
          {phase === 'installing' && (
            <button type="button" className="btn" disabled>{t('update.installing')}</button>
          )}
          {phase === 'error' && (
            <>
              <button type="button" className="btn ghost" onClick={dismiss}>{t('update.later')}</button>
              <button type="button" className="btn primary" onClick={startDownload}>{t('update.retry')}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
