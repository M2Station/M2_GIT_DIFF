; Custom NSIS hooks for the M2_GIT_DIFF installer.
;
; Registers the Explorer right-click menu ("Select Folder" / "Compare") at
; install time and removes it at uninstall time. All entries live under HKCU so
; no administrator rights are needed (matches the one-click per-user installer).
;
; IMPORTANT — overwrite any earlier *dev* install:
;   The development helper tools\install-context-menu.ps1 registers the exact
;   same HKCU verb keys but points them at the dev start.cmd. On install we
;   DeleteRegKey those keys first, then re-create them pointing at the installed
;   exe, so a machine that previously had the dev menu is cleanly upgraded.

; Writes one context-menu verb: label + icon + multi-select + command.
; KEY    = full HKCU subkey path of the verb
; LABEL  = menu text shown in Explorer
; ACTION = select | compare  (passed through to the launcher)
!macro M2RegisterVerb KEY LABEL ACTION
  WriteRegStr HKCU "${KEY}" "" "${LABEL}"
  WriteRegStr HKCU "${KEY}" "Icon" "$INSTDIR\M2_GIT_DIFF.exe,0"
  ; Invoke the verb once per selected folder so a 2-folder selection reaches the
  ; launcher, which collects both paths.
  WriteRegStr HKCU "${KEY}" "MultiSelectModel" "Document"
  WriteRegStr HKCU "${KEY}\command" "" '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\tools\m2gitdiff-launcher.ps1" ${ACTION} "%V" -Exe "$INSTDIR\M2_GIT_DIFF.exe"'
!macroend

; Removes every verb this installer (or the dev script) may have created.
!macro M2UnregisterVerbs
  DeleteRegKey HKCU "Software\Classes\Directory\shell\M2GitDiffSelect"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\M2GitDiffCompare"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\M2GitDiffSelect"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\M2GitDiffCompare"
!macroend

!macro customInstall
  ; 1) Wipe any pre-existing (dev or older) entries so we always overwrite.
  !insertmacro M2UnregisterVerbs

  ; 2) Re-create them pointing at the installed launcher + exe.
  ;    Folder right-click (clicked folder = %V):
  !insertmacro M2RegisterVerb "Software\Classes\Directory\shell\M2GitDiffSelect"  "Select Folder for M2 GIT DIFF" "select"
  !insertmacro M2RegisterVerb "Software\Classes\Directory\shell\M2GitDiffCompare" "Compare in M2 GIT DIFF"        "compare"
  ;    Folder background right-click (current folder = %V):
  !insertmacro M2RegisterVerb "Software\Classes\Directory\Background\shell\M2GitDiffSelect"  "Select Folder for M2 GIT DIFF" "select"
  !insertmacro M2RegisterVerb "Software\Classes\Directory\Background\shell\M2GitDiffCompare" "Compare in M2 GIT DIFF"        "compare"
!macroend

!macro customUnInstall
  !insertmacro M2UnregisterVerbs
  ; Clear the remembered "left" folder state.
  Delete "$LOCALAPPDATA\M2_GIT_DIFF\left-folder.txt"
!macroend
