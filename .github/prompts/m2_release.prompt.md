---
description: PR-based CI release — bump version, open & merge PR, tag, push tag; CI builds & publishes.
mode: agent
---

# Release

**觸發**：`/m2_release`、`/m2_release <version>`

- `/m2_release` → 依規則自動計算下一版號
- `/m2_release 0.4.1` → 使用指定版號，跳過第 1 節計算

執行一次完整發版。流程為 **bump → PR → merge → tag → push tag → CI publish**。

## 0. 先對齊 repo 慣例（必做，不可略過）

在動手前先讀出既有慣例，所有格式一律沿用歷史紀錄，不自創：

```bash
git tag --sort=-v:refname | head -10          # tag 格式（有無 v 前綴、是否 annotated）
gh pr list --state merged --limit 10           # release PR 的 title / body 格式
git log --oneline -15                          # commit message 格式
ls .github/workflows/                          # 確認 publish workflow 的觸發條件
```

- 從 workflow 檔確認 **publish 是由 tag push 觸發**，以及 tag pattern（例如 `v*` 或 `v[0-9]+.*`）。
- 確認版本號來源檔案（`package.json` / `pyproject.toml` / `Cargo.toml` / `manifest.json` / `__init__.py`…），可能有多處需同步。

## 1. 計算下一版號

規則：**patch 逐一遞增，滿 9 進位到 minor**。

```text
patch < 9                 → patch + 1              0.3.0 → 0.3.1
patch == 9                → minor + 1, patch = 0   0.3.9 → 0.4.0
minor == 9 且 patch == 9  → major + 1, 其餘歸零     0.9.9 → 1.0.0
```

- 以「目前 main 上的版本號」為基準，不以最新 tag 為基準（若兩者不一致，先停下來回報）。
- 若使用者已指定版號，直接採用，跳過計算。

## 2. Bump 版本

```bash
git switch main
git pull --ff-only
git switch -c release/<NEW_VERSION>
```

- 更新**所有**版本號出現的位置（含 lock file，若專案有 commit lock file 的慣例）。
- 若 repo 有 `CHANGELOG.md`，依既有格式新增一節，內容取自上一個 tag 至今的 commit：
  ```bash
  git log <LAST_TAG>..HEAD --oneline --no-merges
  ```
- **這個 PR 只做版本變更**，不夾帶任何功能或修正。

```bash
git commit -am "chore(release): bump version to <NEW_VERSION>"   # 格式沿用 repo 歷史
git push -u origin release/<NEW_VERSION>
```

## 3. 開 PR 並合併

```bash
gh pr create --base main --title "<沿用歷史格式>" --body "<摘要 + 變更清單>"
gh pr checks --watch          # 等 CI 綠燈，失敗則停止並回報
gh pr merge --squash --delete-branch
```

> ⏸ **合併前停下來**，回報「將要發布的版號 + PR 連結 + 變更檔案清單」，並**以可點選按鈕**請使用者確認：**[Confirm release] / [取消]**（不要求打字，打字僅作備援）。點 **[Confirm release]** 即為授權合併。
> （若要全自動，刪除此行。）

## 4. 打 tag 並推送

```bash
git switch main
git pull --ff-only            # 確認 HEAD 已包含剛合併的 bump commit
git tag -a <TAG> -m "<MSG>"   # 格式沿用歷史，通常為 v<NEW_VERSION>
git push origin <TAG>
```

- **tag 必須指向合併後的 main HEAD**，不可在 PR 分支或合併前打 tag。
- 推送 tag 前確認 `git log -1` 的 commit 就是版本 bump commit。

## 5. 驗證

```bash
gh run watch                  # 追蹤 publish workflow
gh release view <TAG>         # 若 workflow 會建立 release
```

回報：版號、tag、PR 連結、CI run 連結、發布結果。

---

## 硬性規則

- 不直接 push 到 `main`，一律走 PR。
- 不在本機手動 `npm publish` / 上傳產物 — **發布只由 CI 執行**。
- CI 失敗時停止流程並回報，不重試、不繞過、不改 workflow 來讓它通過。
- tag 已存在時停止並回報，不使用 `-f` 覆寫、不刪除既有 tag。
- 版本號格式、tag 格式、commit / PR 文案一律比對 repo 歷史後沿用。
- 任何步驟出現與預期不符（版本號不一致、branch 非乾淨、pull 非 fast-forward）→ 停下來回報，不自行修補。
