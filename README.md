

# M2_GIT_DIFF（雙倉庫 Git 紀錄並排比對工具）

一個專門用來**比較兩個本機 Git 倉庫（local repro）提交歷史**的桌面工具，採用類似 GitLens / GenLen 的 HUD 深色風格。左右並排顯示兩個倉庫的 commit，並用顏色與連接線標示差異。應用程式名稱與 LOGO 為 **M2_GIT_DIFF**，顯示於工具列、視窗標題與工作列圖示。

> 原始需求摘要：左右並排顯示兩個 local repo 的 git 紀錄與 branch；兩邊相同的 commit 用灰色背景，獨有的用紅色背景，標題相同疑似 cherry-pick 的用黃色背景並用線左右對齊連結；可搜尋標題 / 內文 / SHA / 日期。

---

## 1. 功能總覽

| 功能 | 說明 | 顏色 |
| --- | --- | --- |
| 並排雙欄 | 左右各開一個本機 repo，分別顯示其 branch 與 commit 列表 | — |
| 相同 commit | 兩邊 **SHA 完全相同** | 灰色背景 |
| 各自獨有 | 只存在於單一邊的 commit | 紅色背景 |
| Cherry-pick（標題） | **標題相同但 SHA 不同**，並用線左右對齊連接 | 黃色背景＋黃色虛線 |
| Cherry-pick（內容 / patch-id） | 標題**不同**但 `git patch-id`（實際變更內容指紋）相同 → 標題被改寫的 cherry-pick 也能配對 | 黃色背景＋黃色點線 |
| **左右對齊版面** | 配對成功的列（灰＋黃）會被排到**同一個顯示列**，連接線變成水平直線；無法配對者填補空檔 | — |
| 搜尋 | 可搜尋 標題 / 內文 / SHA / 作者 / 日期，命中高亮、其餘變暗，顯示命中數量 | — |
| Filter 模式 | 開啟後只保留命中的 commit（壓縮排列），關閉則只是變暗 | — |
| **命令列自動開啟** | 啟動時帶 `-L <path> -R <path>` 可自動載入左右兩側 repro | — |
| 虛擬化 | 只渲染視窗內的列，支援大型倉庫（數千 commit）順暢捲動 | — |
| 快取 | 解析結果以 HEAD SHA 為版本快取，重開同 repo 免重新解析 | — |
| LOGO / 品牌 | 工具列左上角 LOGO ＋ `M2_GIT_DIFF` 名稱；視窗標題與 favicon 同步 | — |

點擊任一有連線的列（灰/黃），或**直接點擊連接線**，會高亮其對應的連接線、其餘連線變淡。連接線採**直角轉折（orthogonal）**走線，並有 hover 變粗、selected 加粗發光的效果。選取後焦點移到比對區，**按 `Esc` 或點擊空白處**即可取消選取。

### 左右對齊（align）如何運作

配對線本身可能彼此交叉（非單調），若全部硬對齊會造成連線打結。因此 `alignLayout()` 會：

1. 把所有配對（common＋cherry）依左欄位置排序。
2. 取右欄位置的**最長遞增子序列（LIS）**作為「錨點」——只有這組單調的配對會被排到同一列，連線水平。
3. 其餘非單調的配對仍保留連線，但維持斜線。
4. 錨點之間的空檔，用兩邊各自未配對的 commit 依序填補（盡量共用同一列以縮短總高度）。

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
├─ src/lib/diff.js              核心比對演算法（灰/紅/黃分類、連線、搜尋、左右對齊 alignLayout）
├─ src/lib/constants.js         版面常數（列高、gutter 寬、overscan…）
├─ src/assets/logo.svg          工具列 LOGO（青色 M2 字標）
└─ src/components/
   ├─ Toolbar.jsx          上方工具列：LOGO＋名稱、開啟 repo、branch 徽章、統計、搜尋、Filter
   ├─ RepoColumn.jsx       單欄虛擬化渲染（只畫視窗內的列）
   ├─ CommitRow.jsx        單一 commit 列（絕對定位 + 高亮）
   └─ ConnectionLines.jsx  中央 gutter 的 SVG 連接線（端點同列時退化為水平線）
