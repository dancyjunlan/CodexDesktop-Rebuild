Unicode true
RequestExecutionLevel user
SetCompressor /FINAL zlib
SetDatablockOptimize on

!include "MUI2.nsh"

!define PRODUCT_NAME "AIGeek"
!define PRODUCT_PUBLISHER "AIGeek Studio"
!ifndef PRODUCT_VERSION
!define PRODUCT_VERSION "0.0.0"
!endif

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\AIGeek"
InstallDirRegKey HKCU "Software\AIGeek" "InstallDir"
BrandingText "AIGeek Studio"
Icon "${ICON}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ; Only clean the malformed shortcut created by the previous Squirrel build.
  ; A real Codex shortcut is left untouched unless that exact legacy runtime
  ; is present alongside it.
  IfFileExists "$LOCALAPPDATA\studio\notification_helper.exe" legacy_shortcuts done
legacy_shortcuts:
  Delete "$DESKTOP\Codex.lnk"
done:
FunctionEnd

Section "Install"
  ; The app payload was compressed by 7-Zip with parallel LZMA2. Keep it
  ; uncompressed in the NSIS wrapper, then unpack it into the install folder.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  SetCompress off
  File /oname=7z.exe "${SEVENZIP}"
  File /oname=7z.dll "${SEVENZIP_DLL}"
  File /oname=payload.7z "${PAYLOAD}"
  File /oname=default-auth.json "${DEFAULT_AUTH}"
  File /oname=default-config.toml "${DEFAULT_CONFIG}"
  SetCompress auto

  SetOutPath "$INSTDIR"
  ; nsExec keeps the console-only 7-Zip extractor hidden while the installer
  ; waits for it, instead of showing a separate terminal window to the user.
  nsExec::Exec '"$PLUGINSDIR\7z.exe" x "$PLUGINSDIR\payload.7z" "-o$INSTDIR" -y'
  Pop $0
  StrCmp $0 0 payload_extracted
  MessageBox MB_ICONSTOP "AIGeek files could not be unpacked (error $0)."
  Abort
payload_extracted:
  ; Seed the independent CLI home only once. Existing credentials and settings
  ; belong to the user and must survive installation and upgrades unchanged.
  CreateDirectory "$PROFILE\.aigeek"
  IfFileExists "$PROFILE\.aigeek\auth.json" auth_exists
  CopyFiles /SILENT "$PLUGINSDIR\default-auth.json" "$PROFILE\.aigeek\auth.json"
auth_exists:
  IfFileExists "$PROFILE\.aigeek\config.toml" config_exists
  CopyFiles /SILENT "$PLUGINSDIR\default-config.toml" "$PROFILE\.aigeek\config.toml"
config_exists:
  WriteRegStr HKCU "Software\AIGeek" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "DisplayName" "AIGeek"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\AIGeek"
  CreateShortcut "$SMPROGRAMS\AIGeek\AIGeek.lnk" "$INSTDIR\AIGeek.exe"
  CreateShortcut "$DESKTOP\AIGeek.lnk" "$INSTDIR\AIGeek.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\AIGeek.lnk"
  Delete "$SMPROGRAMS\AIGeek\AIGeek.lnk"
  RMDir "$SMPROGRAMS\AIGeek"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek"
  DeleteRegKey HKCU "Software\AIGeek"
  RMDir /r "$INSTDIR"
SectionEnd
