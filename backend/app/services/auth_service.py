from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List

from app import db
from app.deps import emitir_token
from app.errors import ErroNegocio
from app.security import (
    gerar_hash_senha,
    gerar_salt,
    validar_tamanho_senha,
    verificar_senha,
)


def _exigir_assinatura_valida(loja_id: str) -> None:
    rows = db.consultar(
        "SELECT status, valida_ate FROM assinaturas WHERE loja_id = %s",
        (loja_id,),
    )
    if not rows:
        return
    status = rows[0]["status"]
    valida_ate = rows[0]["valida_ate"]
    if status != "ativa":
        raise ErroNegocio(
            "Assinatura inativa. Regularize o pagamento para continuar.", 403
        )
    if valida_ate is not None and valida_ate < date.today():
        raise ErroNegocio(
            "Assinatura expirada. Renove o pagamento para continuar.", 403
        )


def _normalizar_chave(valor: str) -> str:
    return "".join(c for c in (valor or "").strip().upper() if c.isalnum())


_PERMISSOES_OPERADOR = {
    "cadastrarProduto": True,
    "editarProduto": True,
    "excluirProduto": False,
    "ajustarEstoque": True,
    "aplicarDesconto": True,
    "venderFiado": True,
    "verHistorico": True,
    "cancelarVenda": False,
    "fazerSangria": True,
    "gerenciarClientes": False,
}


def _como_bool(valor: Any, padrao: bool) -> bool:
    if valor is None:
        return padrao
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return valor != 0
    if isinstance(valor, str):
        texto = valor.strip().lower()
        if texto in ("", "0", "false", "nao", "não", "off", "no"):
            return False
        if texto in ("1", "true", "sim", "yes", "on"):
            return True
    return bool(valor)


def _normalizar_permissoes(valor: Any) -> Dict[str, bool]:
    bruto = valor if isinstance(valor, dict) else {}
    saida: Dict[str, bool] = {}
    for chave, padrao in _PERMISSOES_OPERADOR.items():
        if chave in bruto:
            saida[chave] = _como_bool(bruto[chave], padrao)
        else:
            saida[chave] = padrao
    return saida


def obter_permissoes_funcionario(loja_id: str, funcionario_id: str) -> Dict[str, bool]:
    rows = db.consultar(
        "SELECT cargo, dados FROM funcionarios WHERE loja_id = %s AND id = %s",
        (loja_id, funcionario_id),
    )
    if not rows:
        return {chave: False for chave in _PERMISSOES_OPERADOR}
    if rows[0].get("cargo") == "admin":
        return {chave: True for chave in _PERMISSOES_OPERADOR}
    extras = rows[0].get("dados") or {}
    if not isinstance(extras, dict):
        extras = {}
    return _normalizar_permissoes(extras.get("permissoes"))


