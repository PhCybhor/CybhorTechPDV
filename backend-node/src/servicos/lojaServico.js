import { randomBytes, randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { avaliarAssinatura } from "../regras/assinatura.js";
import { lerTextoLimpo, somenteAlfanumericos } from "../regras/entrada.js";
import { gerarHashSenha, gerarSalt, validarTamanhoSenha } from "../seguranca/senha.js";

// Sem 0/O, 1/I/L: a chave é digitada à mão no desktop.
const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TAMANHO_CODIGO = 6;
const CODIGO_DESENVOLVIMENTO = "DEVLOCAL";
const EMAIL_DESENVOLVIMENTO = "dev@cybhor.local";

/** @returns {string} código aleatório de 6 caracteres. */
export function gerarCodigoLoja() {
  return [...randomBytes(TAMANHO_CODIGO)].map((byte) => ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length]).join("");
}

async function gerarCodigoLivre(tx, tentativas, lojaIdIgnorada = null) {
  let codigo = gerarCodigoLoja();
  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    const ocupado = lojaIdIgnorada
      ? await tx.consultar("SELECT 1 FROM lojas WHERE codigo = ? AND id <> ?", [codigo, lojaIdIgnorada])
      : await tx.consultar("SELECT 1 FROM lojas WHERE codigo = ?", [codigo]);
    if (!ocupado.length) break;
    codigo = gerarCodigoLoja();
  }
  return codigo;
}

function validarDadosNovaLoja(loja, admin) {
  const nome = lerTextoLimpo(loja.nome);
  if (nome.length < 2) throw new ErroNegocio("Informe o nome da loja.");

  const primeiroNome = lerTextoLimpo(admin.nome || admin.primeiroNome);
  const sobrenome = lerTextoLimpo(admin.sobrenome);
  const nomeAdmin = `${primeiroNome} ${sobrenome}`.trim();
  const usuario = lerTextoLimpo(admin.usuario).toLowerCase();
  const email = lerTextoLimpo(loja.email || admin.email).toLowerCase();

  if (primeiroNome.length < 2) throw new ErroNegocio("Informe seu nome.");
  if (sobrenome.length < 2) throw new ErroNegocio("Informe seu sobrenome.");
  if (nomeAdmin.length < 2) throw new ErroNegocio("Informe o nome do administrador.");
  if (usuario.length < 3) throw new ErroNegocio("O usuario deve ter ao menos 3 caracteres.");
  const senha = validarTamanhoSenha(admin.senha || "");
  if (!email.includes("@")) throw new ErroNegocio("Informe um e-mail valido.");

  return { nome, primeiroNome, sobrenome, nomeAdmin, usuario, email, senha };
}

async function inserirAssinaturaInicial(tx, lojaId, { aguardarPagamento, diasValidade, plano, trialCpf }) {
  if (aguardarPagamento) {
    await tx.executar("INSERT INTO assinaturas (id, loja_id, status, valida_ate) VALUES (?, ?, 'pendente', NULL)", [
      randomUUID(),
      lojaId,
    ]);
    return;
  }
  if (diasValidade) {
    await tx.executar(
      `INSERT INTO assinaturas (id, loja_id, status, valida_ate, plano, valor_mensal)
       VALUES (?, ?, 'ativa', DATE_ADD(CURRENT_DATE, INTERVAL ? DAY), ?, 0)`,
      [randomUUID(), lojaId, Math.trunc(diasValidade), plano || "teste"],
    );
    if (trialCpf) {
      try {
        await tx.executar("INSERT INTO trials_cpf (cpf, loja_id) VALUES (?, ?)", [trialCpf, lojaId]);
      } catch (erro) {
        if (db.ehChaveDuplicada(erro)) {
          throw new ErroNegocio("Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.", 409);
        }
        throw erro;
      }
    }
    return;
  }
  await tx.executar(
    "INSERT INTO assinaturas (id, loja_id, status, valida_ate) VALUES (?, ?, 'ativa', DATE_ADD(CURRENT_DATE, INTERVAL 1 YEAR))",
    [randomUUID(), lojaId],
  );
}

/**
 * Cria loja, administrador e assinatura numa única transação.
 * `aceiteDiretrizes` (já validado) é gravado na mesma transação: não existe
 * loja comprada pelo site sem o registro do aceite.
 * @returns {Promise<{ lojaId: string, codigo: string }>}
 */
