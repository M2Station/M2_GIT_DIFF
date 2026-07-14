/*
 * M2_GIT_DIFF
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

// Identify which OS processes are holding a directory (or a file inside it) so
// the UI can tell the user *what* to close when a worktree can't be removed on
// Windows (the classic EBUSY / "resource busy or locked" rmdir failure).
//
// On Windows the workhorse is the Restart Manager API (rstrtmgr.dll), the same
// mechanism installers use to answer "which apps are using this file?". It is
// built into every Windows install, needs no extra tooling, and reliably names
// processes that hold *file* handles inside the folder (editors, this app,
// indexers, etc.). Sysinternals `handle.exe` — when present on PATH — is layered
// on top because it additionally catches a shell whose current directory sits
// inside the worktree (a pure directory handle the Restart Manager misses).
//
// Everything here is best-effort: any failure resolves to an empty list so the
// removal flow degrades gracefully instead of throwing.

const { execFile } = require('node:child_process');

// PowerShell (Windows PowerShell 5.1, always present) script that P/Invokes the
// Restart Manager and prints a compact JSON array of { pid, name }. The target
// path arrives via the M2_LOCK_TARGET env var so no path ever touches the
// command line (no quoting/escaping pitfalls).
const RM_PS = String.raw`
$ErrorActionPreference='SilentlyContinue'
$target=$env:M2_LOCK_TARGET
if(-not $target){ '[]'; return }
$sig=@"
using System;
using System.Runtime.InteropServices;
public static class M2Rm {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string strServiceShortName;
    public int ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
}
"@
try { Add-Type -TypeDefinition $sig } catch { '[]'; return }
$key=[Guid]::NewGuid().ToString()
$session=[uint32]0
if([M2Rm]::RmStartSession([ref]$session,0,$key) -ne 0){ '[]'; return }
try {
  $files=New-Object System.Collections.Generic.List[string]
  $item=Get-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
  if($item){
    if($item.PSIsContainer){
      Get-ChildItem -LiteralPath $target -Recurse -File -Force -ErrorAction SilentlyContinue |
        Select-Object -First 1000 | ForEach-Object { $files.Add($_.FullName) }
    } else { $files.Add($item.FullName) }
  }
  if($files.Count -eq 0){ '[]'; return }
  if([M2Rm]::RmRegisterResources($session,[uint32]$files.Count,$files.ToArray(),0,$null,0,$null) -ne 0){ '[]'; return }
  $needed=[uint32]0; $count=[uint32]0; $reason=[uint32]0
  [void][M2Rm]::RmGetList($session,[ref]$needed,[ref]$count,$null,[ref]$reason)
  $list=@()
  if($needed -gt 0){
    $arr=New-Object 'M2Rm+RM_PROCESS_INFO[]' $needed
    $count=$needed
    if([M2Rm]::RmGetList($session,[ref]$needed,[ref]$count,$arr,[ref]$reason) -eq 0){
      for($i=0;$i -lt $count;$i++){
        $p=$arr[$i]
        $list += [pscustomobject]@{ pid=$p.Process.dwProcessId; name=$p.strAppName }
      }
    }
  }
  if($list.Count -gt 0){ $list | ConvertTo-Json -Compress } else { '[]' }
} finally { [void][M2Rm]::RmEndSession($session) }
`;
// PowerShell script (Windows) that finds processes whose *current directory*
// sits inside the target — the lock the Restart Manager can't see (a shell that
// `cd`-ed into the worktree, the app's own git child, etc.). It reads each
// process's PEB (NtQueryInformationProcess -> ProcessParameters -> CurrentDirectory)
// via ReadProcessMemory. A process we can't open, or a mis-read, simply yields a
// non-matching path, so this can produce false negatives but never false
// positives. Emits the same compact JSON array of { pid, name }.
const CWD_PS = String.raw`
$ErrorActionPreference='SilentlyContinue'
$target=$env:M2_LOCK_TARGET
if(-not $target){ '[]'; return }
$sig=@"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class M2Cwd {
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_BASIC_INFORMATION {
    public IntPtr ExitStatus; public IntPtr PebBaseAddress; public IntPtr AffinityMask;
    public IntPtr BasePriority; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId;
  }
  [DllImport("ntdll.dll")]
  public static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION pbi, int len, out int ret);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool ReadProcessMemory(IntPtr h, IntPtr baseAddr, byte[] buf, int size, out int read);
  static byte[] ReadBytes(IntPtr h, long addr, int size) {
    byte[] b = new byte[size]; int read;
    if (!ReadProcessMemory(h, (IntPtr)addr, b, size, out read) || read != size) return null;
    return b;
  }
  static IntPtr ReadPtr(IntPtr h, long addr) {
    byte[] b = ReadBytes(h, addr, 8);
    if (b == null) return IntPtr.Zero;
    return (IntPtr)BitConverter.ToInt64(b, 0);
  }
  public static string GetCwd(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid); // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) return null;
    try {
      PROCESS_BASIC_INFORMATION pbi = new PROCESS_BASIC_INFORMATION();
      int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      if (pbi.PebBaseAddress == IntPtr.Zero) return null;
      IntPtr pp = ReadPtr(h, (long)pbi.PebBaseAddress + 0x20); // PEB.ProcessParameters
      if (pp == IntPtr.Zero) return null;
      byte[] lenBuf = ReadBytes(h, (long)pp + 0x38, 2); // CurrentDirectory.DosPath.Length
      if (lenBuf == null) return null;
      ushort len = BitConverter.ToUInt16(lenBuf, 0);
      if (len == 0 || len > 1024) return null;
      IntPtr buf = ReadPtr(h, (long)pp + 0x40); // CurrentDirectory.DosPath.Buffer
      if (buf == IntPtr.Zero) return null;
      byte[] str = ReadBytes(h, (long)buf, len);
      if (str == null) return null;
      return Encoding.Unicode.GetString(str);
    } finally { CloseHandle(h); }
  }
}
"@
try { Add-Type -TypeDefinition $sig } catch { '[]'; return }
$t=$target.TrimEnd([char]0).TrimEnd('\','/').ToLowerInvariant()
$list=@()
foreach($proc in Get-Process){
  try {
    $cwd=[M2Cwd]::GetCwd($proc.Id)
    if($cwd){
      $c=$cwd.TrimEnd([char]0).TrimEnd('\','/').ToLowerInvariant()
      if($c -eq $t -or $c.StartsWith($t + '\') -or $c.StartsWith($t + '/')){
        $list += [pscustomobject]@{ pid=$proc.Id; name=$proc.ProcessName }
      }
    }
  } catch {}
}
if($list.Count -gt 0){ $list | ConvertTo-Json -Compress } else { '[]' }
`;
// Normalize whatever a probe produced into a clean [{ pid:number, name:string }].
function normalize(list) {
  const seen = new Map();
  for (const item of list || []) {
    const pid = Number(item && item.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (seen.has(pid)) continue;
    seen.set(pid, { pid, name: String((item && item.name) || '').trim() || 'unknown' });
  }
  return [...seen.values()];
}

// Parse the compact JSON emitted by the Restart Manager script. ConvertTo-Json
// collapses a single-element array to a bare object, so accept either shape.
function parseJsonList(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function fromRestartManager(targetPath) {
  return runPsProbe(RM_PS, targetPath);
}

function fromProcessCwd(targetPath) {
  return runPsProbe(CWD_PS, targetPath);
}

// Run a PowerShell probe script (passed as an -EncodedCommand so the target
// path only ever travels via the M2_LOCK_TARGET env var) and parse its JSON.
function runPsProbe(script, targetPath) {
  return new Promise((resolve) => {
    let b64;
    try {
      b64 = Buffer.from(script, 'utf16le').toString('base64');
    } catch {
      resolve([]);
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, M2_LOCK_TARGET: targetPath }
      },
      (err, stdout) => resolve(err ? [] : parseJsonList(stdout))
    );
  });
}

// Each handle.exe match line looks like:
//   Code.exe           pid: 3620   type: File   2F8: D:\CODE\WT\...\file
// Grab the leading image name and the pid; ignore banners and "No matching…".
function parseHandleOutput(stdout) {
  const out = [];
  const re = /^(\S.*?)\s+pid:\s*(\d+)\b/i;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(re);
    if (m) out.push({ pid: Number(m[2]), name: m[1].trim() });
  }
  return out;
}

// Try handle64.exe then handle.exe; resolve [] when neither is installed.
function fromHandleExe(targetPath) {
  return new Promise((resolve) => {
    const attempt = (exe, next) => {
      execFile(
        exe,
        ['-accepteula', '-nobanner', targetPath],
        { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err && err.code === 'ENOENT') {
            next();
            return;
          }
          resolve(parseHandleOutput(stdout));
        }
      );
    };
    attempt('handle64.exe', () => attempt('handle.exe', () => resolve([])));
  });
}

// POSIX best-effort: `lsof +D <dir>` lists open files under a directory. The
// first two columns are COMMAND and PID. Resolves [] when lsof is absent.
function fromLsof(targetPath) {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['+D', targetPath],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err && err.code === 'ENOENT') {
          resolve([]);
          return;
        }
        const out = [];
        const lines = String(stdout || '').split(/\r?\n/);
        for (const line of lines.slice(1)) {
          const cols = line.trim().split(/\s+/);
          if (cols.length >= 2 && /^\d+$/.test(cols[1])) {
            out.push({ pid: Number(cols[1]), name: cols[0] });
          }
        }
        resolve(out);
      }
    );
  });
}

/**
 * List the processes currently holding a lock on `targetPath` (a directory or
 * file). Best-effort and never throws — resolves to an empty array when nothing
 * is found or when the probe tooling is unavailable.
 * @param {string} targetPath absolute path to inspect
 * @returns {Promise<Array<{pid:number, name:string}>>}
 */
async function findLockingProcesses(targetPath) {
  const p = String(targetPath || '').trim();
  if (!p) return [];
  if (process.platform === 'win32') {
    const [rm, cwd, handle] = await Promise.all([
      fromRestartManager(p).catch(() => []),
      fromProcessCwd(p).catch(() => []),
      fromHandleExe(p).catch(() => [])
    ]);
    return normalize([...rm, ...cwd, ...handle]);
  }
  const posix = await fromLsof(p).catch(() => []);
  return normalize(posix);
}

module.exports = { findLockingProcesses };
