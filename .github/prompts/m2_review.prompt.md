---
description: Self code review before opening a PR — inspect the diff, report findings by severity with file:line, suggest fixes without applying them.
mode: agent
---

# Review

**觸發**：`/m2_review`、`/m2_review staged`、`/m2_review <檔案或路徑>`、`/m2_review fix`

- `/m2_review` → review 當前分支相對 `main` 的所有變更（預設）
- `/m2_review staged` → 只 review 已 staged 的變更
- `/m2_review <path>` → 只 review 指定檔案或目錄
- `/m2_review fix` → review 後**逐項確認**再修（見第 5 節）

> 用途：在 `/m2_pr` 之前先自我把關。此流程**不修改任何程式碼**（除 `/m2_review fix`）。

---

## 0. 先對齊專案規範（必做，不可略過）

```bash
cat .github/copilot-instructions.md 2>/dev/null          # 專案編碼規範
ls .github/instructions/ 2>/dev/null                     # 路徑範圍規範
ls .eslintrc* eslint.config.* .prettierrc* 2>/dev/null   # 已自動化的檢查
cat package.json 2>/dev/null | grep -A5 '"scripts"'      # lint / test 指令
```

- **規範以專案檔案為準**，不套用通用最佳實踐去否定既有寫法。
- linter / formatter 已能抓到的問題（縮排、引號、分號、未使用變數）**不列入 review**，交給工具。
- 先跑一次既有檢查，有失敗先回報：
  ```bash
  npm run lint 2>/dev/null; npm test 2>/dev/null
  ```

## 1. 取得 review 範圍

```bash
git branch --show-current
git diff main...HEAD --stat        # 預設範圍
git diff main...HEAD               # 實際內容
# /m2_review staged 時改用：git diff --cached
```

- 只 review **本次變更的內容**，不對未改動的既有程式碼提出重構建議（除非它直接導致本次變更有 bug）。
- diff 過大（>1000 行）時：先列出檔案清單與各檔重點，詢問要優先深入哪些檔案。

## 2. Review 檢查維度

依序檢查，**每一項都要實際看過 diff 才下結論**：

**正確性**
- 邏輯是否符合宣稱的意圖？與 commit message / 函式名稱是否一致？
- 邊界條件：空值、`null`/`undefined`、空陣列、單一元素、極大值、負數、重複值
- off-by-one、迴圈邊界、非同步競態（race condition）、未 await 的 Promise
- 型別隱含轉換（`==`、`+` 字串數字混用、`parseInt` 未給 radix）

**錯誤處理**
- 外部輸入（檔案、API、使用者輸入、DB）是否驗證後才使用？
- 是否有空 `catch {}` 或靜默降級？錯誤訊息是否足以定位問題？
- 失敗路徑是否會留下不一致狀態（半寫入的檔案、未 rollback 的交易）？

**安全性**
- diff 中是否出現帳號、密碼、token、API key、內部 IP、客戶機密資料？（**Blocker**）
- SQL 是否參數化？有無字串拼接？
- 前端是否用 `innerHTML` 塞使用者資料？路徑是否可被穿越（`../`）？

**一致性**
- 命名、檔案結構、錯誤處理方式是否與 repo 既有寫法一致？
- 是否引入了專案未使用的框架、抽象層或新相依套件？理由是否充分？

**可維護性**
- 是否有殘留 `console.log`、`debugger`、註解掉的舊程式碼、測試用假資料？
- 函式是否過長或承擔多重責任？重複邏輯是否應抽出？
- 公開函式是否缺少必要的型別/用途說明？

**影響範圍**
- 是否為 breaking change（API signature、資料格式、設定項、DB schema）？
- 是否有其他呼叫端需要同步修改？（`grep` 確認，不憑印象）
- 是否需要對應的測試？既有測試是否仍然有效？

## 3. 輸出格式

依嚴重度分級，**每一項都要有 `檔案:行號`、問題、建議修法**：

```markdown
## Review：<branch> → main
變更：<N> files, +<X>/-<Y>

### 🔴 Blocker（必須修才能開 PR）
1. **`src/api/user.js:42`** — SQL 字串拼接，可被注入
   → 改用 prepared statement：`db.prepare('SELECT * FROM users WHERE id = ?').get(id)`

### 🟡 Should fix（建議修）
1. **`src/parse.js:118`** — `rows[0]` 未檢查空陣列，輸入空檔案會拋 TypeError
   → 前置 `if (!rows.length) return [];`

### 🔵 Nit（可選）
1. **`src/util.js:7`** — 函式名 `getData` 語意過寬，建議 `fetchScheduleRows`

### ✅ 檢查通過
- 無機密資訊外洩
- 命名與既有寫法一致
- 無殘留 debug 程式碼

### 結論
<可以開 PR / 修完 Blocker 後再開 PR>
```

## 4. Review 品質要求

- **沒問題就說沒問題。** 不為了顯得有產出而硬湊意見或把偏好包裝成問題。
- 每個 Blocker / Should fix 都要能說明**具體會出什麼錯**，不用「建議改善」這種空話。
- 區分「錯誤」與「個人偏好」，後者一律歸 Nit 並標明是偏好。
- 不確定的地方明說不確定，並指出需要人工確認什麼。
- 不重複 linter 已抓到的問題。
- 建議修法要能直接套用，不寫「可以考慮重構一下」。

## 5. `/m2_review fix` 的行為

僅在使用者明確使用 `/m2_review fix` 時才修改程式碼：

1. 先完整輸出第 3 節的 review 結果。
2. **逐項等待確認**再修，一次只處理一項，不批次全改。確認一律**以可點選按鈕**呈現，例如 **[修這項] / [略過] / [剩下的全修]**，不要求使用者打字。
3. 只修 Blocker 與已確認的 Should fix；Nit 一律不動。
4. 採最小變更，不順手重排或格式化無關區塊。
5. 修完後回報 `git diff --stat`，不自行 commit。

---

## 硬性規則

- 預設**不修改任何程式碼、不 commit、不 push、不開 PR**。
- 不對未變更的既有程式碼提出重構建議（除非直接造成本次變更的 bug）。
- 不以通用最佳實踐否定專案既有慣例；規範衝突時以 `copilot-instructions.md` 為準。
- 不編造未實際確認的影響範圍 —「其他呼叫端」必須 `grep` 過才寫。
- 不輸出無資訊量的稱讚段落。
- 發現機密資訊外洩 → 直接列為 Blocker 並明確指出檔案與行號，同時提醒若已 commit 需改寫歷史。
