import { randomUUID } from 'node:crypto';
import { avaliarAssinatura } from '../assinatura.js';
import * as db from '../db.js';
import { emitirToken } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import { gerarHashSenha, gerarSalt, validarTamanhoSenha, verificarSenha } from '../security.js';
import {
  ehObjetoSimples,
  ehVerdadeiro,
  lerJson,
  normalizarChaveAlfanumerica,
  objetoOuVazio,
  texto,
} from '../utils/valores.js';

const CARGOS_VALIDOS = ['admin', 'operador'];

const PERMISSOES_PADRAO_OPERADOR = Object.freeze({
  cadastrarProduto: true,
  editarProduto: true,
  excluirProduto: false,
  ajustarEstoque: true,
  aplicarDesconto: true,
  venderFiado: true,
  verHistorico: true,
  cancelarVenda: false,
  fazerSangria: true,
  gerenciarClientes: false,
});

// Vendas novas/cancelamento passam por /caixa/*; operador não grava vendas via /dados
// (evita bypass de cancelarVenda / baixa de estoque).
const RECURSOS_OPERADOR_ESCRITA = new Set([
  'produtos',
  'sangrias',
  'caixaEstado',
  'suprimentos',
  'clientes',
  'fechamentos',
]);

const EXTRAS_FUNCIONARIO_PERMITIDOS = [
  'areas',
  'permissoes',
  'tipoVinculo',
  'salarioBruto',
  'dependentes',
  'valorContrato',
];

const SELECAO_LOGIN = `
  SELECT f.id, f.nome, f.usuario, f.cargo, f.salt, f.senha_hash,
         f.dados, f.loja_id, l.ativa, l.codigo AS loja_codigo,
         l.nome AS loja_nome
  FROM funcionarios f
  JOIN lojas l ON l.id = f.loja_id`;

async function situacaoAssinaturaLoja(lojaId) {
  const linhas = await db.consultar(
    'SELECT status, valida_ate FROM assinaturas WHERE loja_id = ?',
    [lojaId],
  );
  if (linhas.length === 0) return avaliarAssinatura(null, null);
  return avaliarAssinatura(linhas[0].status, linhas[0].valida_ate);
}

/** Garante acesso: atraso libera; pendente/cancelada bloqueia. */
async function exigirAssinaturaValida(lojaId) {
  const situacao = await situacaoAssinaturaLoja(lojaId);
  if (situacao.bloqueada) throw new ErroNegocio(situacao.mensagem, 403);
  return situacao;
}

const TEXTOS_FALSOS = new Set(['', '0', 'false', 'nao', 'não', 'off', 'no']);
const TEXTOS_VERDADEIROS = new Set(['1', 'true', 'sim', 'yes', 'on']);

function comoBooleano(valor, padrao) {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor !== 0;
  if (typeof valor === 'string') {
    const normalizado = valor.trim().toLowerCase();
    if (TEXTOS_FALSOS.has(normalizado)) return false;
    if (TEXTOS_VERDADEIROS.has(normalizado)) return true;
  }
  return ehVerdadeiro(valor);
}

/**
 * Completa as permissões do operador com os padrões e converte valores soltos em boolean.
 * @param {unknown} valor
 * @returns {Record<string, boolean>}
 */
export function normalizarPermissoes(valor) {
  const bruto = objetoOuVazio(valor);
  const saida = {};
  for (const [chave, padrao] of Object.entries(PERMISSOES_PADRAO_OPERADOR)) {
    saida[chave] = Object.hasOwn(bruto, chave) ? comoBooleano(bruto[chave], padrao) : padrao;
  }
  return saida;
}

export async function obterPermissoesFuncionario(lojaId, funcionarioId) {
  const linhas = await db.consultar(
    'SELECT cargo, dados FROM funcionarios WHERE loja_id = ? AND id = ?',
    [lojaId, funcionarioId],
  );
  const chaves = Object.keys(PERMISSOES_PADRAO_OPERADOR);
  if (linhas.length === 0) return Object.fromEntries(chaves.map((chave) => [chave, false]));
  if (linhas[0].cargo === 'admin') return Object.fromEntries(chaves.map((chave) => [chave, true]));
  const extras = objetoOuVazio(lerJson(linhas[0].dados));
  return normalizarPermissoes(extras.permissoes);
}

