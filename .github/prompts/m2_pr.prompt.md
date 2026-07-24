---
description: Open a pull request from the current branch — inspect changes, write title/body matching repo history, create PR, then poll status checks every 3s and alert the user to confirm merge.
mode: agent
---

# Pull Request

**觸發**：`/m2_pr`、`/m2_pr draft`、`/m2_pr <補充說明>`

- `/m2_pr` → 從當前分支開一個 ready-for-review 的 PR
- `/m2_pr draft` → 開成 draft PR
- `/m2_pr <說明>` → 將補充說明納入 PR body 的動機段落

> 發版用的版本 bump PR 請用 `/m2_release`，不要走這支流程。

---

## 0. 先對齊 repo 慣例（必做，不可略過）

```bash
gh pr list --state merged --limit 10                    # title / body 慣例、語言（中/英）
gh pr view <最近一個 PR 編號>                             # body 段落結構、有無 checklist
ls .github/PULL_REQUEST_TEMPLATE* .github/pull_request_template.md 2>/dev/null
cat .github/CODEOWNERS 2>/dev/null                      # 需指定的 reviewer
gh label list                                           # 可用 label
```

- **有 PR template 就必須沿用**，不自創段落結構。
- title 語言、body 語言、有無 emoji、有無 issue 連結格式，一律比對歷史後沿用。

## 1. 收集變更內容

```bash
git status --short                                      # 確認無未 commit 變更
git branch --show-current
git log --oneline --no-merges main..HEAD                # 本分支的 commit
git diff main...HEAD --stat                             # 變更範圍
git diff main...HEAD                                    # 實際內容（大型 diff 可只讀關鍵檔案）
```

- **必須讀過實際 diff 才寫 PR 描述**，不可只依 commit message 推測。
- 若 commit 數量多且訊息雜亂，在 body 中依「功能面」重組敘述，不逐一列 commit。

## 2. 前置檢查（任一項不通過 → 停止並回報）

- [ ] 當前分支**不是** `main`
- [ ] working tree 乾淨（無未 commit 變更）
- [ ] 已同步 main：`git fetch origin && git log origin/main..HEAD` 確認可乾淨合併
- [ ] diff 中無帳號、密碼、token、API key、內部 IP、客戶機密資料
- [ ] 無殘留 `console.log` / `debugger` / 註解掉的舊程式碼 / 測試用假資料
- [ ] 變更範圍聚焦，無夾帶不相關的格式化或重排
- [ ] 已存在同分支的 open PR？→ 改為更新既有 PR，不重複建立

若分支尚未推送：

```bash
git push -u origin $(git branch --show-current)
```

## 3. 撰寫 PR title 與 body

**title**：沿用 repo 慣例；若歷史為 Conventional Commits，格式為

```text
<type>(<scope>): <subject>
```

- 英文、動詞原形開頭、不超過 72 字元、句尾不加句號。
- 不寫 `update code`、`fix bug` 這類無資訊量的標題。

**body**：優先使用 repo 的 PR template。若無 template，使用下列結構（內容語言沿用 repo 慣例）：

```markdown
## What
<改了什麼，2–4 句，以行為/結果描述，非檔案清單>

## Why
<動機。有 issue 就寫 `Closes #123`>

## How
- <關鍵實作決策，或非顯而易見的取捨>
- <若有替代方案被排除，說明原因>

## Impact
- 影響範圍：<模組 / 使用者可見行為 / 相容性>
- Breaking change：<有/無，有則說明遷移方式>

## Verification
- [ ] <實際做過的驗證步驟，非「應該可以」>
- [ ] CI passed
```

- **不編造未執行的測試**。沒測就寫「未測試，需 reviewer 協助驗證」。
- UI 變更請提示使用者補截圖，agent 不自行宣稱已附圖。

## 4. 建立 PR

```bash
gh pr create \
  --base main \
  --title "<TITLE>" \
  --body "<BODY>" \
  --assignee @me
