import { ErroValidacao } from "../erros.js";
import { ehObjetoSimples, exigirObjeto } from "../regras/entrada.js";

/** Corpo JSON obrigatório como objeto; senão 422 "Dados invalidos.". */
export function lerCorpo(req) {
  return exigirObjeto(req.body);
}

/** Corpo opcional: ausente vira {}, mas formato errado continua 422. */
export function lerCorpoOpcional(req) {
  if (req.body === undefined || req.body === null) return {};
  return exigirObjeto(req.body);
}

/** Sub-objeto do corpo (ex.: body.loja); qualquer outro tipo vira {}. */
export function objetoOuVazio(valor) {
  return ehObjetoSimples(valor) ? valor : {};
}

/** Parâmetro de query obrigatório e único; senão 422. */
export function lerConsultaObrigatoria(req, nome) {
  const valor = req.query[nome];
  if (typeof valor !== "string") throw new ErroValidacao();
  return valor;
}

/** Parâmetro inteiro opcional de query; texto não numérico vira 422. */
export function lerConsultaInteira(req, nome, padrao) {
  const valor = req.query[nome];
  if (valor === undefined) return padrao;
  if (typeof valor !== "string" || !/^\s*[-+]?\d+\s*$/.test(valor)) throw new ErroValidacao();
  return Number.parseInt(valor, 10);
}

/** IP do cliente já resolvido pelo `trust proxy` do Express. */
export function ipCliente(req) {
  return req.ip || "";
}

/** Dados do funcionário logado no formato que os serviços de venda esperam. */
export function funcionarioLogado(req) {
  return { id: req.auth.funcionarioId, nome: req.auth.nome };
}

/** Contexto de permissão do usuário logado (cargo, loja e funcionário). */
export function contextoPermissao(req) {
  return { cargo: req.auth.cargo, lojaId: req.auth.lojaId, funcionarioId: req.auth.funcionarioId };
}

/** Caminho curinga de /dados/* (Express 5 entrega os segmentos já decodificados). */
export function caminhoDados(req) {
  const segmentos = req.params.caminho;
  return Array.isArray(segmentos) ? segmentos.join("/") : String(segmentos || "");
}
