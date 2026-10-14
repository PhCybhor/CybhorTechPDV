import { Router } from "express";
import * as admin from "../controladores/adminControlador.js";
import * as dados from "../controladores/dadosControlador.js";
import * as equipe from "../controladores/equipeControlador.js";
import * as loja from "../controladores/lojaControlador.js";
import * as pagamento from "../controladores/pagamentoControlador.js";
import * as produto from "../controladores/produtoControlador.js";
import { saude } from "../controladores/saudeControlador.js";
import * as site from "../controladores/siteControlador.js";
import * as venda from "../controladores/vendaControlador.js";
import { autenticarAdminSistema, autenticarLoja, exigirAdminLoja } from "../middlewares/autenticacao.js";
import { limites } from "../middlewares/limitadores.js";

/**
 * Rotas da API (montadas em /api). Mesmos caminhos, status e limites do backend Python.
 * @returns {import("express").Router}
 */
export function criarRotasApi() {
  const rotas = Router();
  const adminLoja = [autenticarLoja, exigirAdminLoja];

  rotas.get("/saude", saude);

  rotas.get("/site/preco", site.preco);
  rotas.post("/site/comprar", limites.vintePor15Min(), site.comprar);
  rotas.get("/site/downloads", site.downloads);
  rotas.get("/site/baixar/:arquivo", limites.trintaPorHora(), site.baixar);
  rotas.get("/site/baixar/:versao/:arquivo", limites.trintaPorHora(), site.baixarVersao);
  rotas.get("/site/pagamento", site.pagamento);
  rotas.post("/site/pagar", limites.vintePor15Min(), site.pagar);
  rotas.get("/site/ativacao", site.ativacao);

  rotas.post("/lojas", limites.vintePor15Min(), loja.criarLoja);
  rotas.post("/lojas/conectar", limites.vintePor15Min(), loja.conectar);
  rotas.post("/ativar", limites.vintePor15Min(), loja.ativarDesktop);
  rotas.get("/lojas/perfil", autenticarLoja, loja.perfil);
  rotas.get("/lojas/:lojaId/bootstrap", loja.statusBootstrap);
  rotas.post("/lojas/:lojaId/admin-inicial", limites.dezPor15Min(), loja.criarAdminInicial);

  rotas.post("/auth/login", limites.dezPor15Min(), equipe.login);
  rotas.get("/funcionarios", adminLoja, equipe.listarFuncionarios);
  rotas.post("/funcionarios", adminLoja, equipe.criarFuncionario);
  rotas.patch("/funcionarios/:funcionarioId", adminLoja, equipe.atualizarFuncionario);

  rotas.get("/produtos", autenticarLoja, produto.listar);
  rotas.post("/produtos", adminLoja, produto.criar);
  rotas.put("/produtos/:produtoId", adminLoja, produto.atualizar);
  rotas.delete("/produtos/:produtoId", adminLoja, produto.remover);

  rotas.post("/vendas", autenticarLoja, venda.registrar);
  rotas.get("/vendas", autenticarLoja, venda.listar);
  rotas.post("/caixa/venda", autenticarLoja, venda.finalizarNoCaixa);
  rotas.post("/caixa/cancelar-venda", autenticarLoja, venda.cancelarNoCaixa);

  rotas.post("/dados/lote", autenticarLoja, dados.lote);
  rotas.get("/dados/*caminho", autenticarLoja, dados.obter);
  rotas.put("/dados/*caminho", autenticarLoja, dados.definir);
  rotas.patch("/dados/*caminho", autenticarLoja, dados.mesclar);
  rotas.delete("/dados/*caminho", autenticarLoja, dados.remover);

  rotas.post("/pagamentos/checkout", adminLoja, pagamento.checkout);
  rotas.get("/pagamentos/assinatura", autenticarLoja, pagamento.assinatura);
  rotas.post("/pagamentos/webhook", limites.sessentaPorMinuto(), pagamento.webhook);

  rotas.post("/admin/bootstrap", limites.cincoPor15Min(), admin.bootstrap);
  rotas.post("/admin/login", limites.dezPor15Min(), admin.login);
  rotas.get("/admin/lojas", autenticarAdminSistema, admin.listarLojas);
  rotas.post("/admin/lojas", autenticarAdminSistema, admin.criarLoja);
  rotas.get("/admin/lojas/:lojaId", autenticarAdminSistema, admin.detalhar);
  rotas.patch("/admin/lojas/:lojaId/ativa", autenticarAdminSistema, admin.definirAtiva);
  rotas.post("/admin/lojas/:lojaId/regenerar-chave", autenticarAdminSistema, admin.regenerarChave);

  return rotas;
}
