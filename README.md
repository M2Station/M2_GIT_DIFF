

# M2_GIT_DIFF（雙倉庫 Git 紀錄並排比對工具）

一個專門用來**比較兩個本機 Git 倉庫（local repro）提交歷史**的桌面工具，採用類似 GitLens / GenLen 的 HUD 深色風格。左右並排顯示兩個倉庫的 commit，並用顏色與連接線標示差異。應用程式名稱與 LOGO 為 **M2_GIT_DIFF**，顯示於工具列、視窗標題與工作列圖示。

> 原始需求摘要：左右並排顯示兩個 local repo 的 git 紀錄與 branch；兩邊相同的 commit 用灰色背景，獨有的用紅色背景，標題相同疑似 cherry-pick 的用黃色背景並用線左右對齊連結；可搜尋標題 / 內文 / SHA / 日期。

## 操作預覽

![操作預覽動畫](public/demo.gif)

> 上方為合成示意動畫（非實機錄影），依序展示：雙欄比對與連接線、點選連線、搜尋高亮、右鍵強制背景顏色、`Ctrl`+點選詳情浮窗與 HL 高亮、註記導航。
> 動畫由 `scripts/make-demo-gif.mjs` 以與 `src/styles.css` 相同的配色繪製，執行 `npm run demo:gif` 可重新產生 `public/demo.gif`。

---

## 1. 功能總覽

| 功能 | 說明 | 顏色 |
| --- | --- | --- |
| 並排雙欄 | 左右各開一個本機 repo，分別顯示其 branch 與 commit 列表 | — |
| 相同 commit | 兩邊 **SHA 完全相同** | 灰色背景 |
| 各自獨有 | 只存在於單一邊的 commit | 紅色背景 |
| Cherry-pick（標題） | **標題相同但 SHA 不同**，並用線左右對齊連接 | 黃色背景＋黃色虛線 |
| Cherry-pick（內容 / patch-id） | 標題**不同**但 `git patch-id`（實際變更內容指紋）相同 → 標題被改寫的 cherry-pick 也能配對 | 黃色背景＋黃色點線 |
| **Fuzzy Match（內容相似度）** | 工具列可開關的模糊配對：當 SHA / 標題 / patch-id **都比對不上**時，比較兩個 commit **實際變更的程式碼行**，相似度（包含率）≥ 門檻（預設 **80%**，可調 0–100%）即配對。適合「TOT 把多個專案一起改、personal branch 只改其中一個專案」這種**子集**情境 | 粉紅色背景＋粉紅色粗虛線 |
| **左右對齊版面** | 配對成功的列（灰＋黃＋粉）會被排到**同一個顯示列**，連接線變成水平直線；無法配對者填補空檔 | — |
| 搜尋 | 可搜尋 標題 / 內文 / SHA / 作者 / 日期，命中高亮、其餘變暗，顯示命中數量 | — |
| Filter 模式 | 開啟後只保留命中的 commit（壓縮排列），關閉則只是變暗 | — |
| **命令列自動開啟** | 啟動時帶 `-L <path> -R <path>` 可自動載入左右兩側 repro | — |
| **手動連結** | 在未配對（紅）的 commit 上點節點 ◗，左右各點一個即可手動配對；顏色為**紫色**以區別 cherry 黃色；可斷開並自動暫存，重開相同 repro 會自動還原 | 紫色背景＋紫色實線 |
| **單一 Repo 模式** | 工具列 **View** 切換 `⇄ Compare` / `◧ Left only` / `◨ Right only`；只看單邊時該欄放大佔滿整個視窗，隱藏 gutter 與連線；單欄模式下 commit 背景改為**正常（透明）**，強制顏色仍保留 | — |
| **每列註記（Note）** | 右鍵任一 commit → 新增/編輯註記（浮動可拖曳編輯框，`Ctrl+Enter` 儲存）；有註記者顯示 📝 圖示，點圖示可檢視/編輯/刪除 | — |
| **強制背景顏色** | 右鍵 commit → 選 綠 / 亮紅 / 藍 / 黃 強制覆蓋該列背景；可清除單列或一次清除全部 | 綠/亮紅/藍/黃 |
| **自訂顏色（第五色）** | 右鍵選單最後一個色票為 `<input type="color">` 取色器，選色後即套用該列，並把該色記成全域第五個「快速」色票（存 `localStorage` 的 `customSwatch`），之後右鍵選單會多出一格自訂色可重複使用 | 任意 HEX |
| **Git 操作浮窗（terminal）** | 工具列每側的 Git bar 執行 pull / fetch 等操作後，跳出可拖曳的浮動視窗顯示該次 `git` 指令與完整 stdout/stderr 與 exit code；成功為綠框、失敗為紅框；只有成功才重新載入該 repo | 綠/紅框 |
| **匯出 Excel（.xlsx）** | 工具列右上 **⬇ Export Excel**：把左右對齊後的 commit、強制顏色、註記與手動連結一併輸出成 styled `.xlsx`（ExcelJS）。儲存格底色對應強制顏色、註記以 cell 註解（像 tip）呈現、配對 commit 以空白 cell 對齊；另含一張 **Manual Links** 工作表列出所有手動連結 | 與畫面同色 |
| **匯出筆數確認** | 按下匯出前先跳出對話框詢問要輸出多少筆（預設 **全部 ALL**，或指定前 N 筆），資料量大時提醒，避免一次輸出過多造成卡頓 | — |
| **Commit 詳情浮窗** | `Ctrl`+左鍵點 commit → 浮動視窗顯示 SHA / 作者 / 日期（清楚標示）＋ Markdown 渲染的 commit 內文；配對的 **Related item** 特別凸顯；右上 **HL** 輸入格可即時高亮符合文字（開啟時自動帶入目前搜尋字）；可**移動、拖拉縮放**、依內容自動調整寬度；可**同時開多個**（重複點同一個不重開） | — |
| **可點擊的 commit 連結** | Commit 詳情浮窗在 SHA 旁顯示 **🌐 Web** 連結，以系統預設瀏覽器開啟該 commit 的遠端頁面（自動辨識 GitHub / GitLab / Gitea / ADO / Bitbucket）；Excel 匯出時 SHA 儲存格也會超連結到同一遠端 URL | — |
| **VS Code Chat 整合** | Commit 詳情浮窗的 **💬 Chat** 按鈕，呼叫本機安裝的 VS Code（`code chat`）並以該 repo 為工作區開啟 Copilot Chat（agent 模式），自動帶入該 commit 的英文說明 prompt（可在 chat 內執行 `git show <sha>` 看完整 diff）；未安裝 VS Code 時於浮窗顯示提示 | — |
| 虛擬化 | 只渲染視窗內的列，支援大型倉庫（數千 commit）順暢捲動 | — |
| 快取 | 解析結果以 HEAD SHA 為版本快取，重開同 repo 免重新解析 | — |
| LOGO / 品牌 | 工具列左上角 LOGO ＋ `M2_GIT_DIFF` 名稱；視窗標題與 favicon 同步 | — |

