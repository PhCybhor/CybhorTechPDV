import { randomBytes, randomUUID } from 'node:crypto';
import { avaliarAssinatura } from '../assinatura.js';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import { gerarHashSenha, gerarSalt, validarTamanhoSenha } from '../security.js';
import { objetoOuVazio, tamanhoEmCaracteres, texto } from '../utils/valores.js';

// Sem 0/1/I/L/O para o código ditado por telefone não gerar confusão.
const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TAMANHO_CODIGO = 6;
const TENTATIVAS_CODIGO_UNICO = 5;
const TENTATIVAS_REGENERAR_CODIGO = 8;
const TAMANHO_MINIMO_CODIGO_BUSCA = 6;

export function gerarCodigoLoja() {
  return Array.from(randomBytes(TAMANHO_CODIGO), (byte) => ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length]).join('');
}

/** Sorteia um código ainda não usado por outra loja (a UNIQUE do banco é a garantia final). */
async function sortearCodigoLivre(cx, tentativas, ignorarLojaId = null) {
  let codigo = gerarCodigoLoja();
  for (let i = 0; i < tentativas; i += 1) {
    const emUso = await cx.consultar('SELECT 1 FROM lojas WHERE codigo = ? AND id <> ?', [
      codigo,
      ignorarLojaId ?? '',
    ]);
    if (emUso.length === 0) break;
    codigo = gerarCodigoLoja();
  }
  return codigo;
}

function validarDadosNovaLoja(loja, admin) {
  const nome = texto(loja.nome);
  if (tamanhoEmCaracteres(nome) < 2) throw new ErroNegocio('Informe o nome da loja.');

  const primeiroNome = texto(admin.nome || admin.primeiroNome);
  const sobrenome = texto(admin.sobrenome);
  const nomeAdmin = `${primeiroNome} ${sobrenome}`.trim();
  const usuario = texto(admin.usuario).toLowerCase();
  const email = texto(loja.email || admin.email).toLowerCase();

  if (tamanhoEmCaracteres(primeiroNome) < 2) throw new ErroNegocio('Informe seu nome.');
  if (tamanhoEmCaracteres(sobrenome) < 2) throw new ErroNegocio('Informe seu sobrenome.');
  if (tamanhoEmCaracteres(nomeAdmin) < 2) throw new ErroNegocio('Informe o nome do administrador.');
  if (tamanhoEmCaracteres(usuario) < 3) {
    throw new ErroNegocio('O usuario deve ter ao menos 3 caracteres.');
  }
  const senha = validarTamanhoSenha(admin.senha || '');
  if (!email.includes('@')) throw new ErroNegocio('Informe um e-mail valido.');

  return { nome, primeiroNome, sobrenome, nomeAdmin, usuario, email, senha };
}

async function inserirAssinaturaInicial(cx, lojaId, { aguardarPagamento, diasValidade, plano }) {
  if (aguardarPagamento) {
    await cx.executar(
      "INSERT INTO assinaturas (id, loja_id, status, valida_ate) VALUES (?, ?, 'pendente', NULL)",
      [randomUUID(), lojaId],
    );
  } else if (diasValidade) {
    await cx.executar(
      `INSERT INTO assinaturas (id, loja_id, status, valida_ate, plano, valor_mensal)
       VALUES (?, ?, 'ativa', DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, 0)`,
      [randomUUID(), lojaId, Math.trunc(diasValidade), plano || 'teste'],
    );
  } else {
    await cx.executar(
      `INSERT INTO assinaturas (id, loja_id, status, valida_ate)
       VALUES (?, ?, 'ativa', DATE_ADD(CURDATE(), INTERVAL 1 YEAR))`,
      [randomUUID(), lojaId],
    );
  }
}

async function registrarTrialCpf(cx, cpf, lojaId) {
  try {
    await cx.executar('INSERT INTO trials_cpf (cpf, loja_id) VALUES (?, ?)', [cpf, lojaId]);
  } catch (erro) {
    if (db.ehErroMysql(erro, 'ER_DUP_ENTRY')) {
      throw new ErroNegocio('Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.', 409);
    }
    throw erro;
  }
}

/**
 * Cria loja, administrador e assinatura numa única transação.
 *
 * `aceiteDiretrizes` (já validado) é gravado na mesma transação: não existe
 * loja comprada pelo site sem o registro do aceite.
 *
 * @returns {Promise<{ lojaId: string, codigo: string }>}
 */
