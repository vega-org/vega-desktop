!macro NSIS_HOOK_POSTINSTALL
  ReadRegDWord $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != 1
    DetailPrint "Installing Microsoft Visual C++ Redistributable..."
    ExecWait '"$INSTDIR\resources\windows\vc_redist.x64.exe" /install /quiet /norestart' $0
    ${If} $0 != 0
    ${AndIf} $0 != 1638
    ${AndIf} $0 != 3010
      MessageBox MB_ICONEXCLAMATION "Microsoft Visual C++ Redistributable could not be installed. Vega may require it for video playback."
    ${EndIf}
  ${EndIf}
!macroend