點擊任一有連線的列（灰/黃/粉），或**直接點擊連接線**，會高亮其對應的連接線、其餘連線變淡。連接線採**直角轉折（orthogonal）**走線，並有 hover 變粗、selected 加粗發光的效果。選取後焦點移到比對區，**按 `Esc` 或點擊空白處**即可取消選取。

**Fuzzy Match（內容相似度模糊配對）**：工具列 Swap 左側的 **≈ Fuzzy Match** 按鈕（關閉時灰階、開啟時亮粉紅）可切換模糊配對，旁邊的數字框是相似度門檻（0–100%，**預設 80%**）。開啟後，對於 SHA / 標題 / patch-id 都配不上的 commit，會透過 IPC 抓取兩側 commit 的**實際變更行**（diff 的 `+`/`-` 內容，去除檔頭、去重），以**包含率** $\frac{|A\cap B|}{\min(|A|,|B|)}$ 計分；分數 ≥ 門檻即以**粉紅色粗虛線**配對，每個 commit 最多配一次（取分數高者優先）。用 min 當分母代表**子集也能高分**：例如 TOT 的某次提交同時改了兩個專案，而 personal branch 只改其中一個專案，共同專案的變更行被完全包含 → 接近 100%，仍會連起來。為避免極小 diff 誤判，少於 3 行變更的 commit 不參與。

