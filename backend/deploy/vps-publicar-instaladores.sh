#!/usr/bin/env bash
# Publica os instaladores de uma versao do CybhorPDV no painel do cliente.
#
# Instalado em /usr/local/bin/cybhorpdv-publicar-instaladores.sh e disparado pelo
# GitHub Actions via SSH com chave restrita (command= no authorized_keys): a
# versao chega em SSH_ORIGINAL_COMMAND e um .tar com os .exe + SHA256SUMS pelo
# stdin. A API le downloads/versoes/<versao>/ e mostra a mais nova em destaque.
#
# Os .exe da raiz de downloads/ sao hardlinks da versao mais nova: mantem o link
# antigo /api/site/baixar/<arquivo> funcionando sem ocupar espaco extra.
set -euo pipefail

DOWNLOADS_DIR=/home/cybhorpdv/downloads
VERSOES_DIR="$DOWNLOADS_DIR/versoes"
VERSOES_MANTIDAS=5
LOG_FILE=/var/log/cybhorpdv-deploy.log
LOCK_FILE=/var/lock/cybhorpdv-instaladores.lock
MAX_PACOTE_BYTES=$((600 * 1024 * 1024))
ESPACO_MINIMO_KB=$((2 * 1024 * 1024))
ARQUIVOS=(CybhorPDV-Setup-win10-x64.exe CybhorPDV-Setup-win7-x64.exe CybhorPDV-Setup-win7-ia32.exe)

log() {
  printf '[%s] instaladores: %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

falhar() {
  log "ERRO: $*"
  exit 1
}

versao_mais_nova() {
  find "$VERSOES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -E '^[0-9]{1,3}\.[0-9]{1,4}\.[0-9]{1,4}$' \
    | sort -V | tail -n 1
}

read -r VERSAO PUBLICADO_EM _ <<< "${SSH_ORIGINAL_COMMAND:-}" || true
[[ "$VERSAO" =~ ^[0-9]{1,3}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || falhar "versao invalida: '${VERSAO:0:40}'."
# Data do GitHub Release (republicar uma versao antiga mantem a data original).
if [[ ! "${PUBLICADO_EM:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  PUBLICADO_EM=$(date -u +%Y-%m-%dT%H:%M:%SZ)
fi

exec 9>"$LOCK_FILE"
flock -w 600 9 || falhar "outra publicacao ainda em andamento."

mkdir -p "$VERSOES_DIR"
chmod 755 "$DOWNLOADS_DIR" "$VERSOES_DIR"

ESPACO_LIVRE_KB=$(df -Pk "$DOWNLOADS_DIR" | awk 'NR==2 {print $4}')
(( ESPACO_LIVRE_KB > ESPACO_MINIMO_KB )) || falhar "pouco espaco em disco (${ESPACO_LIVRE_KB} KB livres)."

# Temporario no mesmo filesystem para o mv final ser atomico.
TMP=$(mktemp -d "$DOWNLOADS_DIR/.recebendo.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# --- 1. Recebe e valida ------------------------------------------------------
head -c "$((MAX_PACOTE_BYTES + 1))" > "$TMP/pacote.tar"
TAMANHO=$(stat -c %s "$TMP/pacote.tar")
(( TAMANHO > 0 )) || falhar "pacote vazio."
(( TAMANHO <= MAX_PACOTE_BYTES )) || falhar "pacote maior que o limite."

LISTAGEM=$(tar -tvf "$TMP/pacote.tar" 2>/dev/null) || falhar "pacote corrompido."
if grep -qv '^-' <<< "$LISTAGEM"; then
  falhar "pacote contem diretorios, links ou arquivos especiais."
fi
ESPERADOS=$(printf '%s\n' "${ARQUIVOS[@]}" SHA256SUMS | sort)
RECEBIDOS=$(tar -tf "$TMP/pacote.tar" | sed 's#^\./##' | sort)
[[ "$RECEBIDOS" == "$ESPERADOS" ]] || falhar "conteudo inesperado no pacote: $(tr '\n' ' ' <<< "$RECEBIDOS")"

mkdir "$TMP/versao"
tar -xf "$TMP/pacote.tar" -C "$TMP/versao" --no-same-owner --no-same-permissions
rm -f "$TMP/pacote.tar"

(cd "$TMP/versao" && sha256sum --quiet --strict -c SHA256SUMS) || falhar "checksum nao confere."
for arquivo in "${ARQUIVOS[@]}"; do
  [[ "$(head -c 2 "$TMP/versao/$arquivo")" == "MZ" ]] || falhar "$arquivo nao e um executavel Windows."
done

# --- 2. Publica --------------------------------------------------------------
printf '{"versao": "%s", "publicado_em": "%s"}\n' "$VERSAO" "${PUBLICADO_EM%Z}+00:00" \
  > "$TMP/versao/info.json"
chmod 755 "$TMP/versao"
chmod 644 "$TMP/versao"/*

DESTINO="$VERSOES_DIR/$VERSAO"
if [[ -e "$DESTINO" ]]; then
  log "versao $VERSAO ja existia; substituindo."
  mv "$DESTINO" "$TMP/substituida"
fi
mv "$TMP/versao" "$DESTINO"

# --- 3. Atualiza a raiz com a versao mais nova --------------------------------
MAIS_NOVA=$(versao_mais_nova)
for arquivo in "${ARQUIVOS[@]}"; do
  [[ "$VERSOES_DIR/$MAIS_NOVA/$arquivo" -ef "$DOWNLOADS_DIR/$arquivo" ]] && continue
  ln -f "$VERSOES_DIR/$MAIS_NOVA/$arquivo" "$DOWNLOADS_DIR/.$arquivo.novo"
  mv -f "$DOWNLOADS_DIR/.$arquivo.novo" "$DOWNLOADS_DIR/$arquivo"
done

# --- 4. Retencao -------------------------------------------------------------
find "$VERSOES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E '^[0-9]{1,3}\.[0-9]{1,4}\.[0-9]{1,4}$' \
  | sort -V | head -n "-$VERSOES_MANTIDAS" \
  | while read -r antiga; do
      log "removendo versao antiga $antiga."
      rm -rf "${VERSOES_DIR:?}/$antiga"
    done

log "versao $VERSAO publicada (mais nova no painel: $MAIS_NOVA)."
