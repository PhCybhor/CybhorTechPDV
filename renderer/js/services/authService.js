import {
  ref,
  get,
  push,
  update,
  onValue,
  query,
  orderByChild,
  equalTo,
} from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";
import { gerarSalt, gerarHashSenha, verificarSenha } from "../utils/seguranca.js";
import { caminhoLoja } from "./tenantContext.js";
import { normalizarAreas } from "./areasEquipe.js";

function caminhoFuncionarios() {
  return caminhoLoja("funcionarios");
}

export const CARGOS = Object.freeze({
  ADMIN: "admin",
  OPERADOR: "operador",
});

/**
 * Indica se ja existe pelo menos um administrador cadastrado.
 * Usado para exibir a tela de configuracao inicial no primeiro uso.
 * @returns {Promise<boolean>}
 */
export async function existeAdministrador() {
  const db = await obterDatabase();
  const consulta = query(
    ref(db, caminhoFuncionarios()),
    orderByChild("cargo"),
    equalTo(CARGOS.ADMIN)
  );
  const snapshot = await get(consulta);
  return snapshot.exists();
}

/**
 * Busca um funcionario pelo nome de usuario.
 * @param {string} usuario
 * @returns {Promise<{id: string, dados: object} | null>}
 */
async function buscarPorUsuario(usuario) {
  const db = await obterDatabase();
  const consulta = query(
    ref(db, caminhoFuncionarios()),
    orderByChild("usuario"),
    equalTo(usuario.trim().toLowerCase())
  );
  const snapshot = await get(consulta);
  if (!snapshot.exists()) return null;

  const registros = snapshot.val();
  const id = Object.keys(registros)[0];
  return { id, dados: registros[id] };
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
  if ((senha || "").length < 4)
    throw new Error("A senha deve ter ao menos 4 caracteres.");
  if (![CARGOS.ADMIN, CARGOS.OPERADOR].includes(cargo))
    throw new Error("Cargo inválido.");
  if (areasNorm.length === 0) {
    throw new Error("Selecione ao menos uma área: Caixa, RH ou Marketing.");
  }

  const jaExiste = await buscarPorUsuario(usuarioLimpo);
  if (jaExiste) throw new Error("Já existe um funcionário com esse usuário.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);

  const db = await obterDatabase();
  const referencia = await push(ref(db, caminhoFuncionarios()), {
    nome: nomeLimpo,
    usuario: usuarioLimpo,
    salt,
    senhaHash,
    cargo,
    areas: areasNorm,
    criadoEm: Date.now(),
  });

  return referencia.key;
}

/**
 * Autentica um funcionario pelo usuario e senha.
 * @param {string} usuario
 * @param {string} senha
 * @returns {Promise<{id: string, nome: string, usuario: string, cargo: string}>}
 */
export async function autenticar(usuario, senha) {
  const encontrado = await buscarPorUsuario(usuario);
  if (!encontrado) throw new Error("Usuário ou senha inválidos.");

  const { id, dados } = encontrado;
  const senhaOk = await verificarSenha(senha, dados.salt, dados.senhaHash);
  if (!senhaOk) throw new Error("Usuário ou senha inválidos.");

  return {
    id,
    nome: dados.nome,
    usuario: dados.usuario,
    cargo: dados.cargo,
  };
}

/**
 * Valida as credenciais de um administrador.
 * Usado para autorizar acoes sensiveis, como criar um novo caixa/funcionario.
 * @param {string} usuario
 * @param {string} senha
 * @returns {Promise<boolean>}
 */
export async function validarAdministrador(usuario, senha) {
  const encontrado = await buscarPorUsuario(usuario);
  if (!encontrado || encontrado.dados.cargo !== CARGOS.ADMIN) return false;
  return verificarSenha(senha, encontrado.dados.salt, encontrado.dados.senhaHash);
}

/**
 * Retorna todos os funcionarios cadastrados.
 * @returns {Promise<Array<object>>}
 */
export async function listarFuncionarios() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoFuncionarios()));
  if (!snapshot.exists()) return [];
  return Object.entries(snapshot.val())
    .map(([id, dados]) => ({ id, ...dados }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Observa a lista de funcionarios em tempo real.
 * @param {(funcionarios: Array<object>) => void} callback
 * @returns {Promise<import("firebase/database").Unsubscribe>}
 */
export async function observarFuncionarios(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoFuncionarios()), (snapshot) => {
    const lista = snapshot.exists()
      ? Object.entries(snapshot.val())
          .map(([id, dados]) => ({ id, ...dados }))
          .sort((a, b) => a.nome.localeCompare(b.nome))
      : [];
    callback(lista);
  });
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

  const db = await obterDatabase();
  const referencia = ref(db, `${caminhoFuncionarios()}/${funcionarioId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Funcionário não encontrado.");

  const dados = snapshot.val();
  if (dados.cargo === cargo) return;

  if (dados.cargo === CARGOS.ADMIN && cargo === CARGOS.OPERADOR) {
    const admins = (await listarFuncionarios()).filter(
      (f) => f.cargo === CARGOS.ADMIN
    );
    if (admins.length <= 1) {
      throw new Error("Não é possível rebaixar o único administrador do sistema.");
    }
  }

  await update(referencia, { cargo, atualizadoEm: Date.now() });
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
  if ((novaSenha || "").length < 4) {
    throw new Error("A nova senha deve ter ao menos 4 caracteres.");
  }

  const adminOk = await validarAdministrador(adminUsuario, adminSenha);
  if (!adminOk) throw new Error("Credenciais de administrador inválidas.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(novaSenha, salt);
  const db = await obterDatabase();
  const referencia = ref(db, `${caminhoFuncionarios()}/${funcionarioId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Funcionário não encontrado.");

  await update(referencia, {
    salt,
    senhaHash,
    atualizadoEm: Date.now(),
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

  const db = await obterDatabase();
  const referencia = ref(db, `${caminhoFuncionarios()}/${funcionarioId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Funcionário não encontrado.");

  await update(referencia, patch);
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

  const db = await obterDatabase();
  const referencia = ref(db, `${caminhoFuncionarios()}/${funcionarioId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Funcionário não encontrado.");

  await update(referencia, {
    areas: areasNorm,
    atualizadoEm: Date.now(),
  });
}