**手動連結**：把滑鼠移到未配對（紅）的 commit 上，靠中央側會出現一個圓形節點 ◗；先點左邊一個、再點右邊一個即建立紫色手動連線。再次點擊已連結的節點可斷開，或選取該連線後按 `Delete` / `Backspace` 移除。手動連結以兩側 repo 路徑為 key 存進 `localStorage`，**打開一模一樣的 repro 會自動 RESUME 還原**（以 SHA 記錄，新增 commit 後仍可還原）。

**暫存位置**：手動連結存在 renderer 的 `localStorage`，key 為 `mlink:<左repo路徑>|<右repo路徑>`，value 為 `[{ leftSha, rightSha }, …]` 的 JSON。工具列上的紫色 **◗ Clear manual links** 按鈕（與手動連結同色）會一次取消目前 repro pair 的**所有手動連結並刪除該暫存**（有連結時顯示數量，無連結時 disabled）。

**註記與強制顏色暫存**：每列註記與強制背景顏色同樣以兩側 repo 路徑為 key 存進 `localStorage`——註記為 `note:<左repo路徑>|<右repo路徑>`、顏色為 `color:<左repo路徑>|<右repo路徑>`，value 皆為 `{ "<side>:<sha>": <值> }` 物件。工具列另有 **📝 Clear notes**、**🎨 Clear colors** 按鈕可分別一次清空。

**右鍵選單與詳情浮窗**：右鍵任一 commit 會跳出情境選單（新增/編輯註記、強制背景顏色綠/亮紅/藍/黃、清除顏色）。`Ctrl`+左鍵則開啟 commit 詳情浮窗：上方清楚標示 SHA / 作者 / 日期，內文以內建輕量 Markdown 渲染器（`src/lib/markdown.js`，先 HTML escape 再上標記，連結不導航以策安全）顯示；若該 commit 有配對，會以紫色高亮的 **Related item** 區塊顯示對側 commit，點擊可再開一個浮窗。浮窗右上角有 **HL** 輸入格，輸入字串會在該浮窗內即時高亮所有符合的文字（不區大小寫），且開啟時會自動帶入目前的全域搜尋字。浮窗可由標題拖曳移動、由任一邊/角拖拉縮放，初始寬度依內容長度自動估算，並可同時開啟多個（重複點同一 commit 不會重開），按 `Esc` 一次關閉全部。

**搜尋面板與註記導航**：`Ctrl`+`F` 開啟浮動可拖曳的搜尋面板，可選搜尋範圍（Title / Body / SHA / Author / Date）、以 ↑ / ↓ 或 `F3` / `Shift`+`F3` 循環命中項、以 Filter 只顯示命中列。面板下方另有一個與搜尋分開的 **📝 Notes** 導航區，以 ↑ / ↓ 在每個有註記的 commit 間跳躍（顯示列順序、左欄先於右欄），捲動置中並高亮。只要搜尋面板開啟，按 `Esc`（不論焦點在哪裡）即關閉面板並清空字串與高亮。

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
├─ electron/main.js      視窗建立、IPC handler、資料夾選擇對話框、Excel 匯出存檔對話框
├─ electron/preload.js   contextBridge 安全橋接，暴露 window.api（含 exportExcel）
├─ electron/git.js       呼叫系統 git，解析 git log → 結構化 commit；getPatchIds / getDiffTexts（Fuzzy 變更行）；gitOp 回傳完整 stdout/stderr 與 exit code
├─ electron/excel.js     ExcelJS 產生 styled .xlsx（顏色填滿、註記 cell 註解、SHA 超連結到遠端 commit URL、Manual Links 工作表）
└─ electron/db.js        better-sqlite3 快取層（缺少時自動退回記憶體快取）

