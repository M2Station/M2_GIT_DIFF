

# Git Repro Diff（雙倉庫 Git 紀錄並排比對工具）

一個專門用來**比較兩個本機 Git 倉庫（local repro）提交歷史**的桌面工具，採用類似 GitLens / GenLen 的 HUD 深色風格。左右並排顯示兩個倉庫的 commit，並用顏色與連接線標示差異。

> 原始需求摘要：左右並排顯示兩個 local repo 的 git 紀錄與 branch；兩邊相同的 commit 用灰色背景，獨有的用紅色背景，標題相同疑似 cherry-pick 的用黃色背景並用線左右對齊連結；可搜尋標題 / 內文 / SHA / 日期。

---

## 1. 功能總覽

| 功能 | 說明 | 顏色 |
| --- | --- | --- |
| 並排雙欄 | 左右各開一個本機 repo，分別顯示其 branch 與 commit 列表 | — |
| 相同 commit | 兩邊 **SHA 完全相同** | 灰色背景 |
| 各自獨有 | 只存在於單一邊的 commit | 紅色背景 |
| Cherry-pick | **標題相同但 SHA 不同**（可能是 cherry-pick），並用線左右對齊連接. 且左右排列 對齊 | 黃色背景＋黃色虛線 |
| 搜尋 | 可搜尋 標題 / 內文 / SHA / 作者 / 日期，命中高亮、其餘變暗，顯示命中數量 | — |
| Filter 模式 | 開啟後只保留命中的 commit（壓縮排列），關閉則只是變暗 | — |
| 虛擬化 | 只渲染視窗內的列，支援大型倉庫（數千 commit）順暢捲動 | — |
| 快取 | 解析結果以 HEAD SHA 為版本快取，重開同 repo 免重新解析 | — |

點擊任一有連線的列（灰/黃），會高亮其對應的連接線。

---

## 2. 技術架構

```
Electron (主行程)
├─ electron/main.js      視窗建立、IPC handler、資料夾選擇對話框
├─ electron/preload.js   contextBridge 安全橋接，暴露 window.api
├─ electron/git.js       呼叫系統 git，解析 git log → 結構化 commit
└─ electron/db.js        better-sqlite3 快取層（缺少時自動退回記憶體快取）

Renderer (React + Vite)
├─ src/main.jsx                 React 入口
├─ src/App.jsx                  狀態管理、diff 計算、虛擬化捲動、過濾邏輯
├─ src/styles.css               HUD 深色主題樣式
├─ src/lib/diff.js              核心比對演算法（灰/紅/黃分類、連線、搜尋）
├─ src/lib/constants.js         版面常數（列高、gutter 寬、overscan…）
└─ src/components/
   ├─ Toolbar.jsx          上方工具列：開啟 repo、branch 徽章、統計、搜尋、Filter
   ├─ RepoColumn.jsx       單欄虛擬化渲染（只畫視窗內的列）
   ├─ CommitRow.jsx        單一 commit 列（絕對定位 + 高亮）
   └─ ConnectionLines.jsx  中央 gutter 的 SVG 連接線
```

**技術選型**：Electron + React + Vite + better-sqlite3（快取，選用）。

---

## 3. 資料流程

1. 使用者按「Open repo…」→ `main.js` 的 `dialog:pickFolder` 開啟資料夾選擇。
2. `repo:load` IPC：
   - 檢查是否為 git 倉庫（`.git` 是否存在）。
   - 以 `repoPath::branch::limit` 為 key、HEAD SHA 為版本，查快取（`db.js`）。
   - 未命中則呼叫 `git.js` 的 `git log` 解析後寫入快取。
3. `App.jsx` 拿到兩邊 repo → `computeDiff()` 計算分類與連線 → `view` 依搜尋/Filter 建立顯示列 → 各欄虛擬化渲染。

### git log 解析（electron/git.js）

使用自訂分隔符（`\x1f` 欄位、`\x1e` 紀錄）避免 commit 訊息撞分隔符：

```
%H %h %P %an %ae %ad %cd %s %b
```

對應欄位：`sha / short / parents / author / authorEmail / authorDate / commitDate / subject / body`。
預設 `limit = 2000`（見 `DEFAULT_LIMIT`）。

---

## 4. 比對演算法（src/lib/diff.js）

`computeDiff(left, right)` 三階段：

1. **相同 commit（灰）**：以 SHA 建集合，兩邊都有同一 SHA → `status = 'common'`，建立 `type: 'common'` 連線。
2. **Cherry-pick（黃）**：把尚未被 SHA 配對的 commit 依「正規化標題」（`normalizeSubject`：去頭尾、小寫、空白壓縮）分組，左右同標題者依序配對 → `status = 'cherry'`，建立 `type: 'cherry'` 連線。
3. **獨有（紅）**：其餘維持 `status = 'unique'`。

