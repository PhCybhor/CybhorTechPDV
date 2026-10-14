import { config } from "../config.js";
import { ErroNegocio } from "../erros.js";
import { ehVazioComoPython } from "../regras/entrada.js";
import {
  bootstrapAdminSistema,
  criarContaLoja,
  definirLojaAtiva,
  detalharLoja,
  listarLojasComMetricas,
  loginAdminSistema,
  regenerarChaveLoja,
} from "../servicos/adminServico.js";
import { lerCorpo, objetoOuVazio } from "./requisicao.js";

export async function bootstrap(req, res) {
  const corpo = lerCorpo(req);
  if (config.emProducao) throw new ErroNegocio("Bootstrap indisponivel em producao.", 403);
  res.status(201).json(
    await bootstrapAdminSistema({
      nome: corpo.nome || "",
      email: corpo.email || "",
      senha: corpo.senha || "",
      segredo: corpo.secret || "",
    }),
  );
}

export async function login(req, res) {
  const corpo = lerCorpo(req);
  res.json(await loginAdminSistema({ email: corpo.email || "", senha: corpo.senha || "" }));
}

export async function listarLojas(_req, res) {
  res.json(await listarLojasComMetricas());
}

export async function detalhar(req, res) {
  res.json(await detalharLoja(req.params.lojaId));
}

export async function definirAtiva(req, res) {
  const corpo = lerCorpo(req);
  if (!Object.hasOwn(corpo, "ativa")) throw new ErroNegocio("Informe o campo ativa.");
  await definirLojaAtiva(req.params.lojaId, !ehVazioComoPython(corpo.ativa));
  res.status(204).end();
}

export async function criarLoja(req, res) {
  const corpo = lerCorpo(req);
  res.status(201).json(await criarContaLoja({ loja: objetoOuVazio(corpo.loja), admin: objetoOuVazio(corpo.admin) }));
}

export async function regenerarChave(req, res) {
  res.json(await regenerarChaveLoja(req.params.lojaId));
}