Renderer (React + Vite)
├─ src/main.jsx                 React 入口
├─ src/App.jsx                  狀態管理、diff 計算、虛擬化捲動、過濾邏輯
├─ src/styles.css               HUD 深色主題樣式
├─ src/lib/diff.js              核心比對演算法（灰/紅/黃分類、連線、搜尋、左右對齊 alignLayout）
├─ src/lib/constants.js         版面常數（列高、gutter 寬、overscan…）
├─ src/assets/logo.svg          工具列 LOGO（青色 M2 字標）
└─ src/components/
   ├─ Toolbar.jsx          上方工具列：LOGO＋名稱、開啟 repo、branch 徽章、統計、Fuzzy Match 開關＋門檻、View 模式切換、搜尋、Clear manual/notes/colors、Export Excel
   ├─ RepoColumn.jsx       單欄虛擬化渲染（只畫視窗內的列）
   ├─ CommitRow.jsx        單一 commit 列（絕對定位 + 高亮 + 註記圖示 + 右鍵選單 + Ctrl點詳情）
   ├─ ConnectionLines.jsx  中央 gutter 的 SVG 連接線（端點同列時退化為水平線）
   ├─ SearchPanel.jsx      浮動可拖曳搜尋面板（可選搜尋範圍、上/下則、Filter，並含獨立的 📝 Notes 導航區）
   ├─ NotePopup.jsx        浮動註記編輯/檢視器（可拖曳）
   ├─ RowMenu.jsx          右鍵情境選單（註記 + 強制背景顏色 + 自訂取色第五色）
   ├─ RepoGitBar.jsx       每側 Git 操作列（pull / fetch…）
   ├─ GitTerminalPopup.jsx Git 操作結果浮窗（可拖曳，顯示指令/輸出/exit code，成功綠框失敗紅框）
   ├─ ExportPrompt.jsx     匯出前的筆數確認對話框（預設 ALL，或前 N 筆）
   └─ CommitDetail.jsx     Commit 詳情浮窗（Markdown 渲染、Related item、SHA 旁 🌐 Web 連結開遠端頁面、可移動縮放、可多開、💬 Chat 開 VS Code）