def login_loja(
    *,
    codigo_loja: str,
    loja_id: str,
    usuario: str,
    senha: str,
    email: str = "",
) -> Dict[str, Any]:
    codigo = (codigo_loja or "").strip().upper()
    loja_id_limpo = (loja_id or "").strip()
    usuario_limpo = (usuario or "").strip().lower()
    email_limpo = (email or "").strip().lower()

    if not usuario_limpo:
        raise ErroNegocio("Informe o usuario.", 400)

    # Desktop: codigo/lojaId. Site/portal: usuario+senha (e-mail desambigua se
    # o mesmo usuario existir em mais de uma loja).
    if codigo or loja_id_limpo:
        rows = db.consultar(
            """
            SELECT f.id, f.nome, f.usuario, f.cargo, f.salt, f.senha_hash,
                   f.dados, f.loja_id, l.ativa, l.codigo AS loja_codigo,
                   l.nome AS loja_nome
            FROM funcionarios f
            JOIN lojas l ON l.id = f.loja_id
            WHERE (l.codigo = %s OR l.id::text = %s) AND f.usuario = %s
            """,
            (codigo, loja_id_limpo, usuario_limpo),
        )
    elif email_limpo:
        rows = db.consultar(
            """
            SELECT f.id, f.nome, f.usuario, f.cargo, f.salt, f.senha_hash,
                   f.dados, f.loja_id, l.ativa, l.codigo AS loja_codigo,
                   l.nome AS loja_nome
            FROM funcionarios f
            JOIN lojas l ON l.id = f.loja_id
            WHERE lower(l.email) = %s AND f.usuario = %s
            """,
            (email_limpo, usuario_limpo),
        )
    else:
        rows = db.consultar(
            """
            SELECT f.id, f.nome, f.usuario, f.cargo, f.salt, f.senha_hash,
                   f.dados, f.loja_id, l.ativa, l.codigo AS loja_codigo,
                   l.nome AS loja_nome
            FROM funcionarios f
            JOIN lojas l ON l.id = f.loja_id
            WHERE f.usuario = %s
            """,
            (usuario_limpo,),
        )

    if not rows:
        raise ErroNegocio("Usuario ou senha invalidos.", 401)

    candidatas = [
        r for r in rows if verificar_senha(senha or "", r["salt"], r["senha_hash"])
    ]
    if not candidatas:
        raise ErroNegocio("Usuario ou senha invalidos.", 401)
    if len(candidatas) > 1:
        raise ErroNegocio(
            "Ha mais de uma loja com este usuario. Informe tambem o e-mail "
            "cadastrado no pagamento.",
            400,
        )

    conta = candidatas[0]
    if not conta["ativa"]:
        raise ErroNegocio(
            "Loja ainda nao ativada ou desativada. Confirme o pagamento ou "
            "fale com o suporte.",
            403,
        )

    _exigir_assinatura_valida(str(conta["loja_id"]))

    extras = conta.get("dados") or {}
    if not isinstance(extras, dict):
        extras = {}
    token = emitir_token(
        {
            "tipo": "loja",
            "lojaId": str(conta["loja_id"]),
            "funcionarioId": str(conta["id"]),
            "cargo": conta["cargo"],
            "nome": conta["nome"],
        }
    )
    return {
        "token": token,
        "funcionario": {
            "id": str(conta["id"]),
            "nome": conta["nome"],
            "usuario": conta["usuario"],
            "cargo": conta["cargo"],
            "areas": extras.get("areas") or [],
            "permissoes": _normalizar_permissoes(extras.get("permissoes")),
        },
        "loja": {
            "id": str(conta["loja_id"]),
            "nome": conta["loja_nome"],
            "codigo": conta["loja_codigo"],
        },
    }


def criar_funcionario(loja_id: str, dados: Dict[str, Any]) -> Dict[str, str]:
    nome = (dados.get("nome") or "").strip()
    usuario = (dados.get("usuario") or "").strip().lower()
    senha = validar_tamanho_senha(dados.get("senha") or "")
    cargo = dados.get("cargo")

    if len(nome) < 2:
        raise ErroNegocio("Informe o nome do funcionario.")
    if len(usuario) < 3:
        raise ErroNegocio("O usuario deve ter ao menos 3 caracteres.")
    if cargo not in ("admin", "operador"):
        raise ErroNegocio("Cargo invalido.")

    existente = db.consultar(
        "SELECT 1 FROM funcionarios WHERE loja_id = %s AND usuario = %s",
        (loja_id, usuario),
    )
    if existente:
        raise ErroNegocio("Ja existe um funcionario com esse usuario.")

    salt = gerar_salt()
    senha_hash = gerar_hash_senha(senha, salt)
    rows = db.consultar(
        """
        INSERT INTO funcionarios
            (loja_id, nome, usuario, salt, senha_hash, cargo, dados)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb) RETURNING id
        """,
        (
            loja_id,
            nome,
            usuario,
            salt,
            senha_hash,
            cargo,
            json.dumps(
                {
                    "areas": dados.get("areas") or [],
                    "permissoes": _normalizar_permissoes(dados.get("permissoes")),
                }
            ),
        ),
    )
    return {"id": str(rows[0]["id"])}