# 需要時追加：--draft / --label <label> / --reviewer <user>
```

- reviewer 依 CODEOWNERS 或歷史慣例指定；不確定則留空並回報。
- label 只從 `gh label list` 的既有清單挑選，不新建 label。

## 5. 持續監控 CI（**每 3 秒輪詢，直到有結論**）

PR 建立後**立即開始監控，不可跳過、不可只查一次就回報**。

### 主要方式

```bash
gh pr checks --watch --interval 3
```

### 備用輪詢（`--watch` 不可用，或需要自行控制回報節奏時）

PowerShell：

```powershell
$pr = gh pr view --json number -q .number
$deadline = (Get-Date).AddMinutes(30)
while ((Get-Date) -lt $deadline) {
    $checks = gh pr view $pr --json statusCheckRollup -q '.statusCheckRollup[] | "\(.name)=\(.status):\(.conclusion)"'
    Write-Host "[$(Get-Date -f HH:mm:ss)] $checks"
    if ($checks -notmatch 'IN_PROGRESS|QUEUED|PENDING') { break }
    Start-Sleep -Seconds 3
}
```

Bash：

```bash
PR=$(gh pr view --json number -q .number)
for i in $(seq 1 600); do
  S=$(gh pr view "$PR" --json statusCheckRollup \
      -q '.statusCheckRollup[] | "\(.name)=\(.status):\(.conclusion)"')
  echo "[$(date +%T)] $S"
  echo "$S" | grep -qE 'IN_PROGRESS|QUEUED|PENDING' || break
  sleep 3
done
```

### 狀態處理規則

| 狀態 | 行為 |
|---|---|
| `QUEUED` / `IN_PROGRESS` / `PENDING` | **繼續輪詢**，每 3 秒一次；每 30 秒向使用者回報一次進度（哪些 check 還在跑、已耗時多久） |
| 全部 `SUCCESS` / `NEUTRAL` / `SKIPPED` | 停止輪詢 → 進入第 6 節，**發出提醒並等待使用者確認** |
| 任一 `FAILURE` / `TIMED_OUT` / `CANCELLED` | **立即停止輪詢**，讀取失敗 job 的 log，回報根本原因與建議修法 |
| 超過 30 分鐘仍未結束 | 停止輪詢，回報目前狀態與卡住的 check 名稱，詢問是否繼續等待 |

- 失敗時：`gh run view <run-id> --log-failed` 取得實際錯誤。
- **不自行重跑到過**、不改 workflow 繞過、不加 `continue-on-error`、不 `--admin` 略過保護規則。

## 6. Status check 通過 → 提醒使用者確認合併

所有 status check 通過後，**必須主動發出明顯提醒**，然後停下來等待。

```powershell
[console]::beep(880,200); [console]::beep(1320,300)   # 提示音
```

輸出格式：

```markdown
🔔 **CI 全部通過 — 等待你確認合併**

- PR：#<N> <title>
- 連結：<url>
- Status checks：✅ <N>/<N> passed（耗時 <mm:ss>）
  - build ✅ / test ✅ / lint ✅
- 變更：<N> files, +<X>/-<Y>
- Reviewer：<user 或「未指定」>
- 待人工確認：<截圖 / 手動驗證項目 / 無>

👉 **請按下 GitHub 上的 Confirm merge 按鈕**，或回覆 `confirm merge` 由我代為執行：
`gh pr merge <N> --squash --delete-branch`
```

### 合併規則（重要）

- **agent 不主動合併。** 一律等到使用者按下 GitHub 的 Confirm merge 按鈕，或在對話中明確回覆 `confirm merge` / `合併`。
- 使用者回覆「OK」、「好」、「可以」等模糊字眼**不視為合併授權** → 再確認一次。
- 代為合併時，merge 策略（`--squash` / `--rebase` / `--merge`）依 repo 歷史慣例判斷，不自行選擇。
- 合併後回報：merge commit SHA、分支是否已刪除、後續建議（例如是否要跑 `/m2_release`）。

## 7. 回報

輸出：PR 連結、title、變更檔案數、CI 狀態與耗時、指定的 reviewer、待人工補齊的項目（截圖、手動驗證）、目前停在哪一步等待什麼。

---

## 硬性規則

- 不直接 push 到 `main`。
- **不自行 merge PR。** 必須等使用者按下 Confirm merge 按鈕，或在對話中明確回覆 `confirm merge`；模糊回覆不算授權。
- PR 建立後**必須持續監控至有明確結論**（全過 / 有失敗 / 逾時），不可只查一次就結束回合。
- 不在開 PR 的過程中順手修改程式碼；發現問題先回報，由使用者決定。
- 不 force push 已被 review 過的分支（必要時改用新 commit）。
- PR body 中不出現機密資訊、客戶專案代號、成本數字。
- title / body 格式一律比對 repo 歷史後沿用，不自創風格。
- 任何前置檢查未通過 → 停下來回報，不自行修補後繼續。
