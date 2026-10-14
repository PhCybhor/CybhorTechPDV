#!/usr/bin/env bash
# Gera o .zip do site (landing/) para extrair na public_html da Hostinger.
# A API continua na VPS; o .htaccess repoe os cabecalhos de seguranca que,
# na VPS, sao enviados pela propria API.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAIDA="$RAIZ/dist-site"
PACOTE="$SAIDA/cybhorpdv-site-hostinger.zip"
TEMPORARIO="$(mktemp -d)"
trap 'rm -rf "$TEMPORARIO"' EXIT

cp -R "$RAIZ/landing/." "$TEMPORARIO/"
cp "$RAIZ/scripts/hostinger/.htaccess" "$TEMPORARIO/.htaccess"

mkdir -p "$SAIDA"
rm -f "$PACOTE"
(cd "$TEMPORARIO" && zip -rq "$PACOTE" .)

echo "Pacote gerado: $PACOTE"
