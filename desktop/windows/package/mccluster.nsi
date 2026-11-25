Unicode True
RequestExecutionLevel user
ManifestDPIAware True
; EquityNet (published by McCluster Corp). Compatibility: the install folder, McCluster.exe and the
; Uninstall\McClusterDesktop key keep their pre-rename names so this setup upgrades an existing install in place.
Name "EquityNet"
Caption "EquityNet"
OutFile "..\dist\EquityNet-Windows-x64-Setup-0.3.0.exe"
InstallDir "$LOCALAPPDATA\McClusterDesktop\App"
SetCompress auto
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "0.3.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "EquityNet"
VIAddVersionKey /LANG=1033 "FileDescription" "EquityNet setup"
VIAddVersionKey /LANG=1033 "CompanyName" "McCluster Corp"
VIAddVersionKey /LANG=1033 "FileVersion" "0.3.0.0"
VIAddVersionKey /LANG=1033 "ProductVersion" "0.3.0.0"
VIAddVersionKey /LANG=1033 "OriginalFilename" "EquityNet-Windows-x64-Setup-0.3.0.exe"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 McCluster Corp"

!include "MUI2.nsh"
!include "x64.nsh"

!define MUI_WELCOMEPAGE_TITLE "Install EquityNet"
!define MUI_WELCOMEPAGE_TEXT "EquityNet, the McCluster compute network client, opens your live site in a Windows desktop window with a local compute panel. This setup installs the app for the current Windows user and adds a Start menu shortcut. It does not install a worker, add a startup task, or request administrator access."
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\McCluster.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\McClusterDesktop\App"
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "This installer requires 64-bit Windows."
    Abort
  ${EndIf}
FunctionEnd

Section "EquityNet" SEC_APP
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File "app\McCluster.exe"
  File "app\Microsoft.Web.WebView2.Core.dll"
  File "app\Microsoft.Web.WebView2.WinForms.dll"
  File "app\WebView2Loader.dll"
  File "README.txt"
  File "MICROSOFT-WEBVIEW2-LICENSE.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  Delete "$SMPROGRAMS\McCluster Desktop.lnk"
  CreateShortCut "$SMPROGRAMS\EquityNet.lnk" "$INSTDIR\McCluster.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "DisplayName" "EquityNet"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "Publisher" "McCluster Corp"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "DisplayVersion" "0.3.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "DisplayIcon" "$INSTDIR\McCluster.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop" "NoRepair" 1
SectionEnd

Function un.onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\McClusterDesktop\App"
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\EquityNet.lnk"
  Delete "$SMPROGRAMS\McCluster Desktop.lnk"
  Delete "$INSTDIR\McCluster.exe"
  Delete "$INSTDIR\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\MICROSOFT-WEBVIEW2-LICENSE.txt"
  Delete "$INSTDIR\install-receipt.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\McClusterDesktop"
SectionEnd
