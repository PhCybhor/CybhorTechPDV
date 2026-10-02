#!/usr/bin/env bash
# Deploy da API + landing do CybhorPDV na VPS.
#
# Instalado em /usr/local/bin/cybhorpdv-deploy.sh e disparado pelo GitHub Actions
# via SSH com chave restrita (command= no authorized_keys): a chave de CI so
# consegue executar este script, nunca abrir um shell. O pacote .tar.gz chega
# pelo stdin.
#
# Ordem pensada para nunca derrubar producao por um deploy ruim:
#   1. valida o pacote  2. backup  3. copia arquivos  4. build da imagem nova
#   (container antigo segue no ar)  5. pre-checagem de config na imagem nova
#   6. troca o container  7. healthcheck  -> qualquer falha restaura o backup.
set -euo pipefail

APP_DIR=/home/cybhorpdv
COMPOSE_FILE=docker-compose.icp.yml
SERVICO=api
CONTAINER=cybhorpdv-api
BACKUP_DIR=/var/backups/cybhorpdv
BACKUPS_MANTIDOS=5
LOG_FILE=/var/log/cybhorpdv-deploy.log
LOCK_FILE=/var/lock/cybhorpdv-deploy.lock
MAX_PACOTE_BYTES=$((50 * 1024 * 1024))
HEALTH_URL=http://127.0.0.1:3333/api/saude
DIRETORIOS=(app db public scripts landing)
ARQUIVOS=(requirements.txt)

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

falhar() {
  log "ERRO: $*"
  exit 1
}

compose() {
  (cd "$APP_DIR" && docker compose -f "$COMPOSE_FILE" "$@")
}

aguardar_saude() {
  local tentativa
  for tentativa in $(seq 1 30); do
    if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"ok":true'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

exec 9>"$LOCK_FILE"
flock -n 9 || falhar "outro deploy ja esta em andamento."

TMP=$(mktemp -d /tmp/cybhorpdv-deploy.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

# --- 1. Recebe e valida o pacote -------------------------------------------
head -c "$((MAX_PACOTE_BYTES + 1))" > "$TMP/pacote.tgz"
TAMANHO=$(stat -c %s "$TMP/pacote.tgz")
[ "$TAMANHO" -gt 0 ] || falhar "pacote vazio."
[ "$TAMANHO" -le "$MAX_PACOTE_BYTES" ] || falhar "pacote maior que o limite."

mkdir "$TMP/novo"
# GNU tar ja recusa caminhos absolutos e '..'; links simbolicos sao barrados abaixo.
tar -xzf "$TMP/pacote.tgz" -C "$TMP/novo" --no-same-owner --no-same-permissions \
  || falhar "pacote corrompido."

if find "$TMP/novo" -type l | grep -q .; then
  falhar "pacote contem links simbolicos."
fi
for item in "${DIRETORIOS[@]}"; do
  [ -d "$TMP/novo/$item" ] || falhar "pacote sem a pasta $item/."
done
for item in "${ARQUIVOS[@]}"; do
  [ -f "$TMP/novo/$item" ] || falhar "pacote sem o arquivo $item."
done
[ -f "$TMP/novo/app/main.py" ] || falhar "pacote sem app/main.py."

REVISAO=$(head -c 64 "$TMP/novo/REVISION" 2>/dev/null | tr -cd '0-9a-f' || true)
log "Iniciando deploy da revisao ${REVISAO:-desconhecida} (${TAMANHO} bytes)."

# --- 2. Backup do que esta no ar -------------------------------------------
CARIMBO=$(date +%Y%m%d-%H%M%S)
BACKUP="$BACKUP_DIR/$CARIMBO.tgz"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
ITENS_BACKUP=("${DIRETORIOS[@]}" "${ARQUIVOS[@]}")
if [ -f "$APP_DIR/REVISION" ]; then
  ITENS_BACKUP+=(REVISION)
fi
tar -czf "$BACKUP" -C "$APP_DIR" "${ITENS_BACKUP[@]}"
ls -1t "$BACKUP_DIR"/*.tgz | tail -n +"$((BACKUPS_MANTIDOS + 1))" | xargs -r rm -f
log "Backup salvo em $BACKUP."

aplicar_pacote() {
  local origem=$1
  local item
  for item in "${DIRETORIOS[@]}"; do
    mkdir -p "$APP_DIR/$item"
    rsync -rlt --delete --exclude '__pycache__' --chmod=D755,F644 \
      "$origem/$item/" "$APP_DIR/$item/"
  done
  for item in "${ARQUIVOS[@]}"; do
    install -m 644 "$origem/$item" "$APP_DIR/$item"
  done
  if [ -f "$origem/REVISION" ]; then
    install -m 644 "$origem/REVISION" "$APP_DIR/REVISION"
  fi
}

restaurar_backup() {
  log "Restaurando versao anterior a partir de $BACKUP."
  local restauracao="$TMP/restauracao"
  rm -rf "$restauracao"
  mkdir "$restauracao"
  tar -xzf "$BACKUP" -C "$restauracao"
  aplicar_pacote "$restauracao"
  compose up -d --build "$SERVICO" >>"$LOG_FILE" 2>&1 || true
  if aguardar_saude; then
    log "Versao anterior restaurada e saudavel."
  else
    log "ATENCAO: versao anterior restaurada, mas a API nao respondeu ao healthcheck."
  fi
}

# --- 3/4. Copia arquivos e gera a imagem nova (container antigo segue no ar)
aplicar_pacote "$TMP/novo"
log "Gerando imagem nova."
if ! compose build "$SERVICO" 2>&1 | tee -a "$LOG_FILE" | tail -n 20; then
  restaurar_backup
  falhar "build da imagem falhou."
fi

# --- 5. Pre-checagem: a imagem nova aceita o .env de producao? ---------------
log "Validando configuracao na imagem nova."
if ! compose run --rm --no-deps -T "$SERVICO" python -c \
  "from app.config import get_settings; get_settings().validar_obrigatorias()" \
  2>&1 | tee -a "$LOG_FILE" | tail -n 5; then
  restaurar_backup
  falhar "configuracao invalida para a versao nova (veja a variavel acima no .env)."
fi

# --- 6/7. Troca o container e confere saude ---------------------------------
log "Subindo container novo."
if ! compose up -d "$SERVICO" 2>&1 | tee -a "$LOG_FILE" | tail -n 5; then
  restaurar_backup
  falhar "nao foi possivel subir o container novo."
fi

if ! aguardar_saude; then
  docker logs --tail 40 "$CONTAINER" 2>&1 | tee -a "$LOG_FILE" || true
  restaurar_backup
  falhar "API nova nao passou no healthcheck."
fi

# Garante que o container esta rodando exatamente o codigo recebido.
ESPERADO=$(sha256sum "$TMP/novo/app/main.py" | cut -d' ' -f1)
NO_AR=$(docker exec "$CONTAINER" sha256sum /app/app/main.py | cut -d' ' -f1)
if [ "$ESPERADO" != "$NO_AR" ]; then
  restaurar_backup
  falhar "container nao esta com o codigo novo (cache de build inconsistente)."
fi

log "Deploy concluido: revisao ${REVISAO:-desconhecida} no ar."
