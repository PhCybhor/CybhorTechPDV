/** Diretrizes da comunidade: versão vigente e validação do aceite na compra. */
import { ErroNegocio } from './errors.js';
import { objetoOuVazio, texto } from './utils/valores.js';

// Mudou o texto de landing/diretrizes.html? Troque a versão aqui e em
// landing/cadastro.js: quem estiver com a página antiga aberta precisa aceitar de novo.
export const VERSAO_DIRETRIZES = '2026-10-13';

const TAMANHO_MAX_IP = 64;
const TAMANHO_MAX_NAVEGADOR = 300;

/**
 * Exige o aceite da versão vigente e devolve o registro a ser gravado.
 *
 * @param {unknown} aceite corpo enviado pelo site: `{ aceito: true, versao: '...' }`.
 * @param {{ ip?: string, navegador?: string }} [contexto] IP (já resolvido atrás do proxy)
 *   e User-Agent, guardados como prova do aceite.
 * @returns {{ versao: string, ip: string, navegador: string }}
 * @throws {ErroNegocio}
 */
export function validarAceiteDiretrizes(aceite, { ip = '', navegador = '' } = {}) {
  const dados = objetoOuVazio(aceite);
  if (dados.aceito !== true) {
    throw new ErroNegocio('Para continuar, aceite as Diretrizes da comunidade.');
  }
  if (texto(dados.versao) !== VERSAO_DIRETRIZES) {
    throw new ErroNegocio(
      'As Diretrizes da comunidade foram atualizadas. Recarregue a página e aceite a versão atual.',
      409,
    );
  }
  return {
    versao: VERSAO_DIRETRIZES,
    ip: texto(ip).slice(0, TAMANHO_MAX_IP),
    navegador: texto(navegador).slice(0, TAMANHO_MAX_NAVEGADOR),
  };
}
