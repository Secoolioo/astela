; Customizations of the NSIS installer and uninstaller that electron-builder generates.

; Finds the browser of the current user (of every user for per-machine installations) by its
; program name: exit code 0 when it runs.
!macro astelaFindBrowser _RETURN
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
  !endif
  Pop ${_RETURN}
!macroend

; Asks the browser and its helper processes to close; with /F, stops them.
!macro astelaStopBrowser _FORCE
  Push $0
  !ifdef INSTALL_MODE_PER_ALL_USERS
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill ${_FORCE} /T /IM "${APP_EXECUTABLE_FILENAME}"`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill ${_FORCE} /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  !endif
  Pop $0 ; the exit code
  Pop $0
!macroend

; Replaces electron-builder's check for a running browser. That check starts PowerShell and
; queries WMI, which can take minutes or never return on a fresh system and is often
; restricted in companies; tasklist and taskkill need neither. The installer and uninstaller
; never carry the browser's program name, so they cannot stop themselves.
!macro customCheckAppRunning
  !insertmacro astelaFindBrowser $R0
  ${if} $R0 == 0
    ; An update starts the installer while the browser quits; it closes without asking.
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK astelaStop
      Quit
    ${endIf}
    astelaStop:
    DetailPrint "$(appClosing)"
    !insertmacro astelaStopBrowser ""
    StrCpy $R1 0
    astelaWait:
      Sleep 1000
      IntOp $R1 $R1 + 1
      !insertmacro astelaFindBrowser $R0
      ${if} $R0 == 0
        ${if} $R1 = 3
          !insertmacro astelaStopBrowser "/F"
        ${elseif} $R1 >= 10
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY astelaStop
          Quit
        ${endIf}
        Goto astelaWait
      ${endIf}
  ${endIf}
!macroend

; Registers the browser with Windows as a web browser, so that Settings › Default apps lists
; it and the user can choose it for web links. Links arrive after `--`, so a link can never
; pass for a command line switch.
!macro customInstall
  StrCpy $0 "Software\Clients\StartMenuInternet\${PRODUCT_NAME}"
  WriteRegStr SHCTX "$0" "" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "$0\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "$0\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHCTX "$0\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "$0\Capabilities" "ApplicationDescription" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "$0\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "$0\Capabilities\URLAssociations" "http" "${PRODUCT_NAME}URL"
  WriteRegStr SHCTX "$0\Capabilities\URLAssociations" "https" "${PRODUCT_NAME}URL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCT_NAME}" "$0\Capabilities"
  WriteRegStr SHCTX "Software\Classes\${PRODUCT_NAME}URL" "" "${PRODUCT_NAME} URL"
  WriteRegStr SHCTX "Software\Classes\${PRODUCT_NAME}URL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\${PRODUCT_NAME}URL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\${PRODUCT_NAME}URL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'
  ; Tells Windows that the registered applications changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

; Removes the registration, but not when an update replaces the installed version.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCT_NAME}"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCT_NAME}"
    DeleteRegKey SHCTX "Software\Classes\${PRODUCT_NAME}URL"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${endIf}
!macroend