def listar_funcionarios(loja_id: str) -> List[Dict[str, Any]]:
    rows = db.consultar(
        """
        SELECT id, nome, usuario, cargo, dados,
               criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
        FROM funcionarios WHERE loja_id = %s ORDER BY nome
        """,
        (loja_id,),
    )
    for r in rows:
        r["id"] = str(r["id"])
        extras = r.pop("dados") or {}
        if isinstance(extras, dict):
            r.update(extras)
        r["permissoes"] = _normalizar_permissoes(r.get("permissoes"))
    return rows


def existe_administrador(loja_id: str) -> bool:
    rows = db.consultar(
        """
        SELECT 1 FROM funcionarios
        WHERE loja_id = %s AND cargo = 'admin'
        LIMIT 1
        """,
        (loja_id,),
    )
    return bool(rows)


def criar_admin_inicial(loja_id: str, dados: Dict[str, Any]) -> Dict[str, str]:
    chave = (dados.get("chaveAtivacao") or dados.get("codigoLoja") or "").strip()
    if len(_normalizar_chave(chave)) < 6:
        raise ErroNegocio("Informe a chave de ativacao da loja.", 403)

    lojas = db.consultar(
        "SELECT codigo FROM lojas WHERE id = %s AND ativa = TRUE", (loja_id,)
    )
    if not lojas:
        raise ErroNegocio("Loja nao encontrada ou desativada.", 404)

    codigo_loja = _normalizar_chave(lojas[0]["codigo"])
    chave_norm = _normalizar_chave(chave)
    # Aceita o codigo da loja ou DEV-LOCAL (vira DEVLOCAL).
    if chave_norm != codigo_loja and not (
        chave_norm == "DEVLOCAL" and codigo_loja == "DEVLOCAL"
    ):
        raise ErroNegocio("Chave de ativacao invalida.", 403)

    if existe_administrador(loja_id):
        raise ErroNegocio("O administrador inicial ja foi criado.", 409)

    dados_admin = dict(dados)
    dados_admin["cargo"] = "admin"
    return criar_funcionario(loja_id, dados_admin)


def atualizar_funcionario(
    loja_id: str, funcionario_id: str, dados: Dict[str, Any]
) -> None:
    existente = db.consultar(
        """
        SELECT id, cargo, dados FROM funcionarios
        WHERE id = %s AND loja_id = %s
        """,
        (funcionario_id, loja_id),
    )
    if not existente:
        raise ErroNegocio("Funcionario nao encontrado.", 404)

    cargo = dados.get("cargo")
    if cargo is not None:
        if cargo not in ("admin", "operador"):
            raise ErroNegocio("Cargo invalido.")
        if existente[0]["cargo"] == "admin" and cargo == "operador":
            admins = db.consultar(
                """
                SELECT count(*)::int AS total FROM funcionarios
                WHERE loja_id = %s AND cargo = 'admin'
                """,
                (loja_id,),
            )
            if admins[0]["total"] <= 1:
                raise ErroNegocio(
                    "Nao e possivel rebaixar o unico administrador do sistema."
                )
        db.executar(
            """
            UPDATE funcionarios SET cargo = %s, atualizado_em = now()
            WHERE id = %s AND loja_id = %s
            """,
            (cargo, funcionario_id, loja_id),
        )

    nova_senha = dados.get("novaSenha")
    if nova_senha is not None:
        senha_ok = validar_tamanho_senha(str(nova_senha))
        salt = gerar_salt()
        senha_hash = gerar_hash_senha(senha_ok, salt)
        db.executar(
            """
            UPDATE funcionarios
            SET salt = %s, senha_hash = %s, atualizado_em = now()
            WHERE id = %s AND loja_id = %s
            """,
            (salt, senha_hash, funcionario_id, loja_id),
        )

    extras_permitidos = {
        "areas",
        "permissoes",
        "tipoVinculo",
        "salarioBruto",
        "dependentes",
        "valorContrato",
    }
    extras = {k: v for k, v in dados.items() if k in extras_permitidos}
    if "permissoes" in extras:
        extras["permissoes"] = _normalizar_permissoes(extras.get("permissoes"))
    if extras:
        db.executar(
            """
            UPDATE funcionarios
            SET dados = dados || %s::jsonb, atualizado_em = now()
            WHERE id = %s AND loja_id = %s
            """,
            (json.dumps(extras), funcionario_id, loja_id),
        )