回傳：`leftRows / rightRows`（每列含 `status`、`matchId`、`index`）、`links`、以及各邊統計 `{ common, cherry, unique }`。

`matchesQuery(commit, query)`：在 subject / body / sha / short / author / authorDate 做不分大小寫子字串比對。

> 預留強化點：`getPatchIds()` 已實作（用 `git patch-id --stable`），未來可改用 patch-id 比對 cherry-pick，即使標題被改寫也能配對。

---

## 5. 版面與虛擬化

- 固定列高 `ROW_HEIGHT = 36px`，讓 SVG 連線的 y 座標計算簡單。
- 每列帶 `displayIndex`，以 `position: absolute; top = displayIndex * ROW_HEIGHT` 定位，左右欄與連線完全對齊。
- `RepoColumn` 只渲染 `scrollTop ~ scrollTop + viewportHeight` 範圍（加 `OVERSCAN = 8` 列）內的列。
- 捲動容器為 `.diff-body`，`App.jsx` 透過 `onScroll` 與 `resize` 監聽更新 `scrollTop / viewportHeight`。

### Filter 模式與連線重映射

- **未開 Filter**：`displayIndex === 原始 index`，全部顯示；不命中者變暗（`dimmed`）。
- **開啟 Filter（且有搜尋字）**：移除不命中列並壓縮（`displayIndex` 重新由 0 連號）。
- 連線會依 `origToDisplay` 重新映射座標；任一端被隱藏的連線會被丟棄。

---

## 6. 顏色與主題（src/styles.css）

CSS 變數集中於 `:root`：

| 變數 | 用途 |
| --- | --- |
| `--common-bg / --common-bd` | 灰：相同 commit |
| `--cherry-bg / --cherry-bd` | 黃：cherry-pick |
| `--unique-bg / --unique-bd` | 紅：獨有 commit |
| `--accent` | 青色強調色（HUD 發光） |
| `--row-h` | 列高 |

連線樣式：`.link.common`（灰實線）、`.link.cherry`（黃虛線）、`.link.selected`（加粗發光）、`.link.faded`（其餘變淡）。

---

## 7. 開發與執行

```powershell
npm install          # 安裝相依套件
npm run dev          # 同時啟動 Vite (5173) 與 Electron（開發模式）
npm run build        # 建置 renderer 到 dist/
npm run dist         # electron-builder 打包（Windows NSIS）
npm run rebuild      # 為當前 Electron ABI 重編 better-sqlite3
```

### 環境注意事項（本機已知狀況）

1. **better-sqlite3 無法編譯**：本機缺少 Visual Studio 的 *ClangCL* 工具集，原生模組編不過。已將其設為 `optionalDependencies`，`db.js` 偵測不到時會自動退回**記憶體快取**，功能不受影響。若要啟用持久化快取：安裝 ClangCL（或在 VS 安裝程式勾選對應工具集）後執行 `npm run rebuild`。
2. **Electron 二進位在 `Z:` 網路磁碟解壓失敗**：安裝後的 postinstall 在 `Z:` 上靜默失敗。處置方式：用 PowerShell `Expand-Archive` 把快取中的 `electron-vXX-win32-x64.zip` 解到 `node_modules/electron/dist`，並建立 `node_modules/electron/path.txt`（內容 `electron.exe`）。重裝 `node_modules` 後需重做，或執行 `node node_modules/electron/install.js`。
3. DevTools 的 `Autofill.enable` / GPU 警告為無害雜訊，可忽略。

---

## 8. 安全性

- `contextIsolation: true`、`nodeIntegration: false`，renderer 僅透過 preload 的 `window.api` 取得受限介面。
- `index.html` 設有 CSP。
- git 指令一律用 `execFile`（陣列參數，非 shell 字串），避免命令注入。

---

## 9. 後續可擴充方向

- 以 `git patch-id` 取代標題比對，提升 cherry-pick 偵測準確度。
- 指定分支 / 標籤 / 日期範圍載入（`getCommits` 已支援 `branch`、`limit` 參數）。
- 鍵盤導覽、跳到下一個命中。
- 匯出比對結果（CSV / Markdown）。
- 兩邊 commit 點選後顯示完整 diff 內容。

---

## 10. 檔案速查表

| 我想改… | 去這裡 |
| --- | --- |
| 顏色 / 分類規則 | `src/lib/diff.js` |
| 顏色數值 / 主題 | `src/styles.css`（`:root` 變數） |
| 列高 / overscan / 預設筆數 | `src/lib/constants.js` |
| 工具列 / 搜尋 / Filter 按鈕 | `src/components/Toolbar.jsx` |
| 連接線畫法 | `src/components/ConnectionLines.jsx` |
| 虛擬化渲染 | `src/components/RepoColumn.jsx` |
| git log 解析欄位 | `electron/git.js` |
| 快取邏輯 | `electron/db.js` |
| 視窗 / IPC | `electron/main.js` |