```

另有 `public/icon.svg`（透明背景、漸層 M 字標圖示，作為 favicon 與 Electron 視窗 / 工作列圖示）。執行 `node scripts/make-icon.mjs` 會由它產生多尺寸的 `public/icon.ico`，供 Windows 檔案總管右鍵選單與打包後的應用程式圖示使用。

**VS Code Chat 整合**：`CommitDetail.jsx` 的 💬 Chat 按鈕透過 `window.api.openInVSCodeChat` → 主行程 `vscode:chat` IPC，以 `where code.cmd` 解析 VS Code 路徑後執行 `code chat -r -m agent -`，commit 說明 prompt 經 **stdin**（非命令列，避免注入）串入；找不到 VS Code 時丟出 `VSCODE_NOT_FOUND`，由浮窗顯示提示。prompt 全程使用英文以避免 stdin 編碼造成的亂碼。

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

`computeDiff(left, right, patchIds, manualLinks, fuzzy)` 多階段：

1. **相同 commit（灰）**：以 SHA 建集合，兩邊都有同一 SHA → `status = 'common'`，建立 `type: 'common'` 連線。
2. **Cherry-pick — 標題（黃，虛線）**：把尚未被 SHA 配對的 commit 依「正規化標題」（`normalizeSubject`：去頭尾、小寫、空白壓縮）分組，左右同標題者依序配對 → `status = 'cherry'`，建立 `type: 'cherry'` 連線。
3. **Cherry-pick — 內容 / patch-id（黃，點線）**：對前兩步仍為 unique 的 commit，依 `git patch-id`（實際 diff 內容指紋）分組配對 → `status = 'cherry'`，建立 `type: 'patch'` 連線。即使標題被改寫，內容相同的 cherry-pick 也能配上。
4. **手動連結（紫）**：套用使用者建立的 `manualLinks`（見 §1），建立 `type: 'manual'` 連線。
5. **Fuzzy Match — 內容相似度（粉，粗虛線）**：僅在 `fuzzy.enabled` 時執行。對仍為 unique 的 commit，用 `fuzzy.diffTexts`（每個 sha 的變更行集合）兩兩計算**包含率** `inter / min(|A|,|B|)`，分數 ≥ `fuzzy.threshold` 即配對 → `status = 'fuzzy'`，建立 `type: 'fuzzy'` 連線；分數高者優先、每個 commit 最多配一次、少於 3 行者略過。
6. **獨有（紅）**：其餘維持 `status = 'unique'`。

回傳：`leftRows / rightRows`（每列含 `status`、`matchId`、`index`）、`links`、以及各邊統計 `{ common, cherry, unique, fuzzy }`。

`matchesQuery(commit, query)`：在 subject / body / sha / short / author / authorDate 做不分大小寫子字串比對。

### patch-id（內容）配對資料流

- `App.jsx` 第一輪 `computeDiff` 完成 SHA + 標題比對後，收集兩邊仍為 `unique` 的 commit，透過 IPC `repo:patchIds` 向主行程要 `git patch-id`。
- `electron/git.js` 的 `getPatchIds()` 採**批次**：整批 `git show` 一次 pipe 給 `git patch-id --stable`，總共僅兩次 git 呼叫（非每個 commit 兩次）。
- 取回的 `sha → patchId` 對應表回填後重算 `computeDiff`，把內容相同者補成黃色配對。全程 best-effort，失敗則退回標題比對。每個 sha 只查一次。

### Fuzzy Match（內容相似度）資料流

- 只有在工具列開啟 **≈ Fuzzy Match** 時才啟動。`App.jsx` 收集兩側仍為 `unique` 的 commit，透過 IPC `repo:diffTexts` 向主行程要各 commit 的變更行。
- `electron/git.js` 的 `getDiffTexts()` 以**單次** `git show`（NUL 分隔格式）抓回所有指定 sha 的 diff，僅保留 `+`/`-` 的內容行（排除 `+++`/`---` 檔頭），去重、保留正負號、每個 commit 最多 4000 行，回傳 `sha → string[]`。
- 取回的變更行快取在 `diffTexts`（per-sha，門檻調整不需重抓），連同門檻傳入 `computeDiff` 的 `fuzzy` 參數重算，把相似度 ≥ 門檻者補成**粉紅色**配對。全程 best-effort。

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
| `--manual-bd` | 紫：手動連結 |
| `--fuzzy-bg / --fuzzy-bd` | 粉紅：Fuzzy Match 內容相似度配對 |
| `--accent` | 青色強調色（HUD 發光） |
| `--row-h` | 列高 |

連線樣式：`.link.common`（灰實線）、`.link.cherry`（黃虛線）、`.link.patch`（黃點線，內容/patch-id 配對）、`.link.manual`（紫實線，手動連結）、`.link.fuzzy`（粉紅粗虛線，內容相似度配對）、`.link.selected`（加粗發光）、`.link.faded`（其餘變淡）。連線為**直角轉折**走線（`ConnectionLines.jsx`），並以透明加寬的 `.link-hit` 路徑承接點擊。

---

## 7. 開發與執行

### 須預先安裝的程式

| 程式 | 版本建議 | 用途 | 取得方式 |
| --- | --- | --- | --- |
| **Node.js**（內含 npm） | **18 LTS 以上**（建議 20/22 LTS） | 執行 Vite / Electron、安裝相依套件、產生 demo GIF | <https://nodejs.org/>（或 `winget install OpenJS.NodeJS.LTS`） |
| **Git** | 任意近期版本 | 本工具透過 `git` CLI 讀取兩個 repo 的紀錄；需在 `PATH` 中 | <https://git-scm.com/>（或 `winget install Git.Git`） |
| **PowerShell** | Windows 內建即可 | 執行下列指令與 `start.cmd` | 系統內建 |

> 選用：**Visual Studio C++ 工具集（含 ClangCL）** 僅在要啟用 `better-sqlite3` 持久化快取時才需要；未安裝時會自動退回記憶體快取，不影響功能（見下方「環境注意事項」）。

確認安裝：

```powershell
node -v      # 應顯示 v18 以上
npm -v
git --version
```

### 指令

```powershell
npm install          # 安裝相依套件
npm run dev          # 同時啟動 Vite (5173) 與 Electron（開發模式）
npm run build        # 建置 renderer 到 dist/
npm run dist         # electron-builder 打包（Windows NSIS）
npm run rebuild      # 為當前 Electron ABI 重編 better-sqlite3
npm run demo:gif     # 重新產生操作預覽動畫 public/demo.gif
```

> 產生應用程式圖示：`node scripts/make-icon.mjs` 會把 `public/icon.svg` 轉成多尺寸（16~256px、透明背景）的 `public/icon.ico`，供右鍵選單與打包圖示使用；改了 `icon.svg` 後重跑即可。

### 啟動與自動開啟 repro（-L / -R）

啟動時可帶入 `-L <path>` / `-R <path>`（亦接受 `--left` / `--right`）自動載入左右兩側 repro：

```powershell
# 一般模式（start.cmd：先 npm run build 再以 production 載入 dist/，啟動較快、無 dev server）
.\start.cmd -L "D:\path\to\repoA" -R "D:\path\to\repoB"

