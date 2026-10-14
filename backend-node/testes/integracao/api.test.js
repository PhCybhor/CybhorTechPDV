/**
 * Fluxos completos da API contra um MySQL/MariaDB real.
 * Requer DATABASE_URL apontando para um banco cujo nome termina em "_teste"
 * (as tabelas são esvaziadas no início). Sem ele, a suíte é pulada.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const BANCO_DE_TESTE = /\/[^/?]+_teste(\?|$)/.test(process.env.DATABASE_URL || "");

process.env.NODE_ENV = "test";
process.env.JWT_SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
process.env.MP_ACCESS_TOKEN = "";
process.env.MP_WEBHOOK_SECRET = "";
process.env.CORS_ORIGENS = "";

const TABELAS = [
  "venda_itens",
  "vendas",
  "pagamentos",
  "aceites_diretrizes",
  "trials_cpf",
  "documentos_loja",
  "assinaturas",
  "produtos",
  "funcionarios",
  "lojas",
  "administradores_sistema",
];

describe("API Node + MySQL", { skip: !BANCO_DE_TESTE && "DATABASE_URL de teste ausente" }, () => {
  let servidor;
  let baseUrl;
  let db;
  let pagamentoServico;
  const estado = {};

  async function chamar(metodo, caminho, { token, corpo, cabecalhos = {}, corpoBruto } = {}) {
    const headers = { ...cabecalhos };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body = corpoBruto;
    if (corpo !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(corpo);
    }
    const resposta = await fetch(`${baseUrl}${caminho}`, { method: metodo, headers, body });
    const texto = await resposta.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: resposta.status, json, headers: resposta.headers };
  }

  before(async () => {
    db = await import("../../src/db.js");
    pagamentoServico = await import("../../src/servicos/pagamentoServico.js");
    const { criarApp } = await import("../../src/app.js");
    await db.executar("SET FOREIGN_KEY_CHECKS = 0");
    for (const tabela of TABELAS) await db.executar(`DELETE FROM ${tabela}`);
    await db.executar("SET FOREIGN_KEY_CHECKS = 1");
    await new Promise((resolver) => {
      servidor = criarApp().listen(0, "127.0.0.1", resolver);
    });
    baseUrl = `http://127.0.0.1:${servidor.address().port}/api`;
  });

  after(async () => {
    await new Promise((resolver) => servidor.close(resolver));
    await db.fecharPool();
  });

  it("saúde, cabeçalhos de segurança, 404 e limites de corpo", async () => {
    const saude = await chamar("GET", "/saude");
    assert.equal(saude.status, 200);
    assert.deepEqual(saude.json, { ok: true, db: true });
    assert.equal(saude.headers.get("x-frame-options"), "DENY");
    assert.match(saude.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(saude.headers.get("x-powered-by"), null);

    assert.deepEqual((await chamar("GET", "/nao-existe")).json, { erro: "Not Found" });
    const grande = await chamar("POST", "/auth/login", {
      corpoBruto: JSON.stringify({ x: "a".repeat(600 * 1024) }),
      cabecalhos: { "Content-Type": "application/json" },
    });
    assert.equal(grande.status, 413);
    const invalido = await chamar("POST", "/auth/login", {
      corpoBruto: "{nao-e-json",
      cabecalhos: { "Content-Type": "application/json" },
    });
    assert.deepEqual([invalido.status, invalido.json], [422, { erro: "Dados invalidos." }]);
  });

  it("admin do sistema: bootstrap, bloqueio do segundo e login", async () => {
    const corpo = { nome: "Dono", email: "Dono@Cybhor.Tech", senha: "senha-forte-123" };
    const criado = await chamar("POST", "/admin/bootstrap", { corpo });
    assert.deepEqual([criado.status, criado.json], [201, { email: "dono@cybhor.tech" }]);
    assert.equal((await chamar("POST", "/admin/bootstrap", { corpo })).status, 409);

    assert.equal((await chamar("POST", "/admin/login", { corpo: { email: "dono@cybhor.tech", senha: "errada-123" } })).status, 401);
    const login = await chamar("POST", "/admin/login", { corpo: { email: "dono@cybhor.tech", senha: "senha-forte-123" } });
    assert.equal(login.status, 200);
    estado.tokenAdminSistema = login.json.token;
  });

  it("cria loja, conecta pelo código e faz login no PDV", async () => {
    const criada = await chamar("POST", "/lojas", {
      corpo: {
        loja: { nome: "Mercado Teste", email: "loja@teste.com" },
        admin: { nome: "Ana", sobrenome: "Silva", usuario: "Ana", senha: "senha-admin-123" },
      },
    });
    assert.equal(criada.status, 201);
    assert.match(criada.json.codigo, /^[23456789A-HJKMNP-Z]{6}$/);
    estado.lojaId = criada.json.lojaId;
    estado.codigo = criada.json.codigo;

    const conectada = await chamar("POST", "/lojas/conectar", { corpo: { codigo: estado.codigo.toLowerCase() } });
    assert.deepEqual(conectada.json, { lojaId: estado.lojaId, nome: "Mercado Teste" });
    assert.equal((await chamar("POST", "/ativar", { corpo: { chave: estado.codigo } })).json.ok, true);

    assert.equal(
      (await chamar("POST", "/auth/login", { corpo: { codigoLoja: estado.codigo, usuario: "ana", senha: "errada-000" } })).status,
      401,
    );
    const login = await chamar("POST", "/auth/login", {
      corpo: { codigoLoja: estado.codigo, usuario: "ANA", senha: "senha-admin-123" },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.funcionario.cargo, "admin");
    assert.equal(login.json.assinatura.rotulo, "Ativa");
    estado.tokenAdmin = login.json.token;

    const perfil = await chamar("GET", "/lojas/perfil", { token: estado.tokenAdmin });
    assert.equal(perfil.json.assinaturaBloqueada, false);
    assert.match(perfil.json.validaAte, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await chamar("GET", "/lojas/perfil")).status, 401);
  });

  it("CRUD de produtos com validação e 404", async () => {
    const corpo = { nome: "Arroz 5kg", preco: "27.90", estoque: 10, codigoBarras: "789", categoria: "Mercearia" };
    const criado = await chamar("POST", "/produtos", { token: estado.tokenAdmin, corpo });
    assert.equal(criado.status, 201);
    estado.produtoId = criado.json.id;

    assert.equal((await chamar("PUT", `/produtos/${estado.produtoId}`, { token: estado.tokenAdmin, corpo })).status, 204);
    assert.equal((await chamar("PUT", `/produtos/${estado.produtoId}`, { token: estado.tokenAdmin, corpo })).status, 204);
    assert.equal((await chamar("PUT", "/produtos/inexistente", { token: estado.tokenAdmin, corpo })).status, 404);
    const invalido = await chamar("POST", "/produtos", { token: estado.tokenAdmin, corpo: { ...corpo, preco: "abc" } });
    assert.deepEqual([invalido.status, invalido.json], [400, { erro: "Preco invalido." }]);
    const longo = await chamar("POST", "/produtos", { token: estado.tokenAdmin, corpo: { ...corpo, nome: "x".repeat(300) } });
    assert.equal(longo.status, 400);

    const lista = await chamar("GET", "/produtos", { token: estado.tokenAdmin });
    assert.equal(lista.json.length, 1);
    assert.equal(lista.json[0].preco, 27.9);
  });

  it("venda online baixa estoque e lista com itens", async () => {
    const venda = await chamar("POST", "/vendas", {
      token: estado.tokenAdmin,
      corpo: { itens: [{ produtoId: estado.produtoId, quantidade: 3 }], formaPagamento: "PIX", desconto: 1.7 },
    });
    assert.equal(venda.status, 201);
    assert.equal(venda.json.total, 27.9 * 3 - 1.7);

    const semEstoque = await chamar("POST", "/vendas", {
      token: estado.tokenAdmin,
      corpo: { itens: [{ produtoId: estado.produtoId, quantidade: 50 }], formaPagamento: "pix" },
    });
    assert.deepEqual([semEstoque.status, semEstoque.json.erro], [400, 'Estoque insuficiente para "Arroz 5kg".']);

    const vendas = await chamar("GET", "/vendas?limite=5", { token: estado.tokenAdmin });
    assert.equal(vendas.json.length, 1);
    assert.equal(vendas.json[0].itens[0].quantidade, 3);
    assert.equal((await chamar("GET", "/vendas?limite=abc", { token: estado.tokenAdmin })).status, 422);
    const [produto] = (await chamar("GET", "/produtos", { token: estado.tokenAdmin })).json;
    assert.equal(produto.estoque, 7);
  });

  it("equipe: operador com permissões finas", async () => {
    const criado = await chamar("POST", "/funcionarios", {
      token: estado.tokenAdmin,
      corpo: { nome: "Bruno", usuario: "bruno", senha: "senha-oper-123", cargo: "operador", areas: ["caixa"] },
    });
    assert.equal(criado.status, 201);
    estado.operadorId = criado.json.id;
    const duplicado = await chamar("POST", "/funcionarios", {
      token: estado.tokenAdmin,
      corpo: { nome: "Bruno", usuario: "bruno", senha: "senha-oper-123", cargo: "operador" },
    });
    assert.equal(duplicado.status, 400);

    const patch = await chamar("PATCH", `/funcionarios/${estado.operadorId}`, {
      token: estado.tokenAdmin,
      corpo: { permissoes: { aplicarDesconto: false }, tipoVinculo: "clt" },
    });
    assert.equal(patch.status, 204);
    const equipe = await chamar("GET", "/funcionarios", { token: estado.tokenAdmin });
    const operador = equipe.json.find((funcionario) => funcionario.usuario === "bruno");
    assert.deepEqual([operador.tipoVinculo, operador.areas, operador.permissoes.aplicarDesconto], ["clt", ["caixa"], false]);

    const login = await chamar("POST", "/auth/login", { corpo: { lojaId: estado.lojaId, usuario: "bruno", senha: "senha-oper-123" } });
    estado.tokenOperador = login.json.token;
    assert.equal((await chamar("GET", "/funcionarios", { token: estado.tokenOperador })).status, 403);
    const comDesconto = await chamar("POST", "/vendas", {
      token: estado.tokenOperador,
      corpo: { itens: [{ produtoId: estado.produtoId, quantidade: 1 }], formaPagamento: "pix", desconto: 1 },
    });
    assert.deepEqual([comDesconto.status, comDesconto.json.erro], [403, "Sem permissao para aplicar desconto."]);

    const promover = await chamar("PATCH", `/funcionarios/${login.json.funcionario.id}`, {
      token: estado.tokenAdmin,
      corpo: { cargo: "admin" },
    });
    assert.equal(promover.status, 204);
    const [ana] = (await chamar("GET", "/funcionarios", { token: estado.tokenAdmin })).json.filter((f) => f.usuario === "ana");
    await chamar("PATCH", `/funcionarios/${estado.operadorId}`, { token: estado.tokenAdmin, corpo: { cargo: "operador" } });
    const unico = await chamar("PATCH", `/funcionarios/${ana.id}`, { token: estado.tokenAdmin, corpo: { cargo: "operador" } });
    assert.equal(unico.json.erro, "Nao e possivel rebaixar o unico administrador do sistema.");
  });

  it("caixa: venda idempotente por idLocal e cancelamento com devolução de estoque", async () => {
    await chamar("PUT", "/dados/produtos/p1", {
      token: estado.tokenAdmin,
      corpo: { valor: { nome: "Café", preco: 12.5, estoque: 5 } },
    });
    const idLocal = "a".repeat(32);
    const corpoVenda = {
      idLocal,
      itens: [{ produtoId: "p1", quantidade: 2 }],
      formasPagamento: [
        { tipo: "pix", valor: 10 },
        { tipo: "dinheiro", valor: 15 },
      ],
    };
    const venda = await chamar("POST", "/caixa/venda", { token: estado.tokenOperador, corpo: corpoVenda });
    assert.equal(venda.status, 201);
    assert.deepEqual([venda.json.id, venda.json.formaPagamento, venda.json.total], [idLocal, "misto", 25]);
    const reenvio = await chamar("POST", "/caixa/venda", { token: estado.tokenOperador, corpo: corpoVenda });
    assert.equal(reenvio.json.id, idLocal);
    assert.equal((await chamar("GET", "/dados/produtos/p1/estoque", { token: estado.tokenAdmin })).json.valor, 3);

    const negado = await chamar("POST", "/caixa/cancelar-venda", { token: estado.tokenOperador, corpo: { vendaId: idLocal } });
    assert.equal(negado.status, 403);
    const cancelada = await chamar("POST", "/caixa/cancelar-venda", {
      token: estado.tokenAdmin,
      corpo: { vendaId: idLocal, motivo: " erro " },
    });
    assert.deepEqual([cancelada.json.cancelada, cancelada.json.motivoCancelamento], [true, "erro"]);
    assert.equal((await chamar("GET", "/dados/produtos/p1/estoque", { token: estado.tokenAdmin })).json.valor, 5);
    assert.equal((await chamar("POST", "/caixa/cancelar-venda", { token: estado.tokenAdmin, corpo: { vendaId: idLocal } })).status, 400);
  });

  it("dados: merge, remoção, lote, isolamento entre lojas e gates do operador", async () => {
    const token = estado.tokenAdmin;
    assert.equal((await chamar("PATCH", "/dados/clientes/c1", { token, corpo: { patch: { nome: "Zé", fone: "1" } } })).status, 204);
    await chamar("PATCH", "/dados/clientes/c1", { token, corpo: { patch: { fone: null } } });
    assert.deepEqual((await chamar("GET", "/dados/clientes/c1", { token })).json, { valor: { nome: "Zé" } });

    await chamar("POST", "/dados/lote", { token, corpo: { atualizacoes: { "despesas/d1": { valor: 5 }, "despesas/undefined": { valor: 7 } } } });
    const despesas = (await chamar("GET", "/dados/despesas", { token })).json.valor;
    assert.equal(Object.keys(despesas).length, 2);

    assert.equal((await chamar("DELETE", "/dados/despesas/d1", { token })).status, 204);
    assert.equal((await chamar("GET", "/dados/despesas/d1", { token })).json.valor, null);
    assert.equal((await chamar("GET", "/dados/lojas/outra-loja/clientes", { token })).status, 403);
    assert.equal((await chamar("GET", `/dados/lojas/${estado.lojaId}/clientes/c1/nome`, { token })).json.valor, "Zé");
    assert.equal((await chamar("PUT", "/dados/clientes", { token, corpo: [] })).status, 422);

    const operador = estado.tokenOperador;
    assert.equal((await chamar("PUT", "/dados/configuracoes", { token: operador, corpo: { valor: 1 } })).status, 403);
    assert.equal((await chamar("PATCH", "/dados/clientes/c2", { token: operador, corpo: { patch: { nome: "x" } } })).status, 403);
    assert.equal((await chamar("PUT", "/dados/produtos/p1/estoque", { token: operador, corpo: { valor: 9 } })).status, 204);
    assert.equal((await chamar("DELETE", "/dados/produtos/p1", { token: operador })).json.erro, "Sem permissao para excluir produtos.");
  });

  it("painel do sistema: métricas, detalhe, desativar loja e nova chave", async () => {
    const token = estado.tokenAdminSistema;
    const lojas = await chamar("GET", "/admin/lojas", { token });
    const loja = lojas.json.find((item) => item.id === estado.lojaId);
    assert.deepEqual([loja.totalProdutos, loja.totalVendas, loja.totalFuncionarios, loja.ativa], [1, 1, 2, true]);
    assert.ok(loja.usoBytes > 0);

    const detalhe = await chamar("GET", `/admin/lojas/${estado.lojaId}`, { token });
    assert.equal(detalhe.json.vendasPorDia.length, 1);
    assert.match(detalhe.json.vendasPorDia[0].dia, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal((await chamar("GET", "/admin/lojas", { token: estado.tokenAdmin })).status, 401);

    assert.equal((await chamar("PATCH", `/admin/lojas/${estado.lojaId}/ativa`, { token, corpo: {} })).status, 400);
    assert.equal((await chamar("PATCH", `/admin/lojas/${estado.lojaId}/ativa`, { token, corpo: { ativa: false } })).status, 204);
    const bloqueada = await chamar("GET", "/produtos", { token: estado.tokenAdmin });
    assert.deepEqual([bloqueada.status, bloqueada.json.erro], [403, "Loja desativada."]);
    await chamar("PATCH", `/admin/lojas/${estado.lojaId}/ativa`, { token, corpo: { ativa: true } });

    const nova = await chamar("POST", `/admin/lojas/${estado.lojaId}/regenerar-chave`, { token });
    assert.notEqual(nova.json.codigo, estado.codigo);
    assert.equal((await chamar("POST", "/lojas/conectar", { corpo: { codigo: estado.codigo } })).status, 404);
  });

  it("site: teste grátis por CPF, ativação e plano pago sem Mercado Pago", async () => {
    const aceite = { aceito: true, versao: "2026-10-13" };
    const corpo = {
      plano: "teste",
      aceiteDiretrizes: aceite,
      loja: { nome: "Loja Site", email: "site@teste.com", cpf: "529.982.247-25" },
      admin: { nome: "Carla", sobrenome: "Souza", usuario: "carla", senha: "senha-site-123" },
    };
    assert.equal((await chamar("POST", "/site/comprar", { corpo: { ...corpo, aceiteDiretrizes: undefined } })).status, 400);
    const compra = await chamar("POST", "/site/comprar", { corpo, cabecalhos: { "User-Agent": "teste-integracao" } });
    assert.equal(compra.status, 201);
    assert.equal(compra.json.trial, true);
    assert.match(compra.json.redirectUrl, /^\/sucesso\.html\?token=[0-9a-f]{64}&trial=1$/);

    const repetida = await chamar("POST", "/site/comprar", { corpo: { ...corpo, admin: { ...corpo.admin, usuario: "carla2" } } });
    assert.equal(repetida.status, 409);

    const ativacao = await chamar("GET", `/site/ativacao?token=${compra.json.tokenAtivacao}`);
    assert.deepEqual([ativacao.json.status, ativacao.json.usuario], ["ativa", "carla"]);
    assert.equal((await chamar("GET", "/site/ativacao")).status, 422);

    const [aceiteGravado] = await db.consultar("SELECT versao, navegador FROM aceites_diretrizes");
    assert.deepEqual(aceiteGravado, { versao: "2026-10-13", navegador: "teste-integracao" });

    const paga = await chamar("POST", "/site/comprar", {
      corpo: { ...corpo, plano: "mensal", loja: { ...corpo.loja, cpf: "111.444.777-35" } },
    });
    assert.deepEqual([paga.status, paga.json.erro], [503, "Pagamentos indisponiveis no momento."]);
    assert.equal((await chamar("GET", "/site/preco")).json.planos.length, 4);
  });

  it("pagamento: webhook concorrente estende a assinatura uma única vez", async () => {
    const pendente = await chamar("POST", "/lojas", {
      corpo: {
        aguardarPagamento: true,
        loja: { nome: "Loja Pendente", email: "pendente@teste.com" },
        admin: { nome: "Davi", sobrenome: "Lima", usuario: "davi", senha: "senha-davi-123" },
      },
    });
    const { lojaId } = pendente.json;
    const login = await chamar("POST", "/auth/login", { corpo: { lojaId, usuario: "davi", senha: "senha-davi-123" } });
    assert.equal(login.status, 403);

    const aprovado = { id: 987654321, status: "approved", transaction_amount: 99.9 };
    await Promise.all([
      pagamentoServico.registrarPagamento(lojaId, aprovado),
      pagamentoServico.registrarPagamento(lojaId, aprovado),
      pagamentoServico.registrarPagamento(lojaId, aprovado),
    ]);
    const [assinatura] = await db.consultar(
      "SELECT status, valida_ate, DATE_ADD(CURRENT_DATE, INTERVAL 1 MONTH) AS esperado FROM assinaturas WHERE loja_id = ?",
      [lojaId],
    );
    assert.deepEqual([assinatura.status, assinatura.valida_ate], ["ativa", assinatura.esperado]);
    assert.equal((await chamar("POST", "/auth/login", { corpo: { lojaId, usuario: "davi", senha: "senha-davi-123" } })).status, 200);

    await pagamentoServico.registrarPagamento(lojaId, { ...aprovado, status: "refunded" });
    const [estornada] = await db.consultar("SELECT status FROM assinaturas WHERE loja_id = ?", [lojaId]);
    assert.equal(estornada.status, "inadimplente");

    assert.deepEqual((await chamar("POST", "/pagamentos/webhook?topic=merchant_order&id=1")).json, { ok: true });
    assert.equal((await chamar("POST", "/pagamentos/webhook", { corpo: { type: "payment", data: { id: "abc" } } })).status, 400);
  });

  it("admin inicial da loja DEV-LOCAL só uma vez", async () => {
    const dev = await chamar("POST", "/ativar", { corpo: { chave: "dev-local" } });
    assert.equal(dev.json.nomeLoja, "Loja desenvolvimento");
    assert.deepEqual((await chamar("GET", `/lojas/${dev.json.lojaId}/bootstrap`)).json, { temAdmin: false });

    const corpo = { chaveAtivacao: "DEV-LOCAL", nome: "Dev", usuario: "dev", senha: "senha-dev-123" };
    assert.equal((await chamar("POST", `/lojas/${dev.json.lojaId}/admin-inicial`, { corpo: { ...corpo, chaveAtivacao: "ERRADA1" } })).status, 403);
    assert.equal((await chamar("POST", `/lojas/${dev.json.lojaId}/admin-inicial`, { corpo })).status, 201);
    assert.equal((await chamar("POST", `/lojas/${dev.json.lojaId}/admin-inicial`, { corpo })).status, 409);
  });
});
