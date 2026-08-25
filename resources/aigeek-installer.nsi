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
!ifndef APP_USER_MODEL_ID
!define APP_USER_MODEL_ID "studio.aigeek.desktop.v2"
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
  ; Remove shortcuts from the earlier studio-based package. They point at
  ; the old gray ChatGPT host and keep confusing Explorer's app identity.
  Delete "$SMPROGRAMS\AIGeek.lnk"
  Delete "$SMPROGRAMS\AIGeek Studio\AIGeek.lnk"
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
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}" "IconUri" "$INSTDIR\AIGeek.exe"
  CreateDirectory "$SMPROGRAMS\AIGeek"
  ; Create shortcuts through the branded launcher so the shell link carries
  ; System.AppUserModel.ID=studio.aigeek.desktop.v2. Without this property,
  ; Windows treats the pinned shortcut and the running host as separate apps.
  nsExec::ExecToLog '"$INSTDIR\AIGeek.exe" --create-shortcuts "$SMPROGRAMS\AIGeek\AIGeek.lnk" "$INSTDIR\AIGeek.exe"'
  Pop $0
  StrCmp $0 0 shortcuts_created
  MessageBox MB_ICONSTOP "AIGeek shortcuts could not be created (error $0)."
  Abort
shortcuts_created:
  nsExec::ExecToLog '"$INSTDIR\AIGeek.exe" --create-shortcuts "$DESKTOP\AIGeek.lnk" "$INSTDIR\AIGeek.exe"'
  Pop $0
  StrCmp $0 0 desktop_shortcut_created
  MessageBox MB_ICONSTOP "AIGeek desktop shortcut could not be created (error $0)."
  Abort
desktop_shortcut_created:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\AIGeek.lnk"
  Delete "$SMPROGRAMS\AIGeek\AIGeek.lnk"
  RMDir "$SMPROGRAMS\AIGeek"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AIGeek"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}"
  DeleteRegKey HKCU "Software\AIGeek"
  RMDir /r "$INSTDIR"
SectionEnd