# 開發模式（start_dev.cmd：Vite dev server + Electron，含 HMR）
.\start_dev.cmd -L "D:\path\to\repoA" -R "D:\path\to\repoB"

# 已建置（production）或打包後的 exe
npx electron . -L "D:\path\to\repoA" -R "D:\path\to\repoB"
```

- **`start.cmd`（一般/production 模式）**：檢查 NPM / 修復 Electron → `npm run build` → `npm run start:prod`（`NODE_ENV=production`，載入 `dist/index.html`，無 Vite dev server）。
- **`start_dev.cmd`（開發模式）**：同樣的前置檢查後跑 `npm run dev`（Vite dev server + Electron，含 HMR）。
- `electron/main.js` 的 `parseRepoArgs()` 解析 argv；找不到時改讀環境變數 `REPRO_L` / `REPRO_R`。
- 兩個啟動腳本因參數無法穩定穿過 `concurrently → wait-on → electron`，皆改將 `-L`/`-R` 設成 `REPRO_L`/`REPRO_R` 環境變數轉傳。
- 相對路徑以啟動目錄解析。

### Windows 檔案總管右鍵整合（類似 Beyond Compare）

可在資料夾右鍵新增兩個選單項，達成「先選左邊、再選右邊比對」的兩段式流程，並自動帶入目錄啟動 M2 GIT DIFF：

- **Select Folder for M2 GIT DIFF** — 記住此資料夾為左側（`-L`）。
- **Compare in M2 GIT DIFF** — 以剛才記住的資料夾為 `-L`、目前資料夾為 `-R` 啟動比對。

安裝 / 移除（**HKCU 寫入，免系統管理員**）：

```powershell
# 安裝右鍵選單
powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-context-menu.ps1

