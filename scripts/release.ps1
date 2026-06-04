# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
<#
.SYNOPSIS
    One-command release automation for M2_GIT_DIFF.

.DESCRIPTION
    Builds the Windows NSIS installer and publishes a GitHub Release with the
    artifact attached. Handles the known electron-builder winCodeSign symlink
    extraction failure on Windows automatically.

    Steps:
      1. Verify clean working tree on the target branch (default: main)
      2. (Optional) bump the version in package.json
      3. Pre-extract the winCodeSign cache (skips the darwin symlinks that fail)
      4. npm install + npm run rebuild (native better-sqlite3) + npm run dist
      5. git tag vX.Y.Z and push
      6. gh release create + upload the installer

.PARAMETER Version
    Explicit version to release, e.g. "0.2.0". If omitted, uses the current
    version in package.json.

.PARAMETER Bump
    Auto-bump the package.json version: patch | minor | major.
    Ignored if -Version is supplied.

.PARAMETER Notes
    Release notes (markdown). If omitted, a default note is generated.

.PARAMETER Branch
    Branch the release is cut from. Default: main.

.PARAMETER SkipPush
    Build and tag locally but do NOT push the tag or create the GitHub release.
    Useful for a dry build to verify the installer first.

.EXAMPLE
    npm run release
    # Re-releases the current package.json version.

.EXAMPLE
    powershell -File scripts/release.ps1 -Bump minor
    # Bumps 0.1.0 -> 0.2.0, builds, tags, and publishes.

.EXAMPLE
    powershell -File scripts/release.ps1 -Version 1.0.0 -Notes "First stable."
#>
[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,
    [string]$Notes,
    [string]$Branch = 'main',
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- 0. Tool checks -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found in PATH.' }
if (-not $SkipPush -and -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail 'gh (GitHub CLI) not found. Install it or run with -SkipPush.'
}

# --- 1. Branch + clean tree ----------------------------------------------
Write-Step 'Checking git state'
$current = (git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) { Fail "Not on '$Branch' (currently on '$current'). Checkout $Branch first." }
if ((git status --porcelain)) { Fail 'Working tree is dirty. Commit or stash changes before releasing.' }

git pull --ff-only
if ($LASTEXITCODE -ne 0) { Fail 'git pull failed.' }

# --- 2. Resolve version ---------------------------------------------------
Write-Step 'Resolving version'
$pkgPath = Join-Path $repoRoot 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$currentVersion = $pkg.version

if (-not $Version) {
    if ($Bump) {
        $parts = $currentVersion.Split('.')
        [int]$maj = $parts[0]; [int]$min = $parts[1]; [int]$pat = $parts[2]
        switch ($Bump) {
            'major' { $maj++; $min = 0; $pat = 0 }
            'minor' { $min++; $pat = 0 }
            'patch' { $pat++ }
        }
        $Version = "$maj.$min.$pat"
    }
    else {
        $Version = $currentVersion
    }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "Version '$Version' is not semver (X.Y.Z)." }
$tag = "v$Version"
Write-Host "Releasing $tag (was $currentVersion)" -ForegroundColor Green

# Write version back if it changed
if ($Version -ne $currentVersion) {
    Write-Step "Updating package.json version -> $Version"
    # Preserve formatting: targeted replace of the version line
    $raw = Get-Content $pkgPath -Raw
    $raw = $raw -replace '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}"
    Set-Content -Path $pkgPath -Value $raw -NoNewline
    # Sync package-lock.json to the new version so it doesn't show up as a
    # stray change on the next install. --package-lock-only avoids touching
    # node_modules.
    npm install --package-lock-only --no-audit --no-fund | Out-Null
    git add package.json package-lock.json
    git commit -m "chore(release): $tag"
}

# Guard: tag must not already exist
$existing = git tag --list $tag
if ($existing) { Fail "Tag $tag already exists. Pick a new version." }

# --- 3. Pre-extract winCodeSign cache (Windows symlink workaround) --------
Write-Step 'Preparing winCodeSign cache'
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$signDir = Join-Path $cache 'winCodeSign-2.6.0'
$sevenZip = Join-Path $repoRoot 'node_modules\7zip-bin\win\x64\7za.exe'
if (-not (Test-Path $signDir)) {
    $archive = Get-ChildItem -Path $cache -Filter '*.7z' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($archive -and (Test-Path $sevenZip)) {
        Write-Host "Extracting $($archive.Name) without darwin symlinks..."
        & $sevenZip x $archive.FullName "-o$signDir" "-xr!darwin" -y | Out-Null
    }
    else {
        Write-Host 'winCodeSign archive or 7za not present yet; electron-builder will download it. If it fails on symlinks, re-run this script.' -ForegroundColor Yellow
    }
}
else {
    Write-Host 'winCodeSign-2.6.0 already cached.'
}

# --- 4. Build -------------------------------------------------------------
Write-Step 'Installing dependencies'
npm install
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }

Write-Step 'Rebuilding native modules'
npm run rebuild
if ($LASTEXITCODE -ne 0) { Fail 'npm run rebuild failed.' }

Write-Step 'Building installer (npm run dist)'
npm run dist
if ($LASTEXITCODE -ne 0) { Fail 'npm run dist failed.' }

$installer = Join-Path $repoRoot "release\M2_GIT_DIFF Setup $Version.exe"
if (-not (Test-Path $installer)) { Fail "Installer not found at: $installer" }
$sizeMB = [math]::Round((Get-Item $installer).Length / 1MB, 1)
Write-Host "Built: $installer ($sizeMB MB)" -ForegroundColor Green

if ($SkipPush) {
    Write-Step 'SkipPush set - stopping before tag/publish'
    Write-Host "Local build ready. Installer: $installer" -ForegroundColor Green
    exit 0
}

# --- 5. Tag + push --------------------------------------------------------
Write-Step "Tagging $tag"
if ($Version -ne $currentVersion) { git push }   # push the version-bump commit
git tag $tag
git push origin $tag
if ($LASTEXITCODE -ne 0) { Fail 'Pushing tag failed.' }

# --- 6. GitHub release ----------------------------------------------------
Write-Step "Creating GitHub release $tag"
if (-not $Notes) {
    $Notes = @"
Release $tag of M2_GIT_DIFF - side-by-side commit history comparison for two local Git repositories.

## Install
Download and run **M2_GIT_DIFF Setup $Version.exe** (Windows x64).

> The installer is not code-signed, so Windows SmartScreen may warn on first run - choose *More info -> Run anyway*.
"@
}

gh release create $tag $installer --title "M2_GIT_DIFF $tag" --notes $Notes
if ($LASTEXITCODE -ne 0) { Fail 'gh release create failed.' }

Write-Step 'Done'
Write-Host "Released $tag - https://github.com/M2Station/M2_GIT_DIFF/releases/tag/$tag" -ForegroundColor Green
