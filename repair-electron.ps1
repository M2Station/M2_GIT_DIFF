# repair-electron.ps1
# 修復 Electron 二進位檔在網路磁碟 (例如 Z:) 上 npm 解壓會掉檔的問題。
# 作法：把 @electron/get 快取的 zip 先解壓到本機 TEMP，再用 robocopy 複製進 node_modules\electron\dist。
$ErrorActionPreference = 'Stop'

$root    = Join-Path $PSScriptRoot 'node_modules\electron'
$dist    = Join-Path $root 'dist'
$exePath = Join-Path $dist 'electron.exe'

# 若已正常安裝就直接結束
if ((Test-Path $exePath) -and (Test-Path (Join-Path $root 'path.txt'))) {
    Write-Host '[Electron] 二進位檔正常，無需修復。'
    exit 0
}

# 取得 electron 版本
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
Write-Host "[Electron] 偵測到二進位檔遺失，開始修復 (v$version)..."

# 在快取中尋找對應的 zip
$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron\Cache'
$zipName   = "electron-v$version-win32-x64.zip"
$zip = $null
if (Test-Path $cacheRoot) {
    $zip = Get-ChildItem $cacheRoot -Recurse -File -Filter $zipName -ErrorAction SilentlyContinue |
           Select-Object -First 1 -ExpandProperty FullName
}

# 快取沒有就先用 npm 觸發下載 (只下載到快取，不一定能正確解壓)
if (-not $zip) {
    Write-Host '[Electron] 快取中找不到 zip，嘗試透過 npm 下載...'
    & node (Join-Path $root 'install.js') | Out-Null
    if (Test-Path $cacheRoot) {
        $zip = Get-ChildItem $cacheRoot -Recurse -File -Filter $zipName -ErrorAction SilentlyContinue |
               Select-Object -First 1 -ExpandProperty FullName
    }
}

if (-not $zip) {
    Write-Error "[Electron] 無法取得 $zipName，請檢查網路或手動下載。"
    exit 1
}

Write-Host "[Electron] 使用快取 zip: $zip"

# 解壓到本機 TEMP
$tmp = Join-Path $env:TEMP ("electron-extract-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    if (-not (Test-Path (Join-Path $tmp 'electron.exe'))) {
        Write-Error '[Electron] zip 解壓後找不到 electron.exe，zip 可能損毀。'
        exit 1
    }

    # 用 robocopy 複製到 dist (對網路磁碟比 extract-zip 穩定)
    New-Item -ItemType Directory -Path $dist -Force | Out-Null
    robocopy $tmp $dist /E /NFL /NDL /NJH /NJS /NP | Out-Null

    # electron.d.ts 移到 electron 根目錄
    $srcDts = Join-Path $dist 'electron.d.ts'
    if (Test-Path $srcDts) {
        Move-Item $srcDts (Join-Path $root 'electron.d.ts') -Force
    }

    # 寫入 path.txt
    Set-Content -Path (Join-Path $root 'path.txt') -Value 'electron.exe' -NoNewline -Encoding ascii

    if (Test-Path $exePath) {
        Write-Host '[Electron] 修復完成。'
        exit 0
    } else {
        Write-Error '[Electron] 複製後仍找不到 electron.exe。'
        exit 1
    }
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