# 移除右鍵選單
powershell -NoProfile -ExecutionPolicy Bypass -File tools\uninstall-context-menu.ps1
```

運作方式：

- 選單項註冊在 `HKCU\Software\Classes\Directory\shell`（在資料夾上右鍵）與 `Directory\Background\shell`（在資料夾空白處右鍵），故**不需管理員權限**。
- 兩段式狀態由 `tools\m2gitdiff-launcher.ps1` 處理：「Select」會把左側路徑寫入 `%LOCALAPPDATA%\M2_GIT_DIFF\left-folder.txt`；「Compare」讀回該路徑，呼叫 `start.cmd -L <左> -R <目前>` 啟動，完成後清除狀態。
- 若尚未選擇左側就按 Compare，會跳出提示訊息。
- 選單會指向 `tools\` 內的腳本與專案根的 `start.cmd`，因此**請勿移動專案資料夾**；若移動了，重新執行 `install-context-menu.ps1` 即可更新路徑。
- 選單圖示使用 `public\icon.ico`（由 `node scripts/make-icon.mjs` 自 `public/icon.svg` 產生）；若該檔不存在則退回 PowerShell 內建圖示。Windows 右鍵選單僅支援 `.ico` / `.exe` / `.dll` 圖示，不吃 SVG/PNG，故需先轉檔。

### 環境注意事項（本機已知狀況）

1. **better-sqlite3 無法編譯**：本機缺少 Visual Studio 的 *ClangCL* 工具集，原生模組編不過。已將其設為 `optionalDependencies`，`db.js` 偵測不到時會自動退回**記憶體快取**，功能不受影響。若要啟用持久化快取：安裝 ClangCL（或在 VS 安裝程式勾選對應工具集）後執行 `npm run rebuild`。
2. **Electron 二進位在 `Z:` 網路磁碟解壓失敗**：安裝後的 postinstall 在 `Z:` 上靜默失敗。處置方式：用 PowerShell `Expand-Archive` 把快取中的 `electron-vXX-win32-x64.zip` 解到 `node_modules/electron/dist`，並建立 `node_modules/electron/path.txt`（內容 `electron.exe`）。重裝 `node_modules` 後需重做，或執行 `node node_modules/electron/install.js`。
3. DevTools 的 `Autofill.enable` / GPU 警告為無害雜訊，可忽略。

---

## 8. 快捷鍵與互動操作

| 按鍵 / 操作 | 作用 |
| --- | --- |
| `Ctrl` + `F` | 跳到搜尋框並全選現有字串（開始搜尋） |
| `Alt` + `F` | 開啟資料夾選擇器載入 repo：左側未載入時先選**左邊**，左側已載入則選**右邊**（兩邊都載入時仍重選右邊） |
| `Esc`（搜尋面板開啟時，任何焦點） | 關閉搜尋面板，同時清空搜尋字與高亮、焦點回到比對區 |
| `F3` | 循環跳到**下一個**搜尋命中的 commit，捲動置中並以青色外框高亮 |
| `Shift` + `F3` | 循環跳到**上一個**搜尋命中的 commit |
| 搜尋面板 📝 Notes  ↑ / ↓ | 在每個有註記的 commit 間跳躍（與搜尋功能分開），捲動置中並高亮 |
| Commit 詳情浮窗右上 HL 輸入格 | 在該浮窗內即時高亮符合的文字；開啟時自動帶入目前搜尋字 |
| `Esc`（焦點在比對區時） | 取消目前選取的連線、取消進行中的手動連結、關閉所有詳情浮窗
| `Delete` / `Backspace` | 刪除目前選取的**手動連結** |
| 點擊有連線的列 / 點擊連接線 | 高亮該配對連線，其餘變淡；焦點移到比對區 |
| 點擊空白處 | 取消選取與進行中的手動連結 |
| 點擊節點 ◗（未配對列） | 開始 / 完成 / 斷開手動連結（左右各點一個） |
| `Ctrl` + 左鍵點 commit | 開啟該 commit 的詳情浮窗（可多開；重複點同一個不重開） |
| 右鍵點 commit | 跳出情境選單：新增/編輯註記、強制背景顏色（綠/亮紅/藍/黃）、清除顏色 |
| 點 commit 上的 📝 圖示 | 檢視 / 編輯 / 刪除該列註記 |
| 工具列 ≈ Fuzzy Match 開關 / 門檻框 | 開關內容相似度模糊配對；門檻框設定相似度百分比（0–100%，預設 80%） |
| 工具列 View（Compare / Left only / Right only） | 切換雙邊比對或單邊放大模式 |
| 工具列 ◗ Clear manual links / 📝 Clear notes / 🎨 Clear colors | 一次清除目前 repro pair 的手動連結 / 註記 / 強制顏色及其 `localStorage` 暫存 |
| 工具列 ⬇ Export Excel | 匯出對齊後的 commit＋顏色＋註記＋手動連結為 `.xlsx`（先詢問筆數，預設 ALL） |
| 右鍵選單最後的取色器 | 自訂任意顏色套用該列，並記成全域第五個快速色票 |

> `F3` 的循環順序為顯示列由上到下、同列時左欄先於右欄；命中集合改變（修改搜尋字）時游標自動歸零。`Ctrl`+`F` 與 `F3` 在全域監聽，即使焦點在搜尋框內也有效。`Esc` 在全域監聽：只要搜尋面板開啟，不論焦點在哪裡都會關閉它。搜尋面板下方的 **📝 Notes** 區塊與搜尋完全分開，以 ↑ / ↓ 在所有有註記的 commit 間跳躍（顯示列順序、左欄先於右欄）。

---

## 9. 安全性

- `contextIsolation: true`、`nodeIntegration: false`，renderer 僅透過 preload 的 `window.api` 取得受限介面。
- `index.html` 設有 CSP。
- git 指令一律用 `execFile`（陣列參數，非 shell 字串），避免命令注入。
- VS Code Chat 整合的 commit 內容一律經 **stdin** 串給 `code chat`（命令列僅含固定/白名單參數），避免 shell 注入。

---

## 10. 後續可擴充方向


- 指定分支 / 標籤 / 日期範圍載入（`getCommits` 已支援 `branch`、`limit` 參數）。
- 匯出比對結果（CSV / Markdown）。Excel（.xlsx）匯出**已實作**（顏色、註記、手動連結，見 §1）。
- 兩邊 commit 點選後顯示完整 **diff 內容**（目前 Ctrl+點選已可顯示 commit 訊息與 metadata 詳情，尚未含逐行 diff；亦可用 💬 Chat 交給 VS Code Copilot 解說）。

---

## 11. 檔案速查表

| 我想改… | 去這裡 |
| --- | --- |
| 顏色 / 分類規則 | `src/lib/diff.js`（`computeDiff`） |
| Fuzzy Match（相似度配對 / 包含率） | `src/lib/diff.js`（`computeDiff` 第 5 階段、`containment`）、`electron/git.js`（`getDiffTexts`）、`src/App.jsx`（`fuzzyEnabled`/`fuzzyThreshold`/`diffTexts`）、`src/components/Toolbar.jsx`（`fuzzy-toggle`） |
| 左右對齊邏輯 | `src/lib/diff.js`（`alignLayout` / `longestIncreasingByPr`） |
| 顏色數值 / 主題 | `src/styles.css`（`:root` 變數） |
| 列高 / overscan / 預設筆數 | `src/lib/constants.js` |
| 工具列 / 搜尋 / Filter 按鈕 | `src/components/Toolbar.jsx` |
| LOGO 圖樣 | `src/assets/logo.svg`、`public/icon.svg` |
| 左右欄欄位排版（order） | `src/styles.css`（`.repo-column[data-side='R']`） |
| 連接線畫法（直角轉折 / 可點選） | `src/components/ConnectionLines.jsx` |
| 選取 focus / Esc / 點空白取消 | `src/App.jsx`（`handleSelect` / `onBodyClick` / keydown） |
| 快捷鍵（Ctrl+F / Esc / F3） | `src/App.jsx`（`cycleHit` / keydown / `onSearchKeyDown` / `closeSearch`） |
| 浮動搜尋面板 / 📝 Notes 導航 | `src/components/SearchPanel.jsx`、`src/App.jsx`（`noteHits` / `cycleNote`） |
| 註記（Note）浮窗 / 邏輯 | `src/components/NotePopup.jsx`、`src/App.jsx`（`openNote`/`saveNote`/`deleteNote`/`clearNotes`） |
| 右鍵選單 / 強制顏色 | `src/components/RowMenu.jsx`、`src/App.jsx`（`openRowMenu`/`setColor`/`clearColors`）、`src/styles.css`（`.commit-row.force-*`） |
| Commit 詳情浮窗 / Markdown / HL 高亮 | `src/components/CommitDetail.jsx`、`src/lib/markdown.js`、`src/App.jsx`（`openDetail`/`resolveDetail`/`details`） |
| 可點擊 commit 連結（🌐 Web / 遠端 URL） | `src/components/CommitDetail.jsx`、`electron/git.js`（`getRemoteUrl` / `loadRepo` remoteUrl）、`electron/main.js`（`shell:openExternal`）、`electron/excel.js`（SHA 超連結） |
| VS Code Chat 整合（💬 Chat） | `src/components/CommitDetail.jsx`（`openInChat`）、`electron/preload.js`（`openInVSCodeChat`）、`electron/main.js`（`vscode:chat` / `resolveCodeCommand`） |
| 應用程式圖示產生（SVG→ICO） | `scripts/make-icon.mjs`、`public/icon.svg`、`public/icon.ico` |
| 單一 Repo（View）模式 | `src/App.jsx`（`single` 狀態、`view` useMemo）、`src/components/Toolbar.jsx`、`src/styles.css`（`.repo-column.plain`） |
| 手動連結（節點 / 暫存 / RESUME / Clear） | `src/App.jsx`（`onNode` / `manualLinks` / `clearManualLinks` / localStorage）、`src/lib/diff.js`（manual 階段） |
| 虛擬化渲染 | `src/components/RepoColumn.jsx` |
| git log 解析欄位 / patch-id | `electron/git.js` |
| 快取邏輯 | `electron/db.js` |
| 視窗 / IPC / CLI 參數 / App 名稱與圖示 | `electron/main.js` |
| 啟動檢查 / Electron 修復 / -L -R 轉傳 | `start.cmd`（一般/production）、`start_dev.cmd`（開發）、`repair-electron.ps1` |
