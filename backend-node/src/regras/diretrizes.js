import { ErroNegocio } from "../erros.js";
import { ehObjetoSimples } from "./entrada.js";

// Mudou o texto de landing/diretrizes.html? Troque a versão aqui e em
// landing/cadastro.js: quem estiver com a página antiga aberta precisa aceitar de novo.
export const VERSAO_DIRETRIZES = "2026-10-13";

const TAMANHO_MAX_IP = 64;
const TAMANHO_MAX_NAVEGADOR = 300;

/**
 * Exige o aceite da versão vigente e devolve o registro a ser gravado.
 * @param {unknown} aceite corpo {"aceito": true, "versao": "..."} enviado pelo site.
 * @param {{ ip?: string, navegador?: string }} contexto IP já resolvido e User-Agent.
 */
export function validarAceiteDiretrizes(aceite, { ip = "", navegador = "" } = {}) {
  const dados = ehObjetoSimples(aceite) ? aceite : {};
  if (dados.aceito !== true) throw new ErroNegocio("Para continuar, aceite as Diretrizes da comunidade.");
  if (String(dados.versao ?? "").trim() !== VERSAO_DIRETRIZES) {
    throw new ErroNegocio(
      "As Diretrizes da comunidade foram atualizadas. Recarregue a página e aceite a versão atual.",
      409,
    );
  }
  return {
    versao: VERSAO_DIRETRIZES,
    ip: String(ip || "").trim().slice(0, TAMANHO_MAX_IP),
    navegador: String(navegador || "").trim().slice(0, TAMANHO_MAX_NAVEGADOR),
  };
}