```

另有 `public/icon.svg`（圓角深底圖示，作為 favicon 與 Electron 視窗 / 工作列圖示）。

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

`computeDiff(left, right, patchIds)` 三階段：

1. **相同 commit（灰）**：以 SHA 建集合，兩邊都有同一 SHA → `status = 'common'`，建立 `type: 'common'` 連線。
2. **Cherry-pick — 標題（黃，虛線）**：把尚未被 SHA 配對的 commit 依「正規化標題」（`normalizeSubject`：去頭尾、小寫、空白壓縮）分組，左右同標題者依序配對 → `status = 'cherry'`，建立 `type: 'cherry'` 連線。
3. **Cherry-pick — 內容 / patch-id（黃，點線）**：對前兩步仍為 unique 的 commit，依 `git patch-id`（實際 diff 內容指紋）分組配對 → `status = 'cherry'`，建立 `type: 'patch'` 連線。即使標題被改寫，內容相同的 cherry-pick 也能配上。
4. **獨有（紅）**：其餘維持 `status = 'unique'`。

回傳：`leftRows / rightRows`（每列含 `status`、`matchId`、`index`）、`links`、以及各邊統計 `{ common, cherry, unique }`。

`matchesQuery(commit, query)`：在 subject / body / sha / short / author / authorDate 做不分大小寫子字串比對。

### patch-id（內容）配對資料流

- `App.jsx` 第一輪 `computeDiff` 完成 SHA + 標題比對後，收集兩邊仍為 `unique` 的 commit，透過 IPC `repo:patchIds` 向主行程要 `git patch-id`。
- `electron/git.js` 的 `getPatchIds()` 採**批次**：整批 `git show` 一次 pipe 給 `git patch-id --stable`，總共僅兩次 git 呼叫（非每個 commit 兩次）。
- 取回的 `sha → patchId` 對應表回填後重算 `computeDiff`，把內容相同者補成黃色配對。全程 best-effort，失敗則退回標題比對。每個 sha 只查一次。

### 左右對齊版面（`alignLayout`）

`alignLayout(Lrows, Rrows, links)` 負責把配對列排到同一個顯示列：

- `longestIncreasingByPr()`：對「依左欄位置排序的配對」取右欄位置的 LIS（二分搜尋 + 前驅回溯），得到單調錨點集合。
- 逐段在錨點之間填入兩邊未配對列（`Math.max(gapL, gapR)` 列高，盡量共用），錨點本身落在共用列上 → 連線水平。
- 回傳 `{ L, R, links, totalRows }`，其中每列帶 `displayIndex`，連線座標已重映射到顯示列。

> patch-id 強化已實作：對標題比對不到的 commit，會用 `git patch-id --stable` 以內容指紋配對（見上方 patch-id 資料流）。

---

## 5. 版面與虛擬化

- 固定列高 `ROW_HEIGHT = 36px`，讓 SVG 連線的 y 座標計算簡單。
- 每列帶 `displayIndex`，以 `position: absolute; top = displayIndex * ROW_HEIGHT` 定位，左右欄與連線完全對齊。
- `RepoColumn` 只渲染 `scrollTop ~ scrollTop + viewportHeight` 範圍（加 `OVERSCAN = 8` 列）內的列。
- 捲動容器為 `.diff-body`，`App.jsx` 透過 `onScroll` 與 `resize` 監聽更新 `scrollTop / viewportHeight`。
- 顯示列由 `alignLayout` 產生（見 §4）：配對列共用同一 `displayIndex`，故連線在 `ConnectionLines.jsx` 中退化為水平直線。

### 左右欄位排版（重要修正）

兩欄的 DOM 子元素順序固定為 `sha → date → subject → author`。右欄為了鏡像顯示（`author | subject | date | sha`）使用 CSS Grid `130px 1fr 92px 78px`。

- **問題**：`1fr` 會落在 DOM 第二個子元素（date）上，導致日期欄被撐很寬，把標題與後續欄位擠到看不見。
- **修正**：右欄對四個子元素加上 `order: 1~4`（author→subject→date→sha），讓彈性的 `1fr` 正確落在 subject 上，date 回到固定 92px。

### Filter 模式與連線重映射

- **未開 Filter**：保留全部 commit，送入 `alignLayout` 後依配對結果決定 `displayIndex`；不命中者變暗（`dimmed`）。
- **開啟 Filter（且有搜尋字）**：先移除不命中列，再送入 `alignLayout` 重新對齊與連號。
- `alignLayout` 內部以左右欄位置建表，任一端被隱藏（過濾掉）的連線會被丟棄，其餘連線座標一律重映射到 `displayIndex`。

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

連線樣式：`.link.common`（灰實線）、`.link.cherry`（黃虛線）、`.link.patch`（黃點線，內容/patch-id 配對）、`.link.selected`（加粗發光）、`.link.faded`（其餘變淡）。連線為**直角轉折**走線（`ConnectionLines.jsx`），並以透明加寬的 `.link-hit` 路徑承接點擊。

---

## 7. 開發與執行

```powershell
npm install          # 安裝相依套件
npm run dev          # 同時啟動 Vite (5173) 與 Electron（開發模式）
npm run build        # 建置 renderer 到 dist/
npm run dist         # electron-builder 打包（Windows NSIS）
npm run rebuild      # 為當前 Electron ABI 重編 better-sqlite3
```

### 啟動與自動開啟 repro（-L / -R）

啟動時可帶入 `-L <path>` / `-R <path>`（亦接受 `--left` / `--right`）自動載入左右兩側 repro：

```powershell
# 開發模式（start.cmd 會检查 NPM / 修復 Electron 後啟動）
.\start.cmd -L "D:\path\to\repoA" -R "D:\path\to\repoB"

