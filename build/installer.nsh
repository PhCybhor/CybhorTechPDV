; Upgrade in-place: mesmo appId (com.cybhor.pdv) — o Setup remove só os
; binários da versão anterior e instala por cima, sem o usuário desinstalar
; no Painel de Controle. AppData (licença, cache) permanece.
!macro customInit
  ; electron-builder já detecta instalação anterior via GUID do appId.
!macroend

!macro customInstall
!macroend

!macro customUnInstall
  ; deleteAppDataOnUninstall=false no package.json — não apagar dados da loja.
!macroend
