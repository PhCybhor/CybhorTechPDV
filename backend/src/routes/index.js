"use strict";

const { Router } = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const lojaController = require("../controllers/lojaController");
const produtoController = require("../controllers/produtoController");
const vendaController = require("../controllers/vendaController");
const adminController = require("../controllers/adminController");
const pagamentoController = require("../controllers/pagamentoController");
const siteController = require("../controllers/siteController");
const {
  autenticarLoja,
  exigirAdminLoja,
  autenticarAdminSistema,
} = require("../middlewares/autenticacao");

const rotas = Router();

// Limite agressivo em rotas de credencial para frear forca bruta.
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: "Muitas tentativas. Aguarde alguns minutos." },
});

rotas.get("/saude", (req, res) => res.json({ ok: true }));

// --- Site (compra publica — gera codigo apos pagamento MP) ---
rotas.post("/site/comprar", limiteLogin, siteController.comprar);
rotas.get("/site/pagamento", siteController.pagamento);
rotas.post("/site/pagar", limiteLogin, siteController.pagar);
rotas.get("/site/ativacao", siteController.ativacao);

// --- Lojas (setup do caixa) ---
rotas.post("/lojas", limiteLogin, lojaController.criar);
rotas.post("/lojas/conectar", limiteLogin, lojaController.conectar);
rotas.get("/lojas/perfil", autenticarLoja, lojaController.perfil);

// --- Autenticacao e equipe ---
rotas.post("/auth/login", limiteLogin, authController.login);
rotas.get("/funcionarios", autenticarLoja, exigirAdminLoja, authController.listarFuncionarios);
rotas.post("/funcionarios", autenticarLoja, exigirAdminLoja, authController.criarFuncionario);

// --- Produtos ---
rotas.get("/produtos", autenticarLoja, produtoController.listar);
rotas.post("/produtos", autenticarLoja, exigirAdminLoja, produtoController.criar);
rotas.put("/produtos/:id", autenticarLoja, exigirAdminLoja, produtoController.atualizar);
rotas.delete("/produtos/:id", autenticarLoja, exigirAdminLoja, produtoController.remover);

// --- Vendas ---
rotas.post("/vendas", autenticarLoja, vendaController.registrar);
rotas.get("/vendas", autenticarLoja, vendaController.listar);

// --- Pagamentos (assinatura da loja via Mercado Pago) ---
rotas.post("/pagamentos/checkout", autenticarLoja, exigirAdminLoja, pagamentoController.criarCheckout);
rotas.get("/pagamentos/assinatura", autenticarLoja, pagamentoController.assinatura);
rotas.post("/pagamentos/webhook", pagamentoController.webhook);

// --- Painel do administrador do sistema (somente voce) ---
rotas.post("/admin/login", limiteLogin, adminController.login);
rotas.get("/admin/lojas", autenticarAdminSistema, adminController.listarLojas);
rotas.get("/admin/lojas/:id", autenticarAdminSistema, adminController.detalharLoja);
rotas.patch("/admin/lojas/:id/ativa", autenticarAdminSistema, adminController.definirAtiva);

module.exports = rotas;