async function buscarCandidatosLogin({ codigo, lojaId, usuario, email }) {
  if (codigo || lojaId) {
    return db.consultar(`${SELECAO_LOGIN} WHERE (l.codigo = ? OR l.id = ?) AND f.usuario = ?`, [
      codigo,
      lojaId,
      usuario,
    ]);
  }
  if (email) {
    return db.consultar(`${SELECAO_LOGIN} WHERE LOWER(l.email) = ? AND f.usuario = ?`, [
      email,
      usuario,
    ]);
  }
  return db.consultar(`${SELECAO_LOGIN} WHERE f.usuario = ?`, [usuario]);
}

/**
 * Login do funcionário (desktop por código/lojaId; site por usuário+senha).
 * O e-mail desambigua quando o mesmo usuário existe em mais de uma loja.
 */
export async function loginLoja({ codigoLoja, lojaId, usuario, senha, email = '' }) {
  const codigo = texto(codigoLoja).toUpperCase();
  const lojaIdLimpo = texto(lojaId);
  const usuarioLimpo = texto(usuario).toLowerCase();
  const emailLimpo = texto(email).toLowerCase();

  if (!usuarioLimpo) throw new ErroNegocio('Informe o usuario.', 400);

  const linhas = await buscarCandidatosLogin({
    codigo,
    lojaId: lojaIdLimpo,
    usuario: usuarioLimpo,
    email: emailLimpo,
  });
  if (linhas.length === 0) throw new ErroNegocio('Usuario ou senha invalidos.', 401);

  const candidatas = [];
  for (const linha of linhas) {
    if (await verificarSenha(senha || '', linha.salt, linha.senha_hash)) candidatas.push(linha);
  }
  if (candidatas.length === 0) throw new ErroNegocio('Usuario ou senha invalidos.', 401);
  if (candidatas.length > 1) {
    throw new ErroNegocio(
      'Ha mais de uma loja com este usuario. Informe tambem o e-mail cadastrado no pagamento.',
      400,
    );
  }

  const conta = candidatas[0];
  if (!conta.ativa) {
    throw new ErroNegocio(
      'Loja ainda nao ativada ou desativada. Confirme o pagamento ou fale com o suporte.',
      403,
    );
  }

  const situacao = await exigirAssinaturaValida(String(conta.loja_id));
  const extras = objetoOuVazio(lerJson(conta.dados));

  const token = emitirToken({
    tipo: 'loja',
    lojaId: String(conta.loja_id),
    funcionarioId: String(conta.id),
    cargo: conta.cargo,
    nome: conta.nome,
  });

  return {
    token,
    funcionario: {
      id: String(conta.id),
      nome: conta.nome,
      usuario: conta.usuario,
      cargo: conta.cargo,
      areas: ehVerdadeiro(extras.areas) ? extras.areas : [],
      permissoes: normalizarPermissoes(extras.permissoes),
    },
    loja: {
      id: String(conta.loja_id),
      nome: conta.loja_nome,
      codigo: conta.loja_codigo,
    },
    assinatura: {
      status: situacao.status,
      statusExibicao: situacao.statusExibicao,
      atrasada: situacao.atrasada,
      validaAte: situacao.validaAte,
      rotulo: situacao.rotulo,
      mensagem: situacao.mensagem || '',
    },
  };
}

/**
 * Cria um funcionário da loja, com senha em PBKDF2 e extras (áreas/permissões) em JSON.
 * @returns {Promise<{ id: string }>}
 */
