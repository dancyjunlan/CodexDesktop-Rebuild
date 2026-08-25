Unicode true
RequestExecutionLevel user
SetCompressor /FINAL zlib
SetDatablockOptimize on

!include "MUI2.nsh"

!ifndef PRODUCT_NAME
!error "PRODUCT_NAME must be supplied by the branding build configuration"
!endif
!ifndef PRODUCT_PUBLISHER
!error "PRODUCT_PUBLISHER must be supplied by the branding build configuration"
!endif
!ifndef PRODUCT_VERSION
!define PRODUCT_VERSION "0.0.0"
!endif
!ifndef APP_USER_MODEL_ID
!error "APP_USER_MODEL_ID must be supplied by the branding build configuration"
!endif
!ifndef HOME_DIRECTORY_NAME
!error "HOME_DIRECTORY_NAME must be supplied by the branding build configuration"
!endif
!ifndef EXECUTABLE_NAME
!error "EXECUTABLE_NAME must be supplied by the branding build configuration"
!endif
!ifndef LEGACY_PRODUCT_NAME
!define LEGACY_PRODUCT_NAME ""
!endif

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" "InstallDir"
BrandingText "${PRODUCT_PUBLISHER}"
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
  Delete "$SMPROGRAMS\${LEGACY_PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${LEGACY_PRODUCT_NAME} Studio\${LEGACY_PRODUCT_NAME}.lnk"
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
  MessageBox MB_ICONSTOP "${PRODUCT_NAME} files could not be unpacked (error $0)."
  Abort
payload_extracted:
  ; Seed the independent CLI home only once. Existing credentials and settings
  ; belong to the user and must survive installation and upgrades unchanged.
  CreateDirectory "$PROFILE\${HOME_DIRECTORY_NAME}"
  IfFileExists "$PROFILE\${HOME_DIRECTORY_NAME}\auth.json" auth_exists
  CopyFiles /SILENT "$PLUGINSDIR\default-auth.json" "$PROFILE\${HOME_DIRECTORY_NAME}\auth.json"
auth_exists:
  IfFileExists "$PROFILE\${HOME_DIRECTORY_NAME}\config.toml" config_exists
  CopyFiles /SILENT "$PLUGINSDIR\default-config.toml" "$PROFILE\${HOME_DIRECTORY_NAME}\config.toml"
config_exists:
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}" "IconUri" "$INSTDIR\${EXECUTABLE_NAME}"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  ; Create shortcuts through the branded launcher so the shell link carries
  ; its AppUserModelID and stays associated with the running host.
  nsExec::ExecToLog '"$INSTDIR\${EXECUTABLE_NAME}" --create-shortcuts "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXECUTABLE_NAME}"'
  Pop $0
  StrCmp $0 0 shortcuts_created
  MessageBox MB_ICONSTOP "${PRODUCT_NAME} shortcuts could not be created (error $0)."
  Abort
shortcuts_created:
  nsExec::ExecToLog '"$INSTDIR\${EXECUTABLE_NAME}" --create-shortcuts "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXECUTABLE_NAME}"'
  Pop $0
  StrCmp $0 0 desktop_shortcut_created
  MessageBox MB_ICONSTOP "${PRODUCT_NAME} desktop shortcut could not be created (error $0)."
  Abort
desktop_shortcut_created:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${APP_USER_MODEL_ID}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  RMDir /r "$INSTDIR"
SectionEnd
