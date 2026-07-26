"use strict";

/**
 * Montagem ESC/POS alinhada ao Exemplo_JP800_Delphi (TP650.pas).
 * A JP-800 recebe bytes RAW via porta COM ou WritePrinter (datatype RAW).
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * @param {...(number|number[]|Buffer|string)} partes
 * @returns {Buffer}
 */
function juntar(...partes) {
  const buffers = partes.map((parte) => {
    if (Buffer.isBuffer(parte)) return parte;
    if (typeof parte === "number") return Buffer.from([parte]);
    if (Array.isArray(parte)) return Buffer.from(parte);
    return Buffer.from(String(parte), "latin1");
  });
  return Buffer.concat(buffers);
}

/** ESC @ — inicializa impressora + code page PC850 (acentos BR) */
function inicializar() {
  return Buffer.from([
    ESC, 0x40,
    // ESC t 2 = PC850 (Latin1/BR) — evita lixo e erro no driver com .toLocaleString
    ESC, 0x74, 0x02,
  ]);
}

/**
 * ESC a n — alinhamento (0=esq, 1=centro, 2=dir).
 * No Delphi o exemplo usa 48/49/50 (ASCII '0'..'2') em alguns fluxos;
 * ESC/POS padrao aceita 0..2.
 * @param {0|1|2} alinhamento
 */
function alinhar(alinhamento = 0) {
  return Buffer.from([ESC, 0x61, alinhamento & 0xff]);
}

/** ESC E n — negrito */
function negrito(ligado) {
  return Buffer.from([ESC, 0x45, ligado ? 1 : 0]);
}

/** ESC G n — negrito duplo (como textoNegrito do TP650) */
function negritoDuplo(ligado) {
  return Buffer.from([ESC, 0x47, ligado ? 1 : 0]);
}

/** ESC M n — fonte condensada (n=1) */
function fonteCondensada(ligada) {
  return Buffer.from([ESC, 0x4d, ligada ? 1 : 0]);
}

/**
 * Texto em latin1 (code page padrao das Jetway no Brasil apos ESC t).
 * @param {string} texto
 */
function texto(textoLivre) {
  return Buffer.from(textoSeguro(textoLivre), "latin1");
}

function linha(textoLivre = "") {
  return juntar(texto(textoLivre), LF);
}

/** Avanco de papel — FeedPaper do exemplo Delphi (13 LFs) */
function avancarPapel(linhas = 5) {
  return Buffer.alloc(Math.max(0, linhas), LF);
}

/**
 * Corte parcial — GS V 1 (mais compativel com drivers USB da JP-800).
 * O ESC m do TP650 falhava em algumas instalacoes Windows 10/11.
 */
function cortarPapel() {
  return Buffer.from([GS, 0x56, 0x01]);
}

/**
 * GS ( k — QR Code (mesmo fluxo do TP650.qrcode).
 * @param {string} conteudo
 * @param {number} tamanho 1..16
 */
function qrcode(conteudo, tamanho = 6) {
  const payload = Buffer.from(String(conteudo ?? ""), "latin1");
  const f65 = Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
  const f67 = Buffer.from([
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    tamanho % 17,
  ]);
  const f69 = Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x03]);
  const len = payload.length + 3;
  const f80 = juntar(
    Buffer.from([GS, 0x28, 0x6b, len % 256, Math.floor(len / 256), 0x31, 0x50, 0x30]),
    payload
  );
  const f81 = Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
  return juntar(f65, f67, f69, f80, f81);
}

/**
 * Linha com esquerda/direita preenchida com espacos (48 colunas = 80mm fonte A).
 * @param {string} esquerda
 * @param {string} direita
 * @param {number} colunas
 */
function linhaDuasColunas(esquerda, direita, colunas = 48) {
  const esq = String(esquerda ?? "");
  const dir = String(direita ?? "");
  const espacos = Math.max(1, colunas - esq.length - dir.length);
  return linha(esq + " ".repeat(espacos) + dir);
}

/**
 * Separador tracejado.
 * @param {number} colunas
 */
function separador(colunas = 48) {
  return linha("-".repeat(colunas));
}

