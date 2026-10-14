#!/usr/bin/env python3
"""Exporta os dados do CybhorPDV do PostgreSQL em JSON Lines (stdout) para a migração ao MySQL.

Roda dentro do container da API Python, que já tem psycopg2 e DATABASE_URL; nada é
instalado na VPS e o container (read-only) recebe o script pelo stdin:

    docker exec -i cybhorpdv-api python - < exportar_postgres.py | gzip > cybhorpdv-export.jsonl.gz

Formato: 1ª linha = cabeçalho (contagens e totais), depois uma linha por registro
{"tabela", "linha"}, e a última = rodapé {"fim": true}. Sem rodapé, o arquivo veio cortado
e o importador recusa. Tudo é lido num único snapshot (REPEATABLE READ, somente leitura),
então o arquivo é consistente mesmo com a API recebendo vendas durante a exportação.

O arquivo contém hashes de senha, CPFs e e-mails: trate como dado sensível.
"""
from __future__ import annotations

import datetime
import decimal
import json
import os
import sys
import uuid

import psycopg2
import psycopg2.extensions

FORMATO = "cybhorpdv-export"
VERSAO_FORMATO = 1
LINHAS_POR_LOTE = 1000

# Ordem respeita as chaves estrangeiras (pais antes dos filhos).
TABELAS = [
    ("lojas", ["id", "nome", "cnpj", "endereco", "telefone", "email", "cpf", "responsavel_nome",
               "responsavel_sobrenome", "codigo", "ativa", "criado_em", "atualizado_em"]),
    ("funcionarios", ["id", "loja_id", "nome", "usuario", "salt", "senha_hash", "cargo", "dados",
                      "criado_em", "atualizado_em"]),
    ("produtos", ["id", "loja_id", "nome", "codigo_barras", "preco", "estoque", "categoria",
                  "criado_em", "atualizado_em"]),
    ("vendas", ["id", "loja_id", "funcionario_id", "funcionario_nome", "subtotal", "desconto", "total",
                "forma_pagamento", "criado_em"]),
    ("venda_itens", ["id", "venda_id", "produto_id", "nome", "quantidade", "preco_unitario", "subtotal"]),
    ("administradores_sistema", ["id", "nome", "email", "salt", "senha_hash", "criado_em"]),
    ("assinaturas", ["id", "loja_id", "plano", "valor_mensal", "status", "mp_preference_id",
                     "token_ativacao", "valida_ate", "atualizado_em"]),
    ("pagamentos", ["id", "loja_id", "mp_payment_id", "status", "valor", "payload", "criado_em"]),
    ("trials_cpf", ["cpf", "loja_id", "criado_em"]),
    ("aceites_diretrizes", ["id", "loja_id", "versao", "ip", "navegador", "aceito_em"]),
    ("documentos_loja", ["loja_id", "recurso", "dados", "atualizado_em"]),
]

# Somas conferidas pelo importador depois de gravar (em centavos, sem erro de float).
TOTAIS_CONFERIDOS = [("vendas", "total"), ("pagamentos", "valor")]


def serializar(valor):
    """Tipos do psycopg2 em JSON sem perder precisão (decimal vira texto)."""
    if isinstance(valor, uuid.UUID):
        return str(valor)
    if isinstance(valor, datetime.datetime):
        if valor.tzinfo is None:
            valor = valor.replace(tzinfo=datetime.timezone.utc)
        return valor.astimezone(datetime.timezone.utc).isoformat()
    if isinstance(valor, datetime.date):
        return valor.isoformat()
    if isinstance(valor, decimal.Decimal):
        return str(valor)
    raise TypeError(f"Tipo nao suportado na exportacao: {type(valor).__name__}")


def escrever(registro):
    sys.stdout.write(json.dumps(registro, default=serializar, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")


def colunas_existentes(cursor, tabela):
    cursor.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = %s",
        (tabela,),
    )
    return {linha[0] for linha in cursor.fetchall()}


def montar_plano(cursor):
    """Colunas a exportar por tabela; colunas de versões novas do schema podem faltar."""
    plano = []
    ausentes = {}
    for tabela, esperadas in TABELAS:
        existentes = colunas_existentes(cursor, tabela)
        if not existentes:
            raise RuntimeError(f"Tabela {tabela} nao existe no PostgreSQL.")
        plano.append((tabela, [coluna for coluna in esperadas if coluna in existentes]))
        faltando = [coluna for coluna in esperadas if coluna not in existentes]
        if faltando:
            ausentes[tabela] = faltando
    return plano, ausentes


def contar(cursor, plano):
    contagens = {}
    for tabela, _colunas in plano:
        cursor.execute(f'SELECT count(*) FROM "{tabela}"')
        contagens[tabela] = cursor.fetchone()[0]
    totais = {}
    for tabela, coluna in TOTAIS_CONFERIDOS:
        cursor.execute(f'SELECT COALESCE(sum("{coluna}"), 0) FROM "{tabela}"')
        totais[f"{tabela}.{coluna}"] = cursor.fetchone()[0]
    return contagens, totais


def exportar_tabela(conexao, tabela, colunas):
    lista = ", ".join(f'"{coluna}"' for coluna in colunas)
    chave = '"id"' if "id" in colunas else ", ".join(f'"{coluna}"' for coluna in colunas[:2])
    # Cursor nomeado = cursor no servidor: lê em lotes sem carregar a tabela na memória.
    with conexao.cursor(name=f"exportar_{tabela}") as cursor:
        cursor.itersize = LINHAS_POR_LOTE
        cursor.execute(f'SELECT {lista} FROM "{tabela}" ORDER BY {chave}')
        quantidade = 0
        for linha in cursor:
            escrever({"tabela": tabela, "linha": dict(zip(colunas, linha))})
            quantidade += 1
    return quantidade


def main():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        sys.stderr.write("DATABASE_URL nao definido.\n")
        return 1

    conexao = psycopg2.connect(url)
    try:
        conexao.set_session(
            isolation_level=psycopg2.extensions.ISOLATION_LEVEL_REPEATABLE_READ,
            readonly=True,
        )
        with conexao.cursor() as cursor:
            plano, ausentes = montar_plano(cursor)
            contagens, totais = contar(cursor, plano)

        escrever({
            "formato": FORMATO,
            "versao": VERSAO_FORMATO,
            "geradoEm": datetime.datetime.now(datetime.timezone.utc),
            "contagens": contagens,
            "totais": totais,
            "colunasAusentes": ausentes,
        })
        total_linhas = 0
        for tabela, colunas in plano:
            exportadas = exportar_tabela(conexao, tabela, colunas)
            sys.stderr.write(f"{tabela}: {exportadas}\n")
            total_linhas += exportadas
        escrever({"fim": True, "linhas": total_linhas})
        conexao.rollback()
    finally:
        conexao.close()
    sys.stderr.write(f"Exportacao concluida: {total_linhas} registros.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
