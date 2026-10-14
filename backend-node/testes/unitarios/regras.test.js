import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.JWT_SEGREDO = "x".repeat(40);
process.env.MP_WEBHOOK_SECRET = "segredo-webhook";

const { avaliarAssinatura, deveEstenderAssinatura, deveMarcarInadimplente } = await import("../../src/regras/assinatura.js");
const { validarCpf } = await import("../../src/regras/cpf.js");
const { validarAceiteDiretrizes, VERSAO_DIRETRIZES } = await import("../../src/regras/diretrizes.js");
const { catalogoPlanos, obterPlano } = await import("../../src/regras/planos.js");
const { montarCorpoPagamento } = await import("../../src/regras/mercadoPago.js");
const { gerarHashSenha, validarTamanhoSenha, verificarSenha } = await import("../../src/seguranca/senha.js");
const { converterExpiracaoEmSegundos, decodificarToken, emitirToken } = await import("../../src/seguranca/token.js");
const { verificarAssinaturaWebhook } = await import("../../src/servicos/pagamentoServico.js");
const { definirNoDocumento } = await import("../../src/servicos/dadosServico.js");
const { recursoDoCaminho, normalizarPermissoes } = await import("../../src/servicos/authServico.js");

describe("senha (compatível com o backend Python)", () => {
  it("gera o mesmo PBKDF2 que hashlib.pbkdf2_hmac", async () => {
    assert.equal(
      await gerarHashSenha("senha-de-teste-123", "0123456789abcdef0123456789abcdef"),
      "84f95379c134feaa15cd561a7f7a78b2aeb911e7c13952e739d898092e5dc8c8",
    );
    assert.equal(
      await gerarHashSenha("çãõ-ünïcødé", "ffeeddccbbaa99887766554433221100"),
      "09509bd441acff6598431f892771d0dbcc8b784ac5f0cb8682946e8b075e417f",
    );
  });

  it("verifica senha correta e recusa errada", async () => {
    const salt = "0123456789abcdef0123456789abcdef";
    const hash = "84f95379c134feaa15cd561a7f7a78b2aeb911e7c13952e739d898092e5dc8c8";
    assert.equal(await verificarSenha("senha-de-teste-123", salt, hash), true);
    assert.equal(await verificarSenha("senha-errada-000", salt, hash), false);
    assert.equal(await verificarSenha("", salt, hash), false);
  });

  it("limita tamanho contando caracteres como o Python", () => {
    assert.throws(() => validarTamanhoSenha("curta"), /ao menos 8/);
    assert.throws(() => validarTamanhoSenha("a".repeat(129)), /no maximo 128/);
    assert.equal(validarTamanhoSenha("😀".repeat(128)).length, 256);
  });
});

describe("token JWT", () => {
  it("converte expiração como o backend Python", () => {
    assert.equal(converterExpiracaoEmSegundos("12h"), 43200);
    assert.equal(converterExpiracaoEmSegundos("7d"), 604800);
    assert.equal(converterExpiracaoEmSegundos("30m"), 1800);
    assert.equal(converterExpiracaoEmSegundos("3600"), 3600);
  });

  it("emite e decodifica; token adulterado vira null", () => {
    const token = emitirToken({ tipo: "loja", lojaId: "l1" });
    assert.equal(decodificarToken(token).lojaId, "l1");
    assert.equal(decodificarToken(`${token}x`), null);
  });
});

describe("assinatura", () => {
  it("bloqueia ausente, pendente e cancelada", () => {
    assert.equal(avaliarAssinatura(null).bloqueada, true);
    assert.equal(avaliarAssinatura("pendente").rotulo, "Pendente");
    assert.equal(avaliarAssinatura("cancelada").bloqueada, true);
  });

  it("libera com aviso quando vencida ou inadimplente", () => {
    const vencida = avaliarAssinatura("ativa", "2026-01-01", { hoje: "2026-10-14" });
    assert.deepEqual([vencida.bloqueada, vencida.atrasada, vencida.statusExibicao], [false, true, "atrasada"]);
    assert.equal(avaliarAssinatura("inadimplente").atrasada, true);
    assert.equal(avaliarAssinatura("ativa", "2099-01-01").rotulo, "Ativa");
  });

  it("estende só na primeira aprovação e marca inadimplente no estorno", () => {
    assert.equal(deveEstenderAssinatura(null, "approved"), true);
    assert.equal(deveEstenderAssinatura("approved", "approved"), false);
    assert.equal(deveMarcarInadimplente("approved", "refunded"), true);
    assert.equal(deveMarcarInadimplente("pending", "refunded"), false);
  });
});

