"use strict";

const crypto = require("crypto");
const { consultar, transacao } = require("../config/db");
const { ErroNegocio } = require("../middlewares/erros");
const { gerarSalt, gerarHashSenha } = require("../utils/senha");

const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function gerarCodigoLoja() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes)
    .map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length])
    .join("");
}

/**
 * Cria a loja com seu administrador inicial e assinatura pendente,
 * tudo em uma transacao.
 * @param {{loja: object, admin: object, aguardarPagamento?: boolean}} dados
 * @returns {Promise<{lojaId: string, codigo: string}>}
 */
async function criarLojaComAdmin({ loja, admin, aguardarPagamento = false }) {
  const nome = (loja?.nome || "").trim();
  if (nome.length < 2) throw new ErroNegocio("Informe o nome da loja.");

  const primeiroNome = (admin?.nome || admin?.primeiroNome || "").trim();
  const sobrenome = (admin?.sobrenome || "").trim();
  const nomeAdmin = `${primeiroNome} ${sobrenome}`.trim();
  const usuario = (admin?.usuario || "").trim().toLowerCase();
  const email = (loja?.email || admin?.email || "").trim().toLowerCase();
  if (primeiroNome.length < 2) throw new ErroNegocio("Informe seu nome.");
  if (sobrenome.length < 2) throw new ErroNegocio("Informe seu sobrenome.");
  if (nomeAdmin.length < 2) throw new ErroNegocio("Informe o nome do administrador.");
  if (usuario.length < 3) throw new ErroNegocio("O usuario deve ter ao menos 3 caracteres.");
  if ((admin?.senha || "").length < 4)
    throw new ErroNegocio("A senha deve ter ao menos 4 caracteres.");
  if (aguardarPagamento && !email.includes("@"))
    throw new ErroNegocio("Informe um e-mail valido.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(admin.senha, salt);

  return transacao(async (cliente) => {
    let codigo = gerarCodigoLoja();
    for (let i = 0; i < 5; i += 1) {
      const existente = await cliente.query("SELECT 1 FROM lojas WHERE codigo = $1", [codigo]);
      if (existente.rowCount === 0) break;
      codigo = gerarCodigoLoja();
    }

    const lojaCriada = await cliente.query(
      `INSERT INTO lojas (nome, cnpj, endereco, telefone, email, responsavel_nome, responsavel_sobrenome, codigo, ativa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        nome,
        (loja.cnpj || "").trim(),
        (loja.endereco || "").trim(),
        (loja.telefone || "").trim(),
        email,
        primeiroNome,
        sobrenome,
        codigo,
        !aguardarPagamento,
      ]
    );
    const lojaId = lojaCriada.rows[0].id;

    await cliente.query(
      `INSERT INTO funcionarios (loja_id, nome, usuario, salt, senha_hash, cargo)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [lojaId, nomeAdmin, usuario, salt, senhaHash]
    );

    await cliente.query(
      `INSERT INTO assinaturas (loja_id, status) VALUES ($1, 'pendente')`,
      [lojaId]
    );

    return { lojaId, codigo };
  });
}

/**
 * Resolve o codigo de conexao para os dados publicos da loja.
 * @param {string} codigo
 * @returns {Promise<{lojaId: string, nome: string}>}
 */
async function buscarLojaPorCodigo(codigo) {
  const codigoLimpo = (codigo || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (codigoLimpo.length < 6) throw new ErroNegocio("Codigo da loja invalido.");

  const resultado = await consultar(
    "SELECT id, nome, ativa FROM lojas WHERE codigo = $1",
    [codigoLimpo]
  );
  if (resultado.rowCount === 0)
    throw new ErroNegocio("Loja nao encontrada. Confira o codigo.", 404);

  const loja = resultado.rows[0];
  if (!loja.ativa)
    throw new ErroNegocio("Loja desativada. Fale com o suporte.", 403);

  return { lojaId: loja.id, nome: loja.nome };
}

/**
 * Perfil da loja (cabecalho do cupom).
 * @param {string} lojaId
 */
async function obterPerfil(lojaId) {
  const resultado = await consultar(
    "SELECT id, nome, cnpj, endereco, telefone, codigo FROM lojas WHERE id = $1",
    [lojaId]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Loja nao encontrada.", 404);
  return resultado.rows[0];
}

module.exports = { criarLojaComAdmin, buscarLojaPorCodigo, obterPerfil };
