# M2_GIT_DIFF
# Copyright (c) 2026 OA Hsiao
# SPDX-License-Identifier: MIT
#
# This source code is licensed under the MIT License found in the
# LICENSE file in the root directory of this source tree.
<#
.SYNOPSIS
    Local verification build for M2_GIT_DIFF (with an opt-in emergency publish).

.DESCRIPTION
    The CANONICAL release path is CI: push a vX.Y.Z tag and
    .github/workflows/release.yml builds the installer and publishes the
    GitHub Release. That keeps releases reproducible and independent of any
    one machine.

    By DEFAULT this script only does a LOCAL VERIFICATION BUILD: it builds the
    Windows NSIS installer so you can confirm it packages and installs, but it
    NEVER modifies package.json, commits, tags, pushes, or publishes. It also
    handles the known electron-builder winCodeSign symlink extraction failure.

    Pass -Publish to opt in to an EMERGENCY LOCAL PUBLISH (bump + commit + tag +
    push + gh release). Use this only when CI is unavailable.

    Verify steps (default):
      1. Verify clean working tree on the target branch (default: main)
      2. Pre-extract the winCodeSign cache (skips the darwin symlinks that fail)
      3. npm install + npm run rebuild (native better-sqlite3) + npm run dist
      4. Confirm the installer exists, then stop (nothing pushed/published)

    Publish adds (only with -Publish): bump package.json + commit, tag vX.Y.Z,
    push, and gh release create + upload the installer.

.PARAMETER Version
    Explicit version, e.g. "0.2.0". If omitted, uses the current
    version in package.json.

.PARAMETER Bump
    Auto-bump the package.json version: patch | minor | major.
    Ignored if -Version is supplied. Only applied with -Publish.

.PARAMETER Notes
    Release notes (markdown). If omitted, a default note is generated.
    Only used with -Publish.

.PARAMETER Branch
    Branch the build/release is cut from. Default: main.

.PARAMETER Publish
    Opt in to an emergency LOCAL publish: bump + commit + tag + push + create
    the GitHub Release. Without this, the script only verifies the build.

.PARAMETER SkipPush
    Deprecated / no-op: the script is already verify-only by default. Kept for
    backward compatibility; forces verify-only even if -Publish is given.

.EXAMPLE
    npm run release
    # Local verification build only. Nothing is pushed or published.

.EXAMPLE
    git tag v0.2.0; git push origin v0.2.0
    # Canonical release: CI builds and publishes from the tag.

.EXAMPLE
    powershell -File scripts/release.ps1 -Bump minor -Publish
    # Emergency local publish: bumps 0.1.0 -> 0.2.0, builds, tags, publishes.
#>
[CmdletBinding()]
param(
    [string]$Version,
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump,
    [string]$Notes,
    [string]$Branch = 'main',
    [switch]$Publish,
    [switch]$SkipPush
)

# Canonical release = CI (push a vX.Y.Z tag -> .github/workflows/release.yml).
# This script is verify-only by default; -Publish opts in to a local publish.
# -SkipPush is a deprecated no-op that forces verify-only for back-compat.
$doPublish = $Publish.IsPresent -and -not $SkipPush.IsPresent

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# --- 0. Tool checks -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found in PATH.' }
if ($doPublish -and -not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail 'gh (GitHub CLI) not found. Install it, or omit -Publish to run a local verification build.'
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

# Write version back if it changed (publish only — a verification build must
# never mutate package.json or create commits).
if ($doPublish -and $Version -ne $currentVersion) {
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
elseif (-not $doPublish -and $Version -ne $currentVersion) {
    Write-Host "Verify mode: leaving package.json untouched (would set version -> $Version on publish)." -ForegroundColor Yellow
}

# Guard: tag must not already exist (publish only)
if ($doPublish) {
    $existing = git tag --list $tag
    if ($existing) { Fail "Tag $tag already exists. Pick a new version." }
}

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

# electron-builder emits NSIS installers for each target arch (x64 + arm64).
# Collect whatever was produced for this version so verify + publish handle
# both a single combined installer and per-arch installers.
$releaseDir = Join-Path $repoRoot 'release'
$installers = @(Get-ChildItem -Path $releaseDir -Filter "M2_GIT_DIFF Setup $Version*.exe" -ErrorAction SilentlyContinue)
if ($installers.Count -eq 0) { Fail "No installer found in '$releaseDir' (expected 'M2_GIT_DIFF Setup $Version*.exe')." }
foreach ($i in $installers) {
    $sizeMB = [math]::Round($i.Length / 1MB, 1)
    Write-Host "Built: $($i.FullName) ($sizeMB MB)" -ForegroundColor Green
}

if (-not $doPublish) {
    Write-Step 'Verification build complete - not publishing'
    Write-Host "Local build ready. Installer(s): $($installers.Name -join ', ')" -ForegroundColor Green
    Write-Host 'This was a LOCAL VERIFICATION BUILD. Nothing was pushed or published.' -ForegroundColor Cyan
    Write-Host 'To publish the canonical release, push a tag and let CI build it:' -ForegroundColor Cyan
    Write-Host "    git tag $tag; git push origin $tag" -ForegroundColor Cyan
    Write-Host 'Or, for an emergency LOCAL publish, re-run with -Publish.' -ForegroundColor Cyan
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
    $fileList = ($installers | ForEach-Object { "- **$($_.Name)**" }) -join "`n"
    $Notes = @"
Release $tag of M2_GIT_DIFF - side-by-side commit history comparison for two local Git repositories.

## Install
Download and run the Windows installer for your CPU (supports **x64** and **ARM64**):

$fileList

> The installer is not code-signed, so Windows SmartScreen may warn on first run - choose *More info -> Run anyway*.
"@
}

gh release create $tag $installers.FullName --title "M2_GIT_DIFF $tag" --notes $Notes
if ($LASTEXITCODE -ne 0) { Fail 'gh release create failed.' }

Write-Step 'Done'
Write-Host "Released $tag - https://github.com/M2Station/M2_GIT_DIFF/releases/tag/$tag" -ForegroundColor Green