# --- Gates de escrita em /dados (operador vs admin) ---

# Vendas novas/cancelamento passam por /caixa/*; operador nao grava vendas via /dados
# (evita bypass de cancelarVenda / baixa de estoque).
RECURSOS_OPERADOR_ESCRITA = frozenset(
    {
        "produtos",
        "sangrias",
        "caixaEstado",
        "suprimentos",
        "clientes",
        "fechamentos",
    }
)


def recurso_do_caminho(caminho: str) -> str:
    partes = [p for p in str(caminho or "").strip("/").split("/") if p]
    if len(partes) >= 2 and partes[0] == "lojas":
        partes = partes[2:]
    return partes[0] if partes else ""


def _partes_caminho(caminho: str) -> List[str]:
    partes = [p for p in str(caminho or "").strip("/").split("/") if p]
    if len(partes) >= 2 and partes[0] == "lojas":
        partes = partes[2:]
    return partes


def exigir_perm(
    *,
    cargo: str,
    loja_id: str,
    funcionario_id: str,
    chave: str,
    mensagem: str,
) -> None:
    if cargo == "admin":
        return
    if not obter_permissoes_funcionario(loja_id, funcionario_id).get(chave, False):
        raise ErroNegocio(mensagem, 403)


def exigir_escrita_dados(
    *,
    cargo: str,
    loja_id: str,
    funcionario_id: str,
    caminho: str,
) -> None:
    if cargo == "admin":
        return
    recurso = recurso_do_caminho(caminho)
    if recurso not in RECURSOS_OPERADOR_ESCRITA:
        raise ErroNegocio(
            "Apenas o administrador da loja pode alterar este recurso.", 403
        )

    partes = _partes_caminho(caminho)
    perms = obter_permissoes_funcionario(loja_id, funcionario_id)

    if recurso == "clientes" and not perms.get("gerenciarClientes", False):
        raise ErroNegocio("Sem permissao para alterar clientes.", 403)
    if recurso == "sangrias" and not perms.get("fazerSangria", False):
        raise ErroNegocio("Sem permissao para sangria.", 403)
    if recurso == "produtos":
        so_estoque = len(partes) >= 3 and partes[-1] == "estoque"
        if so_estoque:
            if not perms.get("ajustarEstoque", False):
                raise ErroNegocio("Sem permissao para ajustar estoque.", 403)
        else:
            if not (
                perms.get("cadastrarProduto", False)
                or perms.get("editarProduto", False)
            ):
                raise ErroNegocio("Sem permissao para alterar produtos.", 403)


def exigir_remocao_dados(
    *,
    cargo: str,
    loja_id: str,
    funcionario_id: str,
    caminho: str,
) -> None:
    exigir_escrita_dados(
        cargo=cargo,
        loja_id=loja_id,
        funcionario_id=funcionario_id,
        caminho=caminho,
    )
    if cargo == "admin":
        return
    recurso = recurso_do_caminho(caminho)
    if recurso == "produtos" and not obter_permissoes_funcionario(
        loja_id, funcionario_id
    ).get("excluirProduto", False):
        raise ErroNegocio("Sem permissao para excluir produtos.", 403)


def exigir_lote_dados(
    *,
    cargo: str,
    loja_id: str,
    funcionario_id: str,
    atualizacoes: Dict[str, Any],
) -> None:
    if cargo == "admin":
        return
    for caminho in atualizacoes or {}:
        exigir_escrita_dados(
            cargo=cargo,
            loja_id=loja_id,
            funcionario_id=funcionario_id,
            caminho=caminho,
        )
