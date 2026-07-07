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

const CAMINHO_FUNCIONARIOS = "funcionarios";

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
    ref(db, CAMINHO_FUNCIONARIOS),
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
    ref(db, CAMINHO_FUNCIONARIOS),
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
 * @param {{nome: string, usuario: string, senha: string, cargo: string}} funcionario
 * @returns {Promise<string>} id gerado
 */
export async function criarFuncionario({ nome, usuario, senha, cargo }) {
  const nomeLimpo = (nome || "").trim();
  const usuarioLimpo = (usuario || "").trim().toLowerCase();

  if (nomeLimpo.length < 2) throw new Error("Informe o nome do funcionario.");
  if (usuarioLimpo.length < 3)
    throw new Error("O usuario deve ter ao menos 3 caracteres.");
  if ((senha || "").length < 4)
    throw new Error("A senha deve ter ao menos 4 caracteres.");
  if (![CARGOS.ADMIN, CARGOS.OPERADOR].includes(cargo))
    throw new Error("Cargo invalido.");

  const jaExiste = await buscarPorUsuario(usuarioLimpo);
  if (jaExiste) throw new Error("Ja existe um funcionario com esse usuario.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);

  const db = await obterDatabase();
  const referencia = await push(ref(db, CAMINHO_FUNCIONARIOS), {
    nome: nomeLimpo,
    usuario: usuarioLimpo,
    salt,
    senhaHash,
    cargo,
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
  if (!encontrado) throw new Error("Usuario ou senha invalidos.");

  const { id, dados } = encontrado;
  const senhaOk = await verificarSenha(senha, dados.salt, dados.senhaHash);
  if (!senhaOk) throw new Error("Usuario ou senha invalidos.");

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
  const snapshot = await get(ref(db, CAMINHO_FUNCIONARIOS));
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
  return onValue(ref(db, CAMINHO_FUNCIONARIOS), (snapshot) => {
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
    throw new Error("Cargo invalido.");

  const adminOk = await validarAdministrador(adminUsuario, adminSenha);
  if (!adminOk) throw new Error("Credenciais de administrador invalidas.");

  const db = await obterDatabase();
  const referencia = ref(db, `${CAMINHO_FUNCIONARIOS}/${funcionarioId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Funcionario nao encontrado.");

  const dados = snapshot.val();
  if (dados.cargo === cargo) return;

  if (dados.cargo === CARGOS.ADMIN && cargo === CARGOS.OPERADOR) {
    const admins = (await listarFuncionarios()).filter(
      (f) => f.cargo === CARGOS.ADMIN
    );
    if (admins.length <= 1) {
      throw new Error("Nao e possivel rebaixar o unico administrador do sistema.");
    }
  }

  await update(referencia, { cargo, atualizadoEm: Date.now() });
}