# 已建置（production）或打包後的 exe
npx electron . -L "D:\path\to\repoA" -R "D:\path\to\repoB"
```

- `electron/main.js` 的 `parseRepoArgs()` 解析 argv；找不到時改讀環境變數 `REPRO_L` / `REPRO_R`。
- `start.cmd` 走 dev 模式，參數無法穩定穿過 `concurrently → wait-on → electron`，所以改將 `-L`/`-R` 設成 `REPRO_L`/`REPRO_R` 環境變數轉傳。
- 相對路徑以啟動目錄解析。修改 `src/` 程式碼後，production 啟動需先 `npm run build`。

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


- 指定分支 / 標籤 / 日期範圍載入（`getCommits` 已支援 `branch`、`limit` 參數）。
- 鍵盤導覽、跳到下一個命中。
- 匯出比對結果（CSV / Markdown）。
- 兩邊 commit 點選後顯示完整 diff 內容。

---

## 10. 檔案速查表

| 我想改… | 去這裡 |
| --- | --- |
| 顏色 / 分類規則 | `src/lib/diff.js`（`computeDiff`） |
| 左右對齊邏輯 | `src/lib/diff.js`（`alignLayout` / `longestIncreasingByPr`） |
| 顏色數值 / 主題 | `src/styles.css`（`:root` 變數） |
| 列高 / overscan / 預設筆數 | `src/lib/constants.js` |
| 工具列 / 搜尋 / Filter 按鈕 | `src/components/Toolbar.jsx` |
| LOGO 圖樣 | `src/assets/logo.svg`、`public/icon.svg` |
| 左右欄欄位排版（order） | `src/styles.css`（`.repo-column[data-side='R']`） |
| 連接線畫法（直角轉折 / 可點選） | `src/components/ConnectionLines.jsx` |
| 選取 focus / Esc / 點空白取消 | `src/App.jsx`（`handleSelect` / `onBodyClick` / keydown） |
| 虛擬化渲染 | `src/components/RepoColumn.jsx` |
| git log 解析欄位 / patch-id | `electron/git.js` |
| 快取邏輯 | `electron/db.js` |
| 視窗 / IPC / CLI 參數 / App 名稱與圖示 | `electron/main.js` |
| 啟動檢查 / Electron 修復 / -L -R 轉傳 | `start.cmd` / `repair-electron.ps1` |