/**
 * Formata moeda em ASCII puro (sem NBSP/Unicode do toLocaleString),
 * para nao corromper o buffer latin1 / ESC/POS e gerar erro na fila.
 * @param {number} valor
 * @returns {string}
 */
function moeda(valor) {
  const numero = Number(valor) || 0;
  const [inteiro, decimal = "00"] = Math.abs(numero).toFixed(2).split(".");
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sinal = numero < 0 ? "-" : "";
  return `${sinal}R$ ${comPontos},${decimal}`;
}

/**
 * Remove acentos e caracteres fora do latin1 que podem quebrar a JP-800.
 * @param {string} valor
 * @returns {string}
 */
function textoSeguro(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

/**
 * @param {string} forma
 * @returns {string}
 */
function rotuloPagamento(forma) {
  const mapa = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    debito: "Cartao de debito",
    credito: "Cartao de credito",
  };
  return mapa[forma] || String(forma || "-");
}

/**
 * Gera o buffer RAW do cupom (protocolo do Exemplo JP-800 Delphi).
 * @param {object} dados
 * @param {object} loja
 * @returns {Buffer}
 */
function gerarBufferEscPos(dados, loja = {}) {
  const partes = [];
  const dataHora = new Date(dados.criadoEm || Date.now()).toLocaleString("pt-BR");
  const nomeLoja = loja.nome || "CybhorPDV";
  const idCurto = String(dados.id || "").slice(-8).toUpperCase();

  partes.push(inicializar());
  partes.push(alinhar(1));
  partes.push(negritoDuplo(true));
  partes.push(linha(nomeLoja));
  partes.push(negritoDuplo(false));

  if (loja.cnpj) partes.push(linha(`CNPJ: ${loja.cnpj}`));
  if (loja.endereco) partes.push(linha(loja.endereco));
  if (loja.telefone) partes.push(linha(`Tel: ${loja.telefone}`));

  partes.push(separador());
  partes.push(negrito(true));
  partes.push(linha("COMPROVANTE DE VENDA"));
  partes.push(negrito(false));
  partes.push(linha("Documento auxiliar (nao fiscal)"));
  partes.push(separador());

  partes.push(alinhar(0));
  partes.push(linha(`Venda: ${idCurto}`));
  partes.push(linha(`Data: ${dataHora}`));
  partes.push(linha(`Operador: ${dados.funcionarioNome || "-"}`));
  partes.push(separador());

  for (const item of dados.itens || []) {
    const qtd = Number(item.quantidade) || 0;
    const unit = moeda(item.precoUnitario);
    const sub = moeda(item.subtotal ?? qtd * item.precoUnitario);
    partes.push(linha(String(item.nome || "").slice(0, 48)));
    partes.push(linhaDuasColunas(`${qtd} x ${unit}`, sub));
  }

  partes.push(separador());
  partes.push(linhaDuasColunas("Subtotal", moeda(dados.subtotal)));
  if (Number(dados.desconto) > 0) {
    partes.push(linhaDuasColunas("Desconto", `- ${moeda(dados.desconto)}`));
  }
  partes.push(negrito(true));
  partes.push(linhaDuasColunas("TOTAL", moeda(dados.total)));
  partes.push(negrito(false));
  partes.push(linhaDuasColunas("Pagamento", rotuloPagamento(dados.formaPagamento)));

  if (dados.formaPagamento === "dinheiro" && Number(dados.valorRecebido) > 0) {
    partes.push(linhaDuasColunas("Recebido", moeda(dados.valorRecebido)));
    partes.push(linhaDuasColunas("Troco", moeda(dados.troco || 0)));
  }

  partes.push(separador());
  partes.push(alinhar(1));
  partes.push(linha("Obrigado pela preferencia!"));
  partes.push(linha("CybhorPDV"));
  partes.push(avancarPapel(5));
  partes.push(cortarPapel());
  if (dados.abrirGaveta) {
    partes.push(abrirGaveta());
  }

  return juntar(...partes);
}

/** ESC p m t1 t2 — pulso na gaveta de dinheiro (pin 2). */
function abrirGaveta() {
  return Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]);
}

module.exports = {
  gerarBufferEscPos,
  inicializar,
  alinhar,
  cortarPapel,
  avancarPapel,
  abrirGaveta,
  qrcode,
  juntar,
};
