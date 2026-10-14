import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { avaliarAssinatura } from "../regras/assinatura.js";
import {
  converterDecimal,
  ehObjetoSimples,
  ehVazioComoPython,
  lerTextoLimpo,
  somenteAlfanumericos,
} from "../regras/entrada.js";
import { gerarHashSenha, gerarSalt, validarTamanhoSenha, verificarSenha } from "../seguranca/senha.js";
import { emitirToken } from "../seguranca/token.js";

const PERMISSOES_OPERADOR_PADRAO = Object.freeze({
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

const CARGOS = new Set(["admin", "operador"]);
const EXTRAS_FUNCIONARIO_PERMITIDOS = ["areas", "permissoes", "tipoVinculo", "salarioBruto", "dependentes", "valorContrato"];

// Vendas novas/cancelamento passam por /caixa/*; operador não grava vendas via /dados
// (evita bypass de cancelarVenda / baixa de estoque).
const RECURSOS_OPERADOR_ESCRITA = new Set(["produtos", "sangrias", "caixaEstado", "suprimentos", "clientes", "fechamentos"]);

const SELECT_FUNCIONARIO_LOGIN = `
  SELECT f.id, f.nome, f.usuario, f.cargo, f.salt, f.senha_hash,
         f.dados, f.loja_id, l.ativa, l.codigo AS loja_codigo, l.nome AS loja_nome
  FROM funcionarios f
  JOIN lojas l ON l.id = f.loja_id`;

function comoBooleano(valor, padrao) {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0;
  if (typeof valor === "string") {
    const texto = valor.trim().toLowerCase();
    if (["", "0", "false", "nao", "não", "off", "no"].includes(texto)) return false;
    if (["1", "true", "sim", "yes", "on"].includes(texto)) return true;
  }
  return Boolean(valor);
}

/**
 * Completa as permissões do operador com os padrões (chaves desconhecidas são descartadas).
 * @param {unknown} valor
 * @returns {Record<string, boolean>}
 */
export function normalizarPermissoes(valor) {
  const bruto = ehObjetoSimples(valor) ? valor : {};
  return Object.fromEntries(
    Object.entries(PERMISSOES_OPERADOR_PADRAO).map(([chave, padrao]) => [
      chave,
      Object.hasOwn(bruto, chave) ? comoBooleano(bruto[chave], padrao) : padrao,
    ]),
  );
}

function todasPermissoes(valor) {
  return Object.fromEntries(Object.keys(PERMISSOES_OPERADOR_PADRAO).map((chave) => [chave, valor]));
}

function lerExtras(dados) {
  const extras = db.lerJson(dados);
  return ehObjetoSimples(extras) ? extras : {};
}

async function situacaoAssinaturaLoja(lojaId) {
  const linhas = await db.consultar("SELECT status, valida_ate FROM assinaturas WHERE loja_id = ?", [lojaId]);
  if (!linhas.length) return avaliarAssinatura(null, null);
  return avaliarAssinatura(linhas[0].status, linhas[0].valida_ate);
}

/** Garante acesso: atraso libera; pendente/cancelada bloqueia. */
async function exigirAssinaturaValida(lojaId) {
  const situacao = await situacaoAssinaturaLoja(lojaId);
  if (situacao.bloqueada) throw new ErroNegocio(situacao.mensagem, 403);
  return situacao;
}

/**
 * @param {string} lojaId
 * @param {string} funcionarioId
 * @returns {Promise<Record<string, boolean>>}
 */
export async function obterPermissoesFuncionario(lojaId, funcionarioId) {
  const linhas = await db.consultar("SELECT cargo, dados FROM funcionarios WHERE loja_id = ? AND id = ?", [
    lojaId,
    funcionarioId,
  ]);
  if (!linhas.length) return todasPermissoes(false);
  if (linhas[0].cargo === "admin") return todasPermissoes(true);
  return normalizarPermissoes(lerExtras(linhas[0].dados).permissoes);
}

async function buscarCandidatosLogin({ codigo, lojaId, usuario, email }) {
  // Desktop: código/lojaId. Site/portal: usuário+senha (e-mail desambigua se
  // o mesmo usuário existir em mais de uma loja).
  if (codigo || lojaId) {
    return db.consultar(`${SELECT_FUNCIONARIO_LOGIN} WHERE (l.codigo = ? OR l.id = ?) AND f.usuario = ?`, [
      codigo,
      lojaId,
      usuario,
    ]);
  }
  if (email) {
    return db.consultar(`${SELECT_FUNCIONARIO_LOGIN} WHERE LOWER(l.email) = ? AND f.usuario = ?`, [email, usuario]);
  }
  return db.consultar(`${SELECT_FUNCIONARIO_LOGIN} WHERE f.usuario = ?`, [usuario]);
}

/**
 * Login do PDV/portal da loja.
 * @returns {Promise<object>} token, funcionário, loja e situação da assinatura.
 */
export async function loginLoja({ codigoLoja, lojaId, usuario, senha, email = "" }) {
  const codigo = lerTextoLimpo(codigoLoja).toUpperCase();
  const lojaIdLimpo = lerTextoLimpo(lojaId);
  const usuarioLimpo = lerTextoLimpo(usuario).toLowerCase();
  const emailLimpo = lerTextoLimpo(email).toLowerCase();

  if (!usuarioLimpo) throw new ErroNegocio("Informe o usuario.", 400);

  const linhas = await buscarCandidatosLogin({ codigo, lojaId: lojaIdLimpo, usuario: usuarioLimpo, email: emailLimpo });
  if (!linhas.length) throw new ErroNegocio("Usuario ou senha invalidos.", 401);

  const senhaTexto = typeof senha === "string" ? senha : "";
  const candidatas = [];
  for (const linha of linhas) {
    if (await verificarSenha(senhaTexto, linha.salt, linha.senha_hash)) candidatas.push(linha);
  }
  if (!candidatas.length) throw new ErroNegocio("Usuario ou senha invalidos.", 401);
  if (candidatas.length > 1) {
    throw new ErroNegocio(
      "Ha mais de uma loja com este usuario. Informe tambem o e-mail cadastrado no pagamento.",
      400,
    );
  }

  const conta = candidatas[0];
  if (!conta.ativa) {
    throw new ErroNegocio("Loja ainda nao ativada ou desativada. Confirme o pagamento ou fale com o suporte.", 403);
  }

  const situacao = await exigirAssinaturaValida(conta.loja_id);
  const extras = lerExtras(conta.dados);
  const token = emitirToken({
    tipo: "loja",
    lojaId: conta.loja_id,
    funcionarioId: conta.id,
    cargo: conta.cargo,
    nome: conta.nome,
  });
  return {
    token,
    funcionario: {
      id: conta.id,
      nome: conta.nome,
      usuario: conta.usuario,
      cargo: conta.cargo,
      areas: extras.areas || [],
      permissoes: normalizarPermissoes(extras.permissoes),
    },
    loja: { id: conta.loja_id, nome: conta.loja_nome, codigo: conta.loja_codigo },
    assinatura: {
      status: situacao.status,
      statusExibicao: situacao.statusExibicao,
      atrasada: situacao.atrasada,
      validaAte: situacao.validaAte,
      rotulo: situacao.rotulo,
      mensagem: situacao.mensagem || "",
    },
  };
}

/**
 * Cria funcionário com senha PBKDF2.
 * @param {string} lojaId
 * @param {Record<string, any>} dados
 * @returns {Promise<{ id: string }>}
 */
export async function criarFuncionario(lojaId, dados) {
  const nome = lerTextoLimpo(dados.nome);
  const usuario = lerTextoLimpo(dados.usuario).toLowerCase();
  const senha = validarTamanhoSenha(dados.senha || "");
  const { cargo } = dados;

  if (nome.length < 2) throw new ErroNegocio("Informe o nome do funcionario.");
  if (usuario.length < 3) throw new ErroNegocio("O usuario deve ter ao menos 3 caracteres.");
  if (!CARGOS.has(cargo)) throw new ErroNegocio("Cargo invalido.");

  const existente = await db.consultar("SELECT 1 FROM funcionarios WHERE loja_id = ? AND usuario = ?", [lojaId, usuario]);
  if (existente.length) throw new ErroNegocio("Ja existe um funcionario com esse usuario.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);
  const id = randomUUID();
  const extras = { areas: dados.areas || [], permissoes: normalizarPermissoes(dados.permissoes) };
  try {
    await db.executar(
      `INSERT INTO funcionarios (id, loja_id, nome, usuario, salt, senha_hash, cargo, dados)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, lojaId, nome, usuario, salt, senhaHash, cargo, JSON.stringify(extras)],
    );
  } catch (erro) {
    if (db.ehChaveDuplicada(erro)) throw new ErroNegocio("Ja existe um funcionario com esse usuario.");
    throw erro;
  }
  return { id };
}

/** @returns {Promise<object[]>} funcionários com os extras (áreas, permissões) achatados. */
export async function listarFuncionarios(lojaId) {
  const linhas = await db.consultar(
    `SELECT id, nome, usuario, cargo, dados, criado_em, atualizado_em
     FROM funcionarios WHERE loja_id = ? ORDER BY nome`,
    [lojaId],
  );
  return linhas.map(({ dados, criado_em: criadoEm, atualizado_em: atualizadoEm, ...funcionario }) => {
    const resultado = { ...funcionario, criadoEm, atualizadoEm, ...lerExtras(dados) };
    resultado.permissoes = normalizarPermissoes(resultado.permissoes);
    return resultado;
  });
}

export async function existeAdministrador(lojaId) {
  const linhas = await db.consultar("SELECT 1 FROM funcionarios WHERE loja_id = ? AND cargo = 'admin' LIMIT 1", [lojaId]);
  return linhas.length > 0;
}

/**
 * Cria o primeiro admin da loja; exige a chave de ativação (código da loja).
 * @returns {Promise<{ id: string }>}
 */
export async function criarAdminInicial(lojaId, dados) {
  const chave = lerTextoLimpo(dados.chaveAtivacao || dados.codigoLoja);
  const chaveNormalizada = somenteAlfanumericos(chave).toUpperCase();
  if (chaveNormalizada.length < 6) throw new ErroNegocio("Informe a chave de ativacao da loja.", 403);

  const lojas = await db.consultar("SELECT codigo FROM lojas WHERE id = ? AND ativa = TRUE", [lojaId]);
  if (!lojas.length) throw new ErroNegocio("Loja nao encontrada ou desativada.", 404);

  const codigoLoja = somenteAlfanumericos(lojas[0].codigo).toUpperCase();
  // Aceita o código da loja ou DEV-LOCAL (vira DEVLOCAL).
  if (chaveNormalizada !== codigoLoja) throw new ErroNegocio("Chave de ativacao invalida.", 403);

  if (await existeAdministrador(lojaId)) throw new ErroNegocio("O administrador inicial ja foi criado.", 409);

  return criarFuncionario(lojaId, { ...dados, cargo: "admin" });
}

async function atualizarCargo(lojaId, funcionarioId, cargoAtual, novoCargo) {
  if (!CARGOS.has(novoCargo)) throw new ErroNegocio("Cargo invalido.");
  if (cargoAtual === "admin" && novoCargo === "operador") {
    const [{ total }] = await db.consultar(
      "SELECT COUNT(*) AS total FROM funcionarios WHERE loja_id = ? AND cargo = 'admin'",
      [lojaId],
    );
    if (Number(total) <= 1) throw new ErroNegocio("Nao e possivel rebaixar o unico administrador do sistema.");
  }
  await db.executar(
    "UPDATE funcionarios SET cargo = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ? AND loja_id = ?",
    [novoCargo, funcionarioId, lojaId],
  );
}

async function atualizarSenha(lojaId, funcionarioId, novaSenha) {
  const senhaValida = validarTamanhoSenha(String(novaSenha));
  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senhaValida, salt);
  await db.executar(
    "UPDATE funcionarios SET salt = ?, senha_hash = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ? AND loja_id = ?",
    [salt, senhaHash, funcionarioId, lojaId],
  );
}

// Merge raso igual ao `dados || jsonb` do Postgres (JSON_MERGE_PATCH mesclaria em profundidade
// e apagaria chaves com null). Lido com FOR UPDATE para não perder escrita concorrente.
async function mesclarExtras(lojaId, funcionarioId, extras) {
  await db.transacao(async (tx) => {
    const linhas = await tx.consultar("SELECT dados FROM funcionarios WHERE id = ? AND loja_id = ? FOR UPDATE", [
      funcionarioId,
      lojaId,
    ]);
    if (!linhas.length) return;
    const mesclado = { ...lerExtras(linhas[0].dados), ...extras };
    await tx.executar(
      "UPDATE funcionarios SET dados = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ? AND loja_id = ?",
      [JSON.stringify(mesclado), funcionarioId, lojaId],
    );
  });
}

/**
 * Atualiza cargo, senha e/ou extras (áreas, permissões, dados de RH).
 * @throws {ErroNegocio} funcionário inexistente, cargo inválido ou último admin.
 */
export async function atualizarFuncionario(lojaId, funcionarioId, dados) {
  const existente = await db.consultar("SELECT id, cargo FROM funcionarios WHERE id = ? AND loja_id = ?", [
    funcionarioId,
    lojaId,
  ]);
  if (!existente.length) throw new ErroNegocio("Funcionario nao encontrado.", 404);

  if (dados.cargo !== undefined && dados.cargo !== null) {
    await atualizarCargo(lojaId, funcionarioId, existente[0].cargo, dados.cargo);
  }
  if (dados.novaSenha !== undefined && dados.novaSenha !== null) {
    await atualizarSenha(lojaId, funcionarioId, dados.novaSenha);
  }

  const extras = Object.fromEntries(
    EXTRAS_FUNCIONARIO_PERMITIDOS.filter((chave) => Object.hasOwn(dados, chave)).map((chave) => [chave, dados[chave]]),
  );
  if (Object.hasOwn(extras, "permissoes")) extras.permissoes = normalizarPermissoes(extras.permissoes);
  if (Object.keys(extras).length) await mesclarExtras(lojaId, funcionarioId, extras);
}

function partesDoCaminho(caminho) {
  const partes = String(caminho ?? "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  return partes.length >= 2 && partes[0] === "lojas" ? partes.slice(2) : partes;
}

/** Primeiro segmento útil de /dados (ignora o prefixo legado lojas/{id}). */
export function recursoDoCaminho(caminho) {
  return partesDoCaminho(caminho)[0] || "";
}

/**
 * Operador sem a permissão `chave` recebe 403 com `mensagem`; admin sempre passa.
 */
export async function exigirPermissao({ cargo, lojaId, funcionarioId, chave, mensagem }) {
  if (cargo === "admin") return;
  const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);
  if (!permissoes[chave]) throw new ErroNegocio(mensagem, 403);
}

/** Venda com desconto exige aplicarDesconto; venda fiado exige venderFiado. */
export async function exigirPermissoesVenda(contexto, dadosVenda) {
  const desconto = converterDecimal(dadosVenda.desconto || 0) ?? 0;
  if (desconto > 0) {
    await exigirPermissao({ ...contexto, chave: "aplicarDesconto", mensagem: "Sem permissao para aplicar desconto." });
  }
  if (!ehVazioComoPython(dadosVenda.fiado)) {
    await exigirPermissao({ ...contexto, chave: "venderFiado", mensagem: "Sem permissao para venda fiado." });
  }
}

/** Gate de escrita em /dados para operadores (recursos e permissões finas). */
export async function exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho }) {
  if (cargo === "admin") return;
  const recurso = recursoDoCaminho(caminho);
  if (!RECURSOS_OPERADOR_ESCRITA.has(recurso)) {
    throw new ErroNegocio("Apenas o administrador da loja pode alterar este recurso.", 403);
  }

  const partes = partesDoCaminho(caminho);
  const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);

  if (recurso === "clientes" && !permissoes.gerenciarClientes) {
    throw new ErroNegocio("Sem permissao para alterar clientes.", 403);
  }
  if (recurso === "sangrias" && !permissoes.fazerSangria) {
    throw new ErroNegocio("Sem permissao para sangria.", 403);
  }
  if (recurso === "produtos") {
    const somenteEstoque = partes.length >= 3 && partes.at(-1) === "estoque";
    if (somenteEstoque && !permissoes.ajustarEstoque) {
      throw new ErroNegocio("Sem permissao para ajustar estoque.", 403);
    }
    if (!somenteEstoque && !(permissoes.cadastrarProduto || permissoes.editarProduto)) {
      throw new ErroNegocio("Sem permissao para alterar produtos.", 403);
    }
  }
}

/** Remoção em /dados: além da escrita, operador precisa de excluirProduto para produtos. */
export async function exigirRemocaoDados({ cargo, lojaId, funcionarioId, caminho }) {
  await exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho });
  if (cargo === "admin") return;
  if (recursoDoCaminho(caminho) === "produtos") {
    const permissoes = await obterPermissoesFuncionario(lojaId, funcionarioId);
    if (!permissoes.excluirProduto) throw new ErroNegocio("Sem permissao para excluir produtos.", 403);
  }
}

/** Lote em /dados: cada caminho passa pelo mesmo gate de escrita. */
export async function exigirLoteDados({ cargo, lojaId, funcionarioId, atualizacoes }) {
  if (cargo === "admin") return;
  for (const caminho of Object.keys(atualizacoes || {})) {
    await exigirEscritaDados({ cargo, lojaId, funcionarioId, caminho });
  }
}
