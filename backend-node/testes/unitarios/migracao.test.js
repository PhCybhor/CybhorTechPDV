import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { converterLinha, ErroDeConversao, paraCentavos, paraDatetimeUtc } from "../../scripts/migracao/conversao.js";

const coluna = (tipo, tamanhoMaximo = null, nulo = false) => ({ tipo, tamanhoMaximo, nulo });

describe("conversão PostgreSQL -> MySQL", () => {
  it("converte timestamptz para DATETIME em UTC com milissegundos", () => {
    assert.equal(paraDatetimeUtc("2026-03-10T23:59:59.999999-03:00"), "2026-03-11 02:59:59.999");
    assert.equal(paraDatetimeUtc("2026-01-01T00:00:00+00:00"), "2026-01-01 00:00:00.000");
    assert.throws(() => paraDatetimeUtc("ontem"), ErroDeConversao);
  });

  it("soma dinheiro em centavos exatos", () => {
    assert.equal(paraCentavos("1498620.00"), 149862000n);
    assert.equal(paraCentavos("0.1"), 10n);
    assert.equal(paraCentavos("-5.25"), -525n);
    assert.throws(() => paraCentavos("1.234"), ErroDeConversao);
  });

  it("converte tipos e serializa JSON", () => {
    const colunas = new Map([
      ["id", coluna("char", 36)],
      ["ativa", coluna("tinyint")],
      ["preco", coluna("decimal")],
      ["dados", coluna("longtext", null, false)],
      ["valida_ate", coluna("date", null, true)],
    ]);
    const { colunas: nomes, valores } = converterLinha(
      "funcionarios",
      { id: "abc", ativa: true, preco: "27.90", dados: { areas: ["caixa"] }, valida_ate: null },
      colunas,
    );
    assert.deepEqual(nomes, ["id", "ativa", "preco", "dados", "valida_ate"]);
    assert.deepEqual(valores, ["abc", 1, "27.90", '{"areas":["caixa"]}', null]);
  });

  it("preenche colunas obrigatórias ausentes em bancos antigos", () => {
    const colunas = new Map([
      ["id", coluna("char", 36)],
      ["dados", coluna("longtext")],
    ]);
    assert.deepEqual(converterLinha("funcionarios", { id: "f1" }, colunas).valores, ["f1", "{}"]);
  });

  it("recusa texto maior que a coluna contando caracteres, não bytes", () => {
    const colunas = new Map([["nome", coluna("varchar", 3)]]);
    assert.deepEqual(converterLinha("lojas", { nome: "ção" }, colunas).valores, ["ção"]);
    assert.deepEqual(converterLinha("lojas", { nome: "🥖🥖🥖" }, colunas).valores, ["🥖🥖🥖"]);
    assert.throws(() => converterLinha("lojas", { nome: "abcd" }, colunas), /nome: texto com 4 caracteres \(maximo 3\)/);
    assert.throws(() => converterLinha("lojas", { extra: 1 }, colunas), /coluna extra nao existe/);
  });
});