export async function criarFuncionario(lojaId, dados) {
  const nome = texto(dados.nome);
  const usuario = texto(dados.usuario).toLowerCase();
  const senha = validarTamanhoSenha(dados.senha || '');
  const cargo = dados.cargo;

  if (Array.from(nome).length < 2) throw new ErroNegocio('Informe o nome do funcionario.');
  if (Array.from(usuario).length < 3) {
    throw new ErroNegocio('O usuario deve ter ao menos 3 caracteres.');
  }
  if (!CARGOS_VALIDOS.includes(cargo)) throw new ErroNegocio('Cargo invalido.');

  const existente = await db.consultar(
    'SELECT 1 FROM funcionarios WHERE loja_id = ? AND usuario = ?',
    [lojaId, usuario],
  );
  if (existente.length > 0) throw new ErroNegocio('Ja existe um funcionario com esse usuario.');

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);
  const id = randomUUID();
  const extras = {
    areas: ehVerdadeiro(dados.areas) ? dados.areas : [],
    permissoes: normalizarPermissoes(dados.permissoes),
  };

  try {
    await db.executar(
      `INSERT INTO funcionarios (id, loja_id, nome, usuario, salt, senha_hash, cargo, dados)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, lojaId, nome, usuario, salt, senhaHash, cargo, JSON.stringify(extras)],
    );
  } catch (erro) {
    // Corrida entre duas criações simultâneas: o UNIQUE (loja_id, usuario) decide.
    if (db.ehErroMysql(erro, 'ER_DUP_ENTRY')) {
      throw new ErroNegocio('Ja existe um funcionario com esse usuario.');
    }
    throw erro;
  }
  return { id };
}

export async function listarFuncionarios(lojaId) {
  const linhas = await db.consultar(
    `SELECT id, nome, usuario, cargo, dados,
            criado_em AS criadoEm, atualizado_em AS atualizadoEm
     FROM funcionarios WHERE loja_id = ? ORDER BY nome`,
    [lojaId],
  );
  return linhas.map(({ dados, ...funcionario }) => {
    const extras = lerJson(dados);
    const completo = { ...funcionario, id: String(funcionario.id) };
    if (ehObjetoSimples(extras)) Object.assign(completo, extras);
    completo.permissoes = normalizarPermissoes(completo.permissoes);
    return completo;
  });
}

export async function existeAdministrador(lojaId) {
  const linhas = await db.consultar(
    "SELECT 1 FROM funcionarios WHERE loja_id = ? AND cargo = 'admin' LIMIT 1",
    [lojaId],
  );
  return linhas.length > 0;
}

/** Cria o primeiro admin da loja, provando posse da chave de ativação (código da loja). */
export async function criarAdminInicial(lojaId, dados) {
  const chave = texto(dados.chaveAtivacao || dados.codigoLoja);
  const chaveNormalizada = normalizarChaveAlfanumerica(chave);
  if (chaveNormalizada.length < 6) {
    throw new ErroNegocio('Informe a chave de ativacao da loja.', 403);
  }

  const lojas = await db.consultar('SELECT codigo FROM lojas WHERE id = ? AND ativa = TRUE', [
    lojaId,
  ]);
  if (lojas.length === 0) throw new ErroNegocio('Loja nao encontrada ou desativada.', 404);

  if (chaveNormalizada !== normalizarChaveAlfanumerica(lojas[0].codigo)) {
    throw new ErroNegocio('Chave de ativacao invalida.', 403);
  }
  if (await existeAdministrador(lojaId)) {
    throw new ErroNegocio('O administrador inicial ja foi criado.', 409);
  }
  return criarFuncionario(lojaId, { ...dados, cargo: 'admin' });
}

/**
 * Atualiza cargo, senha e extras (áreas, permissões, vínculo) de um funcionário
 * numa única transação, com a linha travada para o merge do JSON não perder escrita.
 */
export async function atualizarFuncionario(lojaId, funcionarioId, dados) {
  const novaSenha = dados.novaSenha;
  const novoSalt = novaSenha !== undefined && novaSenha !== null ? gerarSalt() : null;
  const novoHash =
    novoSalt === null ? null : await gerarHashSenha(validarTamanhoSenha(String(novaSenha)), novoSalt);

  await db.transacao(async (cx) => {
    const existente = await cx.consultar(
      'SELECT id, cargo, dados FROM funcionarios WHERE id = ? AND loja_id = ? FOR UPDATE',
      [funcionarioId, lojaId],
    );
    if (existente.length === 0) throw new ErroNegocio('Funcionario nao encontrado.', 404);

    const cargo = dados.cargo;
    if (cargo !== undefined && cargo !== null) {
      if (!CARGOS_VALIDOS.includes(cargo)) throw new ErroNegocio('Cargo invalido.');
      if (existente[0].cargo === 'admin' && cargo === 'operador') {
        const admins = await cx.consultar(
          "SELECT COUNT(*) AS total FROM funcionarios WHERE loja_id = ? AND cargo = 'admin' FOR UPDATE",
          [lojaId],
        );
        if (Number(admins[0].total) <= 1) {
          throw new ErroNegocio('Nao e possivel rebaixar o unico administrador do sistema.');
        }
      }
      await cx.executar(
        'UPDATE funcionarios SET cargo = ?, atualizado_em = NOW(3) WHERE id = ? AND loja_id = ?',
        [cargo, funcionarioId, lojaId],
      );
    }

    if (novoHash !== null) {
      await cx.executar(
        'UPDATE funcionarios SET salt = ?, senha_hash = ?, atualizado_em = NOW(3) WHERE id = ? AND loja_id = ?',
        [novoSalt, novoHash, funcionarioId, lojaId],
      );
    }

    const extras = {};
    for (const chave of EXTRAS_FUNCIONARIO_PERMITIDOS) {
      if (Object.hasOwn(dados, chave)) extras[chave] = dados[chave];
    }
    if (Object.hasOwn(extras, 'permissoes')) {
      extras.permissoes = normalizarPermissoes(extras.permissoes);
    }
    if (Object.keys(extras).length > 0) {
      // Merge raso (chaves do topo substituem as antigas): é o contrato do `||` do JSONB.
      const mesclado = { ...objetoOuVazio(lerJson(existente[0].dados)), ...extras };
      await cx.executar(
        'UPDATE funcionarios SET dados = ?, atualizado_em = NOW(3) WHERE id = ? AND loja_id = ?',
        [JSON.stringify(mesclado), funcionarioId, lojaId],
      );
    }
  });
}

// --- Gates de escrita em /dados (operador vs admin) ---

function partesDoCaminho(caminho) {
  let partes = String(caminho ?? '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (partes.length >= 2 && partes[0] === 'lojas') partes = partes.slice(2);
  return partes;
}

/** Primeiro segmento do caminho (ignora o prefixo `lojas/<id>`). */
export function recursoDoCaminho(caminho) {
  return partesDoCaminho(caminho)[0] || '';
}

/** @throws {ErroNegocio} 403 quando o operador não tem a permissão. */
export async function exigirPerm({ cargo, lojaId, funcionarioId, chave, mensagem }) {
  if (cargo === 'admin') return;
  const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);
  if (!permissoes[chave]) throw new ErroNegocio(mensagem, 403);
}

export async function exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho }) {
  if (cargo === 'admin') return;
  const recurso = recursoDoCaminho(caminho);
  if (!RECURSOS_OPERADOR_ESCRITA.has(recurso)) {
    throw new ErroNegocio('Apenas o administrador da loja pode alterar este recurso.', 403);
  }

  const partes = partesDoCaminho(caminho);
  const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);

  if (recurso === 'clientes' && !permissoes.gerenciarClientes) {
    throw new ErroNegocio('Sem permissao para alterar clientes.', 403);
  }
  if (recurso === 'sangrias' && !permissoes.fazerSangria) {
    throw new ErroNegocio('Sem permissao para sangria.', 403);
  }
  if (recurso === 'produtos') {
    const somenteEstoque = partes.length >= 3 && partes[partes.length - 1] === 'estoque';
    if (somenteEstoque) {
      if (!permissoes.ajustarEstoque) {
        throw new ErroNegocio('Sem permissao para ajustar estoque.', 403);
      }
    } else if (!(permissoes.cadastrarProduto || permissoes.editarProduto)) {
      throw new ErroNegocio('Sem permissao para alterar produtos.', 403);
    }
  }
}

export async function exigirRemocaoDados({ cargo, lojaId, funcionarioId, caminho }) {
  await exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho });
  if (cargo === 'admin') return;
  if (recursoDoCaminho(caminho) === 'produtos') {
    const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);
    if (!permissoes.excluirProduto) {
      throw new ErroNegocio('Sem permissao para excluir produtos.', 403);
    }
  }
}

export async function exigirLoteDados({ cargo, lojaId, funcionarioId, atualizacoes }) {
  if (cargo === 'admin') return;
  for (const caminho of Object.keys(atualizacoes || {})) {
    await exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho });
  }
}
