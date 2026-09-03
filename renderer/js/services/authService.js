import {
  apiRequest,
  definirTokenSessao,
  limparTokenSessao,
} from "../config/apiClient.js";
import { obterLojaId, obterMetaLoja } from "./tenantContext.js";
import { normalizarAreas } from "./areasEquipe.js";

export const CARGOS = Object.freeze({
  ADMIN: "admin",
  OPERADOR: "operador",
});

export function encerrarSessao() {
  limparTokenSessao();
}

/**
 * Indica se ja existe pelo menos um administrador cadastrado.
 * Usado para exibir a tela de configuracao inicial no primeiro uso.
 * @returns {Promise<boolean>}
 */
export async function existeAdministrador() {
  const lojaId = obterLojaId();
  if (!lojaId) return false;
  const resposta = await apiRequest(`/api/lojas/${lojaId}/bootstrap`);
  return Boolean(resposta?.temAdmin);
}

/**
 * Cria um novo funcionario (operador ou administrador).
 * @param {{
 *   nome: string,
 *   usuario: string,
 *   senha: string,
 *   cargo: string,
 *   areas?: string[]
 * }} funcionario
 * @returns {Promise<string>} id gerado
 */
export async function criarFuncionario({ nome, usuario, senha, cargo, areas }) {
  const nomeLimpo = (nome || "").trim();
  const usuarioLimpo = (usuario || "").trim().toLowerCase();
  const areasNorm = normalizarAreas(areas);

  if (nomeLimpo.length < 2) throw new Error("Informe o nome do funcionário.");
  if (usuarioLimpo.length < 3)
    throw new Error("O usuário deve ter ao menos 3 caracteres.");
  if ((senha || "").length < 8)
    throw new Error("A senha deve ter ao menos 8 caracteres.");
  if (![CARGOS.ADMIN, CARGOS.OPERADOR].includes(cargo))
    throw new Error("Cargo inválido.");
  if (areasNorm.length === 0) {
    throw new Error("Selecione ao menos uma área: Caixa, RH ou Marketing.");
  }

  const dados = {
    nome: nomeLimpo,
    usuario: usuarioLimpo,
    senha,
    cargo,
    areas: areasNorm,
  };
  const lojaId = obterLojaId();
  if (!lojaId) throw new Error("Nenhuma loja conectada.");

  const temAdmin = await existeAdministrador();
  if (!temAdmin) {
    const chave = obterMetaLoja()?.chave;
    if (!chave) {
      throw new Error(
        "Chave de ativação ausente. Reative a licença antes de criar o administrador."
      );
    }
    dados.chaveAtivacao = chave;
  }

  const resposta = await apiRequest(
    temAdmin ? "/api/funcionarios" : `/api/lojas/${lojaId}/admin-inicial`,
    { method: "POST", body: dados }
  );
  return resposta.id;
}

/**
 * Autentica um funcionario pelo usuario e senha.
 * @param {string} usuario
 * @param {string} senha
 * @returns {Promise<{id: string, nome: string, usuario: string, cargo: string}>}
 */
export async function autenticar(usuario, senha) {
  const resposta = await apiRequest("/api/auth/login", {
    method: "POST",
    body: {
      lojaId: obterLojaId(),
      usuario: String(usuario || "").trim().toLowerCase(),
      senha,
    },
  });
  definirTokenSessao(resposta.token);
  return resposta.funcionario;
}

/**
 * Valida as credenciais de um administrador.
 * Usado para autorizar acoes sensiveis, como criar um novo caixa/funcionario.
 * @param {string} usuario
 * @param {string} senha
 * @returns {Promise<boolean>}
 */
export async function validarAdministrador(usuario, senha) {
  try {
    const resposta = await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        lojaId: obterLojaId(),
        usuario: String(usuario || "").trim().toLowerCase(),
        senha,
      },
    });
    return resposta?.funcionario?.cargo === CARGOS.ADMIN;
  } catch {
    return false;
  }
}

/**
 * Retorna todos os funcionarios cadastrados.
 * @returns {Promise<Array<object>>}
 */
export async function listarFuncionarios() {
  return apiRequest("/api/funcionarios");
}

/**
 * Observa a lista de funcionarios em tempo real.
 * @param {(funcionarios: Array<object>) => void} callback
 * @returns {Promise<() => void>}
 */
export async function observarFuncionarios(callback) {
  let ativo = true;
  const atualizar = async () => {
    if (!ativo) return;
    try {
      callback(await listarFuncionarios());
    } catch (erro) {
      console.error("Falha ao carregar funcionários:", erro);
    }
  };
  await atualizar();
  const timer = setInterval(atualizar, 3000);
  return () => {
    ativo = false;
    clearInterval(timer);
  };
}

/**
 * Atualiza o cargo de um funcionario. Exige confirmacao com senha de administrador.
 * Impede remover o unico administrador do sistema.
 *
 * @param {{funcionarioId: string, cargo: string, adminUsuario: string, adminSenha: string}} params
 * @returns {Promise<void>}
 */
