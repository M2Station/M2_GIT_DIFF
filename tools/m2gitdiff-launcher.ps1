# M2 GIT DIFF — Explorer context-menu launcher
#
# Implements the Beyond Compare style two-step folder compare:
#   1) "Select Folder for M2 GIT DIFF"  -> remembers the folder (left side)
#   2) "Compare in M2 GIT DIFF"         -> launches the app with the remembered
#                                          folder as -L and the clicked one as -R
#
# The remembered path is stored in a small state file under %LOCALAPPDATA% so it
# survives between the two right-clicks. Invoked by the registry verbs created by
# install-context-menu.ps1.
#
# Usage (normally called from the registry, not by hand):
#   powershell -NoProfile -ExecutionPolicy Bypass -File m2gitdiff-launcher.ps1 select  "C:\path\to\folder"
#   powershell -NoProfile -ExecutionPolicy Bypass -File m2gitdiff-launcher.ps1 compare "C:\path\to\folder"

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('select', 'compare')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

# Repo root = parent of this tools\ folder; start.cmd lives there.
$repoRoot = Split-Path -Parent $PSScriptRoot
$startCmd = Join-Path $repoRoot 'start.cmd'

# Per-user state dir for the remembered "left" folder.
$stateDir = Join-Path $env:LOCALAPPDATA 'M2_GIT_DIFF'
$leftFile = Join-Path $stateDir 'left-folder.txt'

function Show-Info($text, $title = 'M2 GIT DIFF') {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($text, $title) | Out-Null
}

# Normalize: if a file was clicked, fall back to its containing directory.
if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $Path = Split-Path -Parent $Path
}
$Path = (Resolve-Path -LiteralPath $Path).Path

if ($Action -eq 'select') {
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    Set-Content -LiteralPath $leftFile -Value $Path -Encoding UTF8
    exit 0
}

# --- compare ---
if (-not (Test-Path -LiteralPath $leftFile)) {
    Show-Info "尚未選擇左側資料夾。`n`n請先在另一個資料夾上按右鍵，選擇『Select Folder for M2 GIT DIFF』，再到這個資料夾選擇『Compare in M2 GIT DIFF』。"
    exit 1
}

$left = (Get-Content -LiteralPath $leftFile -Raw).Trim()
$right = $Path

if ([string]::IsNullOrWhiteSpace($left) -or -not (Test-Path -LiteralPath $left)) {
    Show-Info "記住的左側資料夾已失效，請重新選擇。"
    Remove-Item -LiteralPath $leftFile -ErrorAction SilentlyContinue
    exit 1
}

if (-not (Test-Path -LiteralPath $startCmd)) {
    Show-Info "找不到 start.cmd：`n$startCmd`n`n請確認 tools 資料夾仍在專案內。"
    exit 1
}

# Launch the app in dev mode with both repros pre-loaded. start.cmd opens its own
# console window and runs `npm run dev`.
Start-Process -FilePath $startCmd -ArgumentList @('-L', $left, '-R', $right) -WorkingDirectory $repoRoot

# Clear the remembered left so the next compare starts fresh.
Remove-Item -LiteralPath $leftFile -ErrorAction SilentlyContinue
exit 0
