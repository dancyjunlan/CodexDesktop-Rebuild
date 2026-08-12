Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetDatablockOptimize on

!include "MUI2.nsh"

!define PRODUCT_NAME "AIGeek"
!define PRODUCT_PUBLISHER "AIGeek Studio"
!define PRODUCT_VERSION "26.803.41515"

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
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*.*"
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