export async function atualizarCargoFuncionario({
  funcionarioId,
  cargo,
  adminUsuario,
  adminSenha,
}) {
  if (![CARGOS.ADMIN, CARGOS.OPERADOR].includes(cargo))
    throw new Error("Cargo inválido.");

  const adminOk = await validarAdministrador(adminUsuario, adminSenha);
  if (!adminOk) throw new Error("Credenciais de administrador inválidas.");

  const dados = (await listarFuncionarios()).find((f) => f.id === funcionarioId);
  if (!dados) throw new Error("Funcionário não encontrado.");
  if (dados.cargo === cargo) return;

  if (dados.cargo === CARGOS.ADMIN && cargo === CARGOS.OPERADOR) {
    const admins = (await listarFuncionarios()).filter(
      (f) => f.cargo === CARGOS.ADMIN
    );
    if (admins.length <= 1) {
      throw new Error("Não é possível rebaixar o único administrador do sistema.");
    }
  }

  await apiRequest(`/api/funcionarios/${funcionarioId}`, {
    method: "PATCH",
    body: { cargo },
  });
}

/**
 * Altera a senha de um funcionário (exige senha do administrador).
 * @param {{
 *   funcionarioId: string,
 *   novaSenha: string,
 *   adminUsuario: string,
 *   adminSenha: string
 * }} params
 */
export async function alterarSenhaFuncionario({
  funcionarioId,
  novaSenha,
  adminUsuario,
  adminSenha,
}) {
  if (!funcionarioId) throw new Error("Funcionário inválido.");
  if ((novaSenha || "").length < 8) {
    throw new Error("A nova senha deve ter ao menos 8 caracteres.");
  }

  const adminOk = await validarAdministrador(adminUsuario, adminSenha);
  if (!adminOk) throw new Error("Credenciais de administrador inválidas.");

  await apiRequest(`/api/funcionarios/${funcionarioId}`, {
    method: "PATCH",
    body: { novaSenha },
  });
}

/**
 * Salva dados de remuneração / vínculo (CLT, PJ, MEI) no cadastro do funcionário.
 * Não exige senha admin — só quem já está logado como admin acessa a tela Equipe.
 * @param {string} funcionarioId
 * @param {{
 *   tipoVinculo?: string,
 *   salarioBruto?: number | null,
 *   dependentes?: number,
 *   valorContrato?: number | null
 * }} dados
 */
export async function atualizarDadosRemuneracao(funcionarioId, dados) {
  if (!funcionarioId) throw new Error("Funcionário inválido.");

  const tiposOk = new Set(["clt", "pj", "mei"]);
  const tipoVinculo = String(dados.tipoVinculo || "clt").toLowerCase();
  if (!tiposOk.has(tipoVinculo)) {
    throw new Error("Tipo de vínculo inválido (CLT, PJ ou MEI).");
  }

  const patch = {
    tipoVinculo,
    dependentes: Math.max(0, Math.floor(Number(dados.dependentes) || 0)),
    atualizadoEm: Date.now(),
  };

  if (tipoVinculo === "clt") {
    const salario = Number(dados.salarioBruto);
    patch.salarioBruto =
      dados.salarioBruto === null ||
      dados.salarioBruto === undefined ||
      dados.salarioBruto === ""
        ? null
        : Number.isFinite(salario) && salario >= 0
          ? salario
          : null;
    patch.valorContrato = null;
  } else {
    const contrato = Number(dados.valorContrato);
    patch.valorContrato =
      dados.valorContrato === null ||
      dados.valorContrato === undefined ||
      dados.valorContrato === ""
        ? null
        : Number.isFinite(contrato) && contrato >= 0
          ? contrato
          : null;
    patch.salarioBruto = null;
  }

  await apiRequest(`/api/funcionarios/${funcionarioId}`, {
    method: "PATCH",
    body: patch,
  });
}

/**
 * Atualiza as áreas de atuação (multi) do funcionário.
 * @param {string} funcionarioId
 * @param {string[]} areas
 */
export async function atualizarAreasFuncionario(funcionarioId, areas) {
  if (!funcionarioId) throw new Error("Funcionário inválido.");
  const areasNorm = normalizarAreas(areas);
  if (areasNorm.length === 0) {
    throw new Error("Selecione ao menos uma área de atuação.");
  }

  await apiRequest(`/api/funcionarios/${funcionarioId}`, {
    method: "PATCH",
    body: { areas: areasNorm },
  });
}

/**
 * Atualiza as permissões do operador de caixa.
 * @param {string} funcionarioId
 * @param {Record<string, boolean>} permissoes
 */
export async function atualizarPermissoesFuncionario(funcionarioId, permissoes) {
  if (!funcionarioId) throw new Error("Funcionário inválido.");
  await apiRequest(`/api/funcionarios/${funcionarioId}`, {
    method: "PATCH",
    body: { permissoes: permissoes || {} },
  });
}

