#!/usr/bin/env bash
set -euo pipefail

# Aplica o schema no PostgreSQL da VPS (container ICP).
# Uso: DATABASE_URL=postgres://... ./scripts/aplicar_schema.sh

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL e obrigatorio"
  exit 1
fi

python - <<'PY'
import os
import pathlib
import psycopg2

url = os.environ["DATABASE_URL"]
sql = pathlib.Path("db/schema.sql").read_text(encoding="utf-8")
with psycopg2.connect(url) as conn:
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
print("Schema aplicado com sucesso.")
PY