describe("CPF, diretrizes e planos", () => {
  it("valida dígitos do CPF", () => {
    assert.equal(validarCpf("529.982.247-25"), "52998224725");
    assert.throws(() => validarCpf("111.111.111-11"), /CPF valido/);
    assert.throws(() => validarCpf("529.982.247-24"), /CPF valido/);
  });

  it("exige aceite da versão vigente", () => {
    assert.throws(() => validarAceiteDiretrizes({ aceito: "true", versao: VERSAO_DIRETRIZES }), /aceite/);
    assert.throws(() => validarAceiteDiretrizes({ aceito: true, versao: "antiga" }), (erro) => erro.status === 409);
    const registro = validarAceiteDiretrizes({ aceito: true, versao: VERSAO_DIRETRIZES }, { ip: "1".repeat(80) });
    assert.equal(registro.ip.length, 64);
  });

  it("monta catálogo e recusa plano inválido", () => {
    assert.deepEqual(catalogoPlanos().map((plano) => plano.id), ["teste", "mensal", "semestral", "anual"]);
    assert.equal(obterPlano("SEMESTRAL").meses, 6);
    assert.throws(() => obterPlano("vitalicio"), /Plano invalido/);
  });
});

describe("Mercado Pago", () => {
  it("valida o x-signature do webhook com o mesmo HMAC do Python", () => {
    const assinatura = "ts=1700000000,v1=d01f558ce34318643d0e3c64b2cf6b01c7e3b1896b2fd64906ff779c10e0f41e";
    assert.doesNotThrow(() => verificarAssinaturaWebhook({ paymentId: "123456789", assinatura, requestId: "req-1" }));
    assert.throws(
      () => verificarAssinaturaWebhook({ paymentId: "123456780", assinatura, requestId: "req-1" }),
      (erro) => erro.status === 401,
    );
  });

  it("monta corpo de boleto com vencimento e documento só com dígitos", () => {
    const corpo = montarCorpoPagamento({
      lojaId: "l1",
      valor: 99.9,
      nomeLoja: "Loja",
      email: "a@b.com",
      primeiroNome: "Ana",
      sobrenome: "Silva",
      dadosFormulario: { payment_method_id: "bolbradesco", payer: { identification: { type: "CPF", number: "529.982.247-25" } } },
    });
    assert.equal(corpo.payer.identification.number, "52998224725");
    assert.ok(Date.parse(corpo.date_of_expiration) > Date.now());
  });
});

describe("documentos e permissões", () => {
  it("grava chave __proto__ como dado sem poluir o protótipo", () => {
    const documento = {};
    definirNoDocumento(documento, ["__proto__", "poluido"], true);
    assert.equal({}.poluido, undefined);
    assert.equal(Object.prototype.poluido, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(documento)), { ["__proto__"]: { poluido: true } });
  });

  it("ignora o prefixo legado lojas/{id} ao identificar o recurso", () => {
    assert.equal(recursoDoCaminho("lojas/abc/produtos/p1/estoque"), "produtos");
    assert.equal(recursoDoCaminho("/clientes/"), "clientes");
  });

  it("completa permissões com os padrões do operador", () => {
    const permissoes = normalizarPermissoes({ excluirProduto: "sim", cadastrarProduto: 0, desconhecida: true });
    assert.equal(permissoes.excluirProduto, true);
    assert.equal(permissoes.cadastrarProduto, false);
    assert.equal(permissoes.venderFiado, true);
    assert.equal("desconhecida" in permissoes, false);
  });
});