export async function criarLojaComAdmin({
  loja = {},
  admin = {},
  aguardarPagamento = false,
  cpf = "",
  diasValidade = null,
  plano = "",
  trialCpf = "",
  aceiteDiretrizes = null,
}) {
  const dados = validarDadosNovaLoja(loja, admin);
  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(dados.senha, salt);
  const lojaId = randomUUID();

  const codigo = await db.transacao(async (tx) => {
    const codigoLivre = await gerarCodigoLivre(tx, 5);
    await tx.executar(
      `INSERT INTO lojas (id, nome, cnpj, endereco, telefone, email, cpf,
                          responsavel_nome, responsavel_sobrenome, codigo, ativa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lojaId,
        dados.nome,
        lerTextoLimpo(loja.cnpj),
        lerTextoLimpo(loja.endereco),
        lerTextoLimpo(loja.telefone),
        dados.email,
        cpf || "",
        dados.primeiroNome,
        dados.sobrenome,
        codigoLivre,
        !aguardarPagamento,
      ],
    );
    await tx.executar(
      `INSERT INTO funcionarios (id, loja_id, nome, usuario, salt, senha_hash, cargo, dados)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', '{}')`,
      [randomUUID(), lojaId, dados.nomeAdmin, dados.usuario, salt, senhaHash],
    );
    await inserirAssinaturaInicial(tx, lojaId, { aguardarPagamento, diasValidade, plano, trialCpf });

    if (aceiteDiretrizes) {
      await tx.executar(
        "INSERT INTO aceites_diretrizes (id, loja_id, versao, ip, navegador) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), lojaId, aceiteDiretrizes.versao, aceiteDiretrizes.ip || "", aceiteDiretrizes.navegador || ""],
      );
    }
    return codigoLivre;
  });

  return { lojaId, codigo };
}

/**
 * @param {unknown} codigo chave digitada no desktop (aceita traços/espaços).
 * @returns {Promise<{ lojaId: string, nome: string }>}
 */
export async function buscarLojaPorCodigo(codigo) {
  const codigoLimpo = somenteAlfanumericos(lerTextoLimpo(codigo).toUpperCase());
  if (codigoLimpo.length < 6) throw new ErroNegocio("Codigo da loja invalido.");

  const linhas = await db.consultar("SELECT id, nome, ativa FROM lojas WHERE codigo = ?", [codigoLimpo]);
  if (!linhas.length) throw new ErroNegocio("Loja nao encontrada. Confira o codigo.", 404);
  if (!linhas[0].ativa) throw new ErroNegocio("Loja desativada. Fale com o suporte.", 403);
  return { lojaId: linhas[0].id, nome: linhas[0].nome };
}

/** Perfil da loja com a situação da assinatura já avaliada. */
export async function obterPerfil(lojaId) {
  const linhas = await db.consultar(
    `SELECT l.id, l.nome, l.cnpj, l.endereco, l.telefone, l.codigo,
            a.plano, a.status AS assinaturaStatus, a.valida_ate AS validaAte
     FROM lojas l
     LEFT JOIN assinaturas a ON a.loja_id = l.id
     WHERE l.id = ?`,
    [lojaId],
  );
  if (!linhas.length) throw new ErroNegocio("Loja nao encontrada.", 404);
  const perfil = linhas[0];
  const situacao = avaliarAssinatura(perfil.assinaturaStatus, perfil.validaAte);
  return {
    ...perfil,
    assinaturaAtrasada: situacao.atrasada,
    assinaturaBloqueada: situacao.bloqueada,
    assinaturaRotulo: situacao.rotulo,
    assinaturaMensagem: situacao.mensagem,
    assinaturaStatusExibicao: situacao.statusExibicao,
  };
}

/** Gera uma nova chave de conexão para a loja (invalida a anterior). */
export async function regenerarCodigoLoja(lojaId) {
  const existente = await db.consultar("SELECT id FROM lojas WHERE id = ?", [lojaId]);
  if (!existente.length) throw new ErroNegocio("Loja nao encontrada.", 404);

  const codigo = await db.transacao(async (tx) => {
    const codigoLivre = await gerarCodigoLivre(tx, 8, lojaId);
    await tx.executar("UPDATE lojas SET codigo = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ?", [codigoLivre, lojaId]);
    return codigoLivre;
  });
  return { codigo };
}

/** Usa o código da loja como chave de ativação do desktop. */
export async function ativarPorCodigo(codigo) {
  const loja = await buscarLojaPorCodigo(codigo);
  const perfil = await obterPerfil(loja.lojaId);
  return { ok: true, lojaId: loja.lojaId, email: "", nomeLoja: perfil.nome };
}

/** Loja DEVLOCAL para desenvolvimento do desktop sem pagamento. */
export async function obterOuCriarLojaDesenvolvimento() {
  const linhas = await db.consultar("SELECT id, nome FROM lojas WHERE codigo = ? LIMIT 1", [CODIGO_DESENVOLVIMENTO]);
  if (linhas.length) {
    return { ok: true, lojaId: linhas[0].id, email: EMAIL_DESENVOLVIMENTO, nomeLoja: linhas[0].nome };
  }

  const lojaId = randomUUID();
  await db.transacao(async (tx) => {
    await tx.executar(
      `INSERT INTO lojas (id, nome, email, responsavel_nome, responsavel_sobrenome, codigo, ativa)
       VALUES (?, 'Loja desenvolvimento', ?, 'Administrador', 'Local', ?, TRUE)`,
      [lojaId, EMAIL_DESENVOLVIMENTO, CODIGO_DESENVOLVIMENTO],
    );
    await tx.executar("INSERT INTO assinaturas (id, loja_id, status, valor_mensal) VALUES (?, ?, 'ativa', 0)", [
      randomUUID(),
      lojaId,
    ]);
  });
  return { ok: true, lojaId, email: EMAIL_DESENVOLVIMENTO, nomeLoja: "Loja desenvolvimento" };
}