export async function criarLojaComAdmin({
  loja,
  admin,
  aguardarPagamento = false,
  cpf = '',
  diasValidade = null,
  plano = '',
  trialCpf = '',
  aceiteDiretrizes = null,
}) {
  const dadosLoja = objetoOuVazio(loja);
  const dadosAdmin = objetoOuVazio(admin);
  const validados = validarDadosNovaLoja(dadosLoja, dadosAdmin);

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(validados.senha, salt);
  const lojaId = randomUUID();

  return db.transacao(async (cx) => {
    const codigo = await sortearCodigoLivre(cx, TENTATIVAS_CODIGO_UNICO);

    await cx.executar(
      `INSERT INTO lojas (id, nome, cnpj, endereco, telefone, email, cpf,
                          responsavel_nome, responsavel_sobrenome, codigo, ativa)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lojaId,
        validados.nome,
        texto(dadosLoja.cnpj),
        texto(dadosLoja.endereco),
        texto(dadosLoja.telefone),
        validados.email,
        cpf || '',
        validados.primeiroNome,
        validados.sobrenome,
        codigo,
        !aguardarPagamento,
      ],
    );

    await cx.executar(
      `INSERT INTO funcionarios (id, loja_id, nome, usuario, salt, senha_hash, cargo, dados)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', '{}')`,
      [randomUUID(), lojaId, validados.nomeAdmin, validados.usuario, salt, senhaHash],
    );

    await inserirAssinaturaInicial(cx, lojaId, { aguardarPagamento, diasValidade, plano });
    if (!aguardarPagamento && diasValidade && trialCpf) {
      await registrarTrialCpf(cx, trialCpf, lojaId);
    }

    if (aceiteDiretrizes) {
      await cx.executar(
        'INSERT INTO aceites_diretrizes (id, loja_id, versao, ip, navegador) VALUES (?, ?, ?, ?, ?)',
        [
          randomUUID(),
          lojaId,
          aceiteDiretrizes.versao,
          aceiteDiretrizes.ip || '',
          aceiteDiretrizes.navegador || '',
        ],
      );
    }

    return { lojaId, codigo };
  });
}

/** @returns {Promise<{ lojaId: string, nome: string }>} */
export async function buscarLojaPorCodigo(codigo) {
  const codigoLimpo = texto(codigo).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (tamanhoEmCaracteres(codigoLimpo) < TAMANHO_MINIMO_CODIGO_BUSCA) {
    throw new ErroNegocio('Codigo da loja invalido.');
  }

  const linhas = await db.consultar('SELECT id, nome, ativa FROM lojas WHERE codigo = ?', [codigoLimpo]);
  if (linhas.length === 0) throw new ErroNegocio('Loja nao encontrada. Confira o codigo.', 404);
  if (!linhas[0].ativa) throw new ErroNegocio('Loja desativada. Fale com o suporte.', 403);

  return { lojaId: String(linhas[0].id), nome: linhas[0].nome };
}

export async function obterPerfil(lojaId) {
  const linhas = await db.consultar(
    `SELECT l.id, l.nome, l.cnpj, l.endereco, l.telefone, l.codigo,
            a.plano, a.status AS assinaturaStatus, a.valida_ate AS validaAte
     FROM lojas l
     LEFT JOIN assinaturas a ON a.loja_id = l.id
     WHERE l.id = ?`,
    [lojaId],
  );
  if (linhas.length === 0) throw new ErroNegocio('Loja nao encontrada.', 404);

  const perfil = { ...linhas[0], id: String(linhas[0].id) };
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
  const existente = await db.consultar('SELECT id FROM lojas WHERE id = ?', [lojaId]);
  if (existente.length === 0) throw new ErroNegocio('Loja nao encontrada.', 404);

  return db.transacao(async (cx) => {
    const codigo = await sortearCodigoLivre(cx, TENTATIVAS_REGENERAR_CODIGO, lojaId);
    await cx.executar('UPDATE lojas SET codigo = ?, atualizado_em = NOW(3) WHERE id = ?', [
      codigo,
      lojaId,
    ]);
    return { codigo };
  });
}

/** Usa o código da loja como chave de ativação do desktop. */
export async function ativarPorCodigo(codigo) {
  const loja = await buscarLojaPorCodigo(codigo);
  const perfil = await obterPerfil(loja.lojaId);
  return { ok: true, lojaId: loja.lojaId, email: '', nomeLoja: perfil.nome };
}

/** Loja fixa "DEVLOCAL" para desenvolvimento (a rota bloqueia em produção). */
export async function obterOuCriarLojaDesenvolvimento() {
  const existentes = await db.consultar("SELECT id, nome FROM lojas WHERE codigo = 'DEVLOCAL' LIMIT 1");
  if (existentes.length > 0) {
    return {
      ok: true,
      lojaId: String(existentes[0].id),
      email: 'dev@cybhor.local',
      nomeLoja: existentes[0].nome,
    };
  }

  const lojaId = randomUUID();
  await db.transacao(async (cx) => {
    await cx.executar(
      `INSERT INTO lojas (id, nome, email, responsavel_nome, responsavel_sobrenome, codigo, ativa)
       VALUES (?, 'Loja desenvolvimento', 'dev@cybhor.local', 'Administrador', 'Local', 'DEVLOCAL', TRUE)`,
      [lojaId],
    );
    await cx.executar(
      "INSERT INTO assinaturas (id, loja_id, status, valor_mensal) VALUES (?, ?, 'ativa', 0)",
      [randomUUID(), lojaId],
    );
  });
  return { ok: true, lojaId, email: 'dev@cybhor.local', nomeLoja: 'Loja desenvolvimento' };
}
