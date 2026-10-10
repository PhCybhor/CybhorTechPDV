; Instalar por cima deve ATUALIZAR o CybhorPDV, nunca criar uma segunda instalação.
;
; O instalador padrão do electron-builder só remove a versão anterior registrada no
; mesmo escopo e na mesma visão do registro. Por isso o PDV duplicava quando:
;   - a instalação antiga era "para todos" (HKLM) e a nova "somente para mim" (HKCU),
;     comum ao alternar entre o instalador Win10 (por máquina) e o Win7 (por usuário);
;   - uma era de 32 bits (HKLM\...\WOW6432Node) e a outra de 64 bits (HKLM nativo),
;     pois cada instalador só enxerga a sua visão do registro.
; Depois que a versão nova está instalada, as outras cópias são desinstaladas com
; --updated, que preserva %APPDATA%\CybhorPDV (licença e configurações da loja).

!macro cybhorRestaurarVisaoRegistro
  !ifdef APP_64
    SetRegView 64
  !else
    SetRegView 32
  !endif
!macroend

; Espera em $R7 a pasta, em $R8 o desinstalador e em $R9 a versão da cópia duplicada.
!macro cybhorDesinstalarDuplicata VISAO
  StrCpy $6 "1"
  ${IfNot} ${UAC_IsAdmin}
    ${If} ${Silent}
      StrCpy $6 "0"
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Existe outra instalação do CybhorPDV $R9 (para todos os usuários) em:$\r$\n$R7$\r$\n$\r$\nDeseja removê-la para o PDV não ficar duplicado? O Windows vai pedir permissão de administrador.$\r$\nA licença e as configurações da loja são mantidas." IDYES +2
      StrCpy $6 "0"
    ${EndIf}
  ${EndIf}

  ${If} $6 == "1"
    StrCpy $7 "/allusers --updated"
    StrCpy $5 "0"
    ; Mesmo escopo "para todos" em outra visão do registro: os atalhos são os mesmos
    ; arquivos que a versão nova acabou de criar, então o desinstalador antigo não pode apagá-los.
    ${If} $installMode == "all"
      StrCpy $7 "$7 --keep-shortcuts"
      ${If} ${FileExists} "$newDesktopLink"
        StrCpy $5 "1"
      ${EndIf}
    ${EndIf}

    DetailPrint "Removendo instalação duplicada do CybhorPDV $R9 em $R7"
    ClearErrors
    CopyFiles /SILENT "$R8" "$PLUGINSDIR\cybhor-desinstalar-duplicata.exe"
    ${If} ${Errors}
      ClearErrors
      ExecWait '"$R8" /S $7 _?=$R7'
    ${Else}
      ExecWait '"$PLUGINSDIR\cybhor-desinstalar-duplicata.exe" /S $7 _?=$R7'
    ${EndIf}
    ClearErrors

    ${If} $installMode == "all"
      ${IfNot} ${FileExists} "$newStartMenuLink"
        CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      ${EndIf}
      ${If} $5 == "1"
      ${AndIfNot} ${FileExists} "$newDesktopLink"
        CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
        WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      ${EndIf}
      ClearErrors
    ${EndIf}

    SetRegView ${VISAO}
    ReadRegStr $6 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    !insertmacro cybhorRestaurarVisaoRegistro
    ${If} $6 != ""
      DetailPrint "Não foi possível remover a instalação duplicada em $R7"
      MessageBox MB_OK|MB_ICONEXCLAMATION "Não foi possível remover a outra instalação do CybhorPDV em:$\r$\n$R7$\r$\n$\r$\nPara não ficar duplicado, desinstale-a em Painel de Controle > Programas e Recursos. A licença e as configurações da loja são mantidas." /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend

!macro cybhorRemoverDuplicataHKLM VISAO
  SetRegView ${VISAO}
  ClearErrors
  ReadRegStr $R6 HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ReadRegStr $R7 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $R9 HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  !insertmacro cybhorRestaurarVisaoRegistro
  ClearErrors

  ${If} $R6 != ""
    !insertmacro GetInQuotes $R8 "$R6"
    ${If} $R7 == ""
    ${AndIf} $R8 != ""
      Push $R8
      Call GetFileParent
      Pop $R7
    ${EndIf}

    ; Mesma pasta da versão nova: rodar o desinstalador antigo apagaria os arquivos novos,
    ; então só sobra o registro órfão para limpar. O mesmo vale quando a pasta já sumiu.
    ${If} $R7 == $INSTDIR
    ${OrIfNot} ${FileExists} "$R8"
      SetRegView ${VISAO}
      DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
      DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
      !insertmacro cybhorRestaurarVisaoRegistro
      ClearErrors
    ${Else}
      !insertmacro cybhorDesinstalarDuplicata ${VISAO}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  Push $5
  Push $6
  Push $7
  Push $R6
  Push $R7
  Push $R8
  Push $R9

  ; A cópia da própria versão nova ("para todos" na visão deste instalador) já foi
  ; atualizada pelo electron-builder; aqui só entram as outras visões/escopos de HKLM.
  ; Cópias "somente para mim" (HKCU) não dependem da visão e o padrão já as remove.
  !ifdef APP_64
    ${If} $installMode != "all"
      !insertmacro cybhorRemoverDuplicataHKLM 64
    ${EndIf}
    !insertmacro cybhorRemoverDuplicataHKLM 32
  !else
    ${If} ${RunningX64}
      !insertmacro cybhorRemoverDuplicataHKLM 64
    ${EndIf}
    ${If} $installMode != "all"
      !insertmacro cybhorRemoverDuplicataHKLM 32
    ${EndIf}
  !endif

  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
  Pop $7
  Pop $6
  Pop $5
!macroend
