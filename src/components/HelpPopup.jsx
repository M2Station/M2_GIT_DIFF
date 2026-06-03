import React, { useEffect } from 'react';

// Centered modal that lists every keyboard shortcut / hotkey in the app.
// Closes on the ✕ button, the OK button, a backdrop click, or Escape.
// The footer carries the same "Powered by OA Hsiao" credit badge as the
// home (empty-state) screen, linking out to the author's GitHub.
const GH_URL = 'https://github.com/oahsiao';

const SHORTCUTS = [
  { keys: ['Ctrl', 'F'], desc: '開啟搜尋面板' },
  { keys: ['Alt', 'F'], desc: '開啟資料夾選擇器（依序填入左 / 右 repo）' },
  { keys: ['F3'], desc: '跳到下一個搜尋結果' },
  { keys: ['Shift', 'F3'], desc: '跳到上一個搜尋結果' },
  { keys: ['↑'], desc: '移到上一個 commit' },
  { keys: ['↓'], desc: '移到下一個 commit' },
  { keys: ['←'], desc: '焦點跳到左欄最接近的 commit' },
  { keys: ['→'], desc: '焦點跳到右欄最接近的 commit' },
  { keys: ['Enter'], desc: '開啟目前 commit 的詳細視窗' },
  { keys: ['Ctrl', 'Click'], desc: '開啟該 commit 的詳細視窗（可同時開多個）' },
  { keys: ['Esc'], desc: '關閉所有彈窗 / 取消選取 / 取消連結中' },
  { keys: ['Del'], desc: '刪除目前選取的手動連結' },
  { keys: ['Ctrl', 'Enter'], desc: '在註記視窗中：儲存並關閉' },
];

function openGitHub(e) {
  e.preventDefault();
  window.api?.openExternal?.(GH_URL);
}

export default function HelpPopup({ onClose }) {
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
          <span className="help-title">⌨ 快捷鍵 / Keyboard Shortcuts</span>
          <span className="help-spacer" />
          <button className="help-x" onClick={onClose} title="關閉 (Esc)">✕</button>
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
            title="開啟作者 GitHub · github.com/oahsiao"
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
