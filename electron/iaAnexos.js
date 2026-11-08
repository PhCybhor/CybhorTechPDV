"use strict";

const marca = require("./marcaProduto.cjs");

/**
 * Reconhece JSON de backup desta linha de produto.
 * Aceita o nome atual e o legado. Qualquer outro app é rejeitado.
 * @param {unknown} textoOuObjeto
 * @returns {{ ok: boolean, backup?: object }}
 */
function reconhecerBackupCybhor(textoOuObjeto) {
  let obj = textoOuObjeto;
  if (typeof textoOuObjeto === "string") {
    try {
      obj = JSON.parse(textoOuObjeto);
    } catch {
      return { ok: false };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false };
  }
  if (!marca.appBackupValido(obj.app)) {
    return { ok: false };
  }
  return { ok: true, backup: obj };
}

module.exports = {
  reconhecerBackupCybhor,
};
