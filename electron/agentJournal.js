"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function criarJournal(caminho) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  if (!fs.existsSync(caminho)) fs.writeFileSync(caminho, "", "utf8");

  function registrar(entrada) {
    const row = {
      id: entrada.id || crypto.randomUUID(),
      ts: entrada.ts || new Date().toISOString(),
      modo: entrada.modo || "autorizacao",
      tool: String(entrada.tool || ""),
      resumo: String(entrada.resumo || ""),
      before: entrada.before ?? null,
      after: entrada.after ?? null,
      reversivel: Boolean(entrada.reversivel),
      desfeito: false,
    };
    fs.appendFileSync(caminho, JSON.stringify(row) + "\n", "utf8");
    return row;
  }

  function _lerTodas() {
    const raw = fs.readFileSync(caminho, "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function listar(limite = 50) {
    return _lerTodas().reverse().slice(0, Math.max(1, limite));
  }

  function obter(id) {
    const all = _lerTodas();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function marcarDesfeito(id) {
    const all = _lerTodas();
    let mudou = false;
    const next = all.map((r) => {
      if (r.id === id) {
        mudou = true;
        return { ...r, desfeito: true };
      }
      return r;
    });
    if (mudou) {
      fs.writeFileSync(
        caminho,
        next.map((r) => JSON.stringify(r)).join("\n") + (next.length ? "\n" : ""),
        "utf8"
      );
    }
    return mudou;
  }

  return { registrar, listar, obter, marcarDesfeito, caminho };
}

module.exports = { criarJournal };
