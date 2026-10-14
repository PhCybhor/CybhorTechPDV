import { config } from "../config.js";
import { ErroNegocio } from "../erros.js";
import { lerTextoLimpo } from "../regras/entrada.js";
import { criarAdminInicial as criarAdminInicialServico, existeAdministrador } from "../servicos/authServico.js";
import {
  ativarPorCodigo,
  buscarLojaPorCodigo,
  criarLojaComAdmin,
  obterOuCriarLojaDesenvolvimento,
  obterPerfil,
} from "../servicos/lojaServico.js";
import { lerCorpo, objetoOuVazio } from "./requisicao.js";

const AMBIENTES_CADASTRO_LIVRE = new Set(["development", "dev", "test"]);
const CHAVE_DESENVOLVIMENTO = "DEV-LOCAL";

export async function criarLoja(req, res) {
  const corpo = lerCorpo(req);
  // Público sem CPF/trial: só em development/test. Site e admin cobrem o resto.
  if (!AMBIENTES_CADASTRO_LIVRE.has(config.ambiente.trim().toLowerCase())) {
    throw new ErroNegocio("Cadastro de loja apenas pelo site ou pelo admin.", 403);
  }
  const criada = await criarLojaComAdmin({
    loja: objetoOuVazio(corpo.loja),
    admin: objetoOuVazio(corpo.admin),
    aguardarPagamento: Boolean(corpo.aguardarPagamento),
  });
  res.status(201).json(criada);
}

export async function conectar(req, res) {
  res.json(await buscarLojaPorCodigo(lerCorpo(req).codigo || ""));
}

export async function ativarDesktop(req, res) {
  const chave = lerTextoLimpo(lerCorpo(req).chave).toUpperCase();
  if (chave === CHAVE_DESENVOLVIMENTO) {
    if (config.emProducao) throw new ErroNegocio("Chave de desenvolvimento indisponivel.", 403);
    return res.json(await obterOuCriarLojaDesenvolvimento());
  }
  return res.json(await ativarPorCodigo(chave));
}

export async function statusBootstrap(req, res) {
  res.json({ temAdmin: await existeAdministrador(req.params.lojaId) });
}

export async function criarAdminInicial(req, res) {
  const corpo = lerCorpo(req);
  res.status(201).json(await criarAdminInicialServico(req.params.lojaId, corpo));
}

export async function perfil(req, res) {
  res.json(await obterPerfil(req.auth.lojaId));
}
