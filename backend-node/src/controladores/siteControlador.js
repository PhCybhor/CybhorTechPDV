import path from "node:path";
import { catalogoPlanos, obterPlano } from "../regras/planos.js";
import { caminhoInstalador, listarInstaladores } from "../servicos/instaladoresServico.js";
import { comprarPeloSite, consultarAtivacao, obterDadosPagamento, processarPagamentoSite } from "../servicos/siteServico.js";
import { ipCliente, lerConsultaObrigatoria, lerCorpo, objetoOuVazio } from "./requisicao.js";

export function preco(_req, res) {
  res.json({ ok: true, preco: obterPlano("mensal").valor, planos: catalogoPlanos() });
}

export async function comprar(req, res) {
  const corpo = lerCorpo(req);
  const resultado = await comprarPeloSite({
    loja: objetoOuVazio(corpo.loja),
    admin: objetoOuVazio(corpo.admin),
    plano: corpo.plano || "mensal",
    aceiteDiretrizes: corpo.aceiteDiretrizes,
    ip: ipCliente(req),
    navegador: req.get("user-agent") || "",
  });
  res.status(201).json({
    tokenAtivacao: resultado.tokenAtivacao,
    checkoutUrl: resultado.checkoutUrl || "",
    publicKey: resultado.publicKey || "",
    trial: Boolean(resultado.trial),
    redirectUrl: resultado.redirectUrl || "",
  });
}

export function downloads(_req, res) {
  res.json(listarInstaladores());
}

export function baixar(req, res) {
  const caminho = caminhoInstalador(req.params.arquivo);
  res.type("application/octet-stream").download(caminho, path.basename(caminho));
}

export function baixarVersao(req, res) {
  const { versao, arquivo } = req.params;
  const caminho = caminhoInstalador(arquivo, versao);
  const extensao = path.extname(caminho);
  // Nome com a versão para o cliente distinguir setups antigos na pasta Downloads.
  const nomeArquivo = `${path.basename(caminho, extensao)}-v${versao}${extensao}`;
  res.type("application/octet-stream").download(caminho, nomeArquivo);
}

export async function pagamento(req, res) {
  res.json(await obterDadosPagamento(lerConsultaObrigatoria(req, "token")));
}

export async function pagar(req, res) {
  const corpo = lerCorpo(req);
  res.json(await processarPagamentoSite(corpo.tokenAtivacao || "", objetoOuVazio(corpo.formData)));
}

export async function ativacao(req, res) {
  res.json(await consultarAtivacao(lerConsultaObrigatoria(req, "token")));
}
