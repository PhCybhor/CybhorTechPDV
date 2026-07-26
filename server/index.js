"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { criarLicencaService } = require("./licencas");
const { enviarChavePorEmail } = require("./email");

const PORTA = Number(process.env.PORT || 8787);
const BASE_URL = (process.env.CYBHOR_PUBLIC_URL || `http://localhost:${PORTA}`).replace(
  /\/+$/,
  ""
);
const PRECO = Number(process.env.CYBHOR_PRECO || 297);
const TITULO = process.env.CYBHOR_PRODUTO_NOME || "CybhorPDV — Licença vitalícia";

function iniciarFirebase() {
  if (admin.apps.length) return admin.database();

  const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const arquivo = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL é obrigatório no servidor.");
  }

  let credential;
  if (jsonInline) {
    credential = admin.credential.cert(JSON.parse(jsonInline));
  } else if (arquivo) {
    // eslint-disable-next-line import/no-dynamic-require
    credential = admin.credential.cert(require(path.resolve(arquivo)));
  } else {
    console.warn(
      "[cybhor] Sem service account: usando modo arquivo local (pedidos.json). Configure FIREBASE_SERVICE_ACCOUNT_* para produção."
    );
    return null;
  }

  admin.initializeApp({ credential, databaseURL });
  return admin.database();
}

/** Fallback em memória/arquivo se Firebase Admin não estiver configurado. */
function criarStoreLocal() {
  const fs = require("fs");
  const arquivo = path.join(__dirname, "data", "licencas-local.json");
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });

  function ler() {
    if (!fs.existsSync(arquivo)) return { licencas: {}, lojas: {} };
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  }

  function salvar(dados) {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), "utf8");
  }

  return {
    async emitirLicenca(dados) {
      const crypto = require("crypto");
      const { v4: uuidv4 } = require("uuid");
      const chave = `CYB-${crypto.randomBytes(6).toString("hex").toUpperCase().match(/.{1,4}/g).join("-")}`;
      const lojaId = uuidv4();
      const hash = crypto.createHash("sha256").update(chave).digest("hex");
      const store = ler();
      const registro = {
        lojaId,
        email: dados.email,
        nomeLoja: dados.nomeLoja,
        status: "ativa",
        pagamentoId: dados.pagamentoId || "",
        valor: dados.valor || 0,
        criadoEm: Date.now(),
        chavePlana: chave,
      };
      store.licencas[hash] = registro;
      store.lojas[lojaId] = {
        nome: dados.nomeLoja,
        email: dados.email,
        status: "ativa",
        criadaEm: Date.now(),
      };
      salvar(store);
      return { chave, ...registro };
    },
    async ativarPorChave(chave) {
      const crypto = require("crypto");
      const limpa = String(chave || "").trim().toUpperCase().replace(/\s+/g, "");
      const hash = crypto.createHash("sha256").update(limpa).digest("hex");
      const store = ler();
      const dados = store.licencas[hash];
      if (!dados || dados.status !== "ativa") {
        return { ok: false, mensagem: "Licença não encontrada." };
      }
      return {
        ok: true,
        lojaId: dados.lojaId,
        email: dados.email || "",
        nomeLoja: dados.nomeLoja || "",
      };
    },
    async buscarPorPagamento(pagamentoId) {
      const store = ler();
      const hit = Object.values(store.licencas).find(
        (l) => l.pagamentoId === String(pagamentoId)
      );
      return hit || null;
    },
  };
}

const db = (() => {
  try {
    return iniciarFirebase();
  } catch (erro) {
    console.error(erro.message);
    return null;
  }
})();

const licencas = db ? criarLicencaService(db) : criarStoreLocal();

const mpToken = process.env.MP_ACCESS_TOKEN || "";
const mpClient = mpToken
  ? new MercadoPagoConfig({ accessToken: mpToken })
  : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "landing")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    produto: "CybhorPDV",
    preco: PRECO,
    mercadoPago: Boolean(mpClient),
    firebase: Boolean(db),
  });
});

app.get("/api/preco", (_req, res) => {
  res.json({
    ok: true,
    preco: PRECO,
    moeda: "BRL",
    titulo: TITULO,
  });
});

/**
 * Cria preferência de pagamento no Mercado Pago.
 */
app.post("/api/checkout", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const nomeLoja = String(req.body?.nomeLoja || "").trim();

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, mensagem: "Informe um e-mail válido." });
    }
    if (nomeLoja.length < 2) {
      return res.status(400).json({ ok: false, mensagem: "Informe o nome da loja." });
    }
    if (!mpClient) {
      return res.status(503).json({
        ok: false,
        mensagem: "Mercado Pago não configurado (MP_ACCESS_TOKEN).",
      });
    }

    const externalReference = `cybhor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const preference = new Preference(mpClient);
    const criada = await preference.create({
      body: {
        items: [
          {
            id: "cybhor-pdv-licenca",
            title: TITULO,
            description: `Licença CybhorPDV para ${nomeLoja}`,
            quantity: 1,
            currency_id: "BRL",
            unit_price: PRECO,
          },
        ],
        payer: { email },
        external_reference: externalReference,
        metadata: { email, nomeLoja },
        back_urls: {
          success: `${BASE_URL}/sucesso.html`,
          failure: `${BASE_URL}/falha.html`,
          pending: `${BASE_URL}/pendente.html`,
        },
        auto_return: "approved",
        notification_url: `${BASE_URL}/api/webhook/mercadopago`,
      },
    });

    if (db) {
      await db.ref(`pedidos/${externalReference}`).set({
        email,
        nomeLoja,
        preco: PRECO,
        status: "pendente",
        preferenceId: criada.id,
        criadoEm: Date.now(),
      });
    }

    return res.json({
      ok: true,
      preferenceId: criada.id,
      initPoint: criada.init_point,
      sandboxInitPoint: criada.sandbox_init_point,
    });
  } catch (erro) {
    console.error("checkout:", erro);
    return res.status(500).json({
      ok: false,
      mensagem: erro?.message || "Falha ao criar pagamento.",
    });
  }
});

/**
 * Webhook Mercado Pago — emite licença quando pagamento aprovado.
 */
app.post("/api/webhook/mercadopago", async (req, res) => {
  try {
    const tipo = req.query.type || req.body?.type || req.body?.topic;
    const id =
      req.query["data.id"] ||
      req.body?.data?.id ||
      req.query.id ||
      req.body?.id;

    if (!mpClient || !id || (tipo && !String(tipo).includes("payment"))) {
      return res.sendStatus(200);
    }

    const paymentApi = new Payment(mpClient);
    const pagamento = await paymentApi.get({ id: String(id) });
    if (!pagamento || pagamento.status !== "approved") {
      return res.sendStatus(200);
    }

    const existente = await licencas.buscarPorPagamento(String(pagamento.id));
    if (existente) {
      return res.sendStatus(200);
    }

    const email =
      pagamento.metadata?.email ||
      pagamento.payer?.email ||
      "cliente@email.com";
    const nomeLoja =
      pagamento.metadata?.nomeLoja ||
      pagamento.external_reference ||
      "Minha Loja";

    const emitida = await licencas.emitirLicenca({
      email,
      nomeLoja,
      pagamentoId: String(pagamento.id),
      valor: Number(pagamento.transaction_amount) || PRECO,
    });

    if (db && pagamento.external_reference) {
      await db.ref(`pedidos/${pagamento.external_reference}`).update({
        status: "pago",
        pagamentoId: String(pagamento.id),
        lojaId: emitida.lojaId,
        licencaHash: require("crypto")
          .createHash("sha256")
          .update(emitida.chave)
          .digest("hex"),
        pagoEm: Date.now(),
      });
      // Guarda chave só temporariamente para a página de sucesso (TTL via campo)
      await db.ref(`pedidos/${pagamento.external_reference}/chaveEntrega`).set({
        chave: emitida.chave,
        expiraEm: Date.now() + 48 * 60 * 60 * 1000,
      });
    }

    console.log("[cybhor] Licença emitida para", email, emitida.lojaId);
    await enviarChavePorEmail({
      para: email,
      nomeLoja,
      chave: emitida.chave,
      pagamentoId: String(pagamento.id),
    });
    return res.sendStatus(200);
  } catch (erro) {
    console.error("webhook:", erro);
    return res.sendStatus(200);
  }
});

/**
 * Reentrega da chave pelo ID do pagamento (página de sucesso / suporte).
 */
app.post("/api/reentrega", async (req, res) => {
  try {
    const pagamentoId = String(req.body?.payment_id || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!pagamentoId) {
      return res.status(400).json({ ok: false, mensagem: "Informe o payment_id." });
    }

    const licenca = await licencas.buscarPorPagamento(pagamentoId);
    if (!licenca) {
      return res.status(404).json({
        ok: false,
        mensagem: "Pagamento ainda sem licença. Aguarde ou contate o suporte.",
      });
    }

    if (email && licenca.email && email !== String(licenca.email).toLowerCase()) {
      return res.status(403).json({
        ok: false,
        mensagem: "E-mail não confere com o da compra.",
      });
    }

    let chave = licenca.chavePlana || null;
    if (!chave && db) {
      const pedidos = await db
        .ref("pedidos")
        .orderByChild("pagamentoId")
        .equalTo(pagamentoId)
        .limitToFirst(1)
        .get();
      if (pedidos.exists()) {
        const pedido = Object.values(pedidos.val())[0];
        chave = pedido?.chaveEntrega?.chave || null;
      }
    }

    if (!chave) {
      return res.json({
        ok: false,
        mensagem:
          "Licença existe, mas a chave de entrega expirou. Contate o suporte com o ID do pagamento.",
      });
    }

    if (email || licenca.email) {
      await enviarChavePorEmail({
        para: email || licenca.email,
        nomeLoja: licenca.nomeLoja,
        chave,
        pagamentoId,
      });
    }

    return res.json({
      ok: true,
      chave,
      lojaId: licenca.lojaId,
      nomeLoja: licenca.nomeLoja,
    });
  } catch (erro) {
    return res.status(500).json({
      ok: false,
      mensagem: erro?.message || "Falha na reentrega.",
    });
  }
});

/**
 * Desktop: valida chave e devolve lojaId isolado.
 */
app.post("/api/ativar", async (req, res) => {
  try {
    const resultado = await licencas.ativarPorChave(req.body?.chave);
    if (!resultado.ok) {
      return res.status(400).json(resultado);
    }
    return res.json(resultado);
  } catch (erro) {
    return res.status(500).json({
      ok: false,
      mensagem: erro?.message || "Falha ao ativar.",
    });
  }
});

/**
 * Página de sucesso consulta a chave pelo payment_id.
 */
app.get("/api/entrega", async (req, res) => {
  try {
    const pagamentoId = String(req.query.payment_id || "").trim();
    if (!pagamentoId) {
      return res.status(400).json({ ok: false, mensagem: "payment_id ausente." });
    }

    const licenca = await licencas.buscarPorPagamento(pagamentoId);
    if (!licenca) {
      return res.json({
        ok: false,
        pendente: true,
        mensagem: "Pagamento confirmado. Gerando sua chave… aguarde alguns segundos.",
      });
    }

    // Em store local a chave plana fica salva; no Firebase só o hash.
    // Tenta ler chaveEntrega do pedido.
    let chave = licenca.chavePlana || null;
    if (!chave && db) {
      const pedidos = await db
        .ref("pedidos")
        .orderByChild("pagamentoId")
        .equalTo(pagamentoId)
        .limitToFirst(1)
        .get();
      if (pedidos.exists()) {
        const pedido = Object.values(pedidos.val())[0];
        if (
          pedido?.chaveEntrega?.chave &&
          Number(pedido.chaveEntrega.expiraEm) > Date.now()
        ) {
          chave = pedido.chaveEntrega.chave;
        }
      }
    }

    return res.json({
      ok: true,
      chave: chave || null,
      lojaId: licenca.lojaId,
      email: licenca.email,
      nomeLoja: licenca.nomeLoja,
      mensagem: chave
        ? "Guarde esta chave. Ela ativa o CybhorPDV nesta loja."
        : "Licença ativa. Se a chave não aparecer, use o e-mail de suporte com o ID do pagamento.",
    });
  } catch (erro) {
    return res.status(500).json({
      ok: false,
      mensagem: erro?.message || "Falha ao buscar entrega.",
    });
  }
});

/** Dev: emite licença sem pagar (somente se CYBHOR_MODO_DEV=1). */
app.post("/api/dev/emitir", async (req, res) => {
  if (process.env.CYBHOR_MODO_DEV !== "1") {
    return res.status(403).json({ ok: false, mensagem: "Desabilitado." });
  }
  const emitida = await licencas.emitirLicenca({
    email: req.body?.email || "dev@cybhor.local",
    nomeLoja: req.body?.nomeLoja || "Loja Dev",
    pagamentoId: `dev_${Date.now()}`,
    valor: 0,
  });
  return res.json({ ok: true, ...emitida });
});

/**
 * Assistente Gemini (Google AI Studio) — chave só no servidor.
 * O app desktop prefere IPC no Electron; esta rota serve landing/API.
 */
app.post("/api/assistente", async (req, res) => {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      mensagem: "Configure GEMINI_API_KEY no .env.",
    });
  }

  const modo = String(req.body?.modo || "livre").trim();
  const mensagem = String(req.body?.mensagem || "").trim();
  if (mensagem.length < 3) {
    return res.status(400).json({
      ok: false,
      mensagem: "Informe uma pergunta.",
    });
  }

  const sistemas = {
    criativos:
      "Você é copywriter de varejo BR. Entregue 3 opções curtas com gancho, corpo e CTA.",
    organizacao:
      "Você é especialista em merchandising de loja física. Sugira layout e fluxo.",
    pesquisa_area:
      "Você é consultor de mercado local no Brasil. Ajude a pesquisar bairro e concorrentes.",
    precificacao:
      "Você é consultor de precificação no varejo. Fale de margem e markup em R$.",
    compras:
      "Você analisa giro e sugere o que comprar, pausar ou liquidar.",
    promocoes:
      "Você cria combos e promoções sem matar a margem.",
    concorrencia:
      "Você faz copy thief ético: adapta ideias de concorrentes sem copiar marca/texto.",
    folha:
      "Você orienta pagamento CLT vs PJ/MEI no Brasil (2026), encargos e risco de pejotização. Não substitui contador.",
    caixa:
      "Você treina operadores de caixa: atendimento, troco, upsell e rotina de PDV.",
    rh:
      "Você orienta RH de pequeno varejo: admissão, escala, clima e vínculos. Não substitui advogado.",
    marketing:
      "Você cria marketing local para mercearia/PDV: campanhas, vitrine e redes com margem em mente.",
    nomes_produtos:
      'Você corrige nomes de produtos de varejo BR. Responda APENAS com JSON array: [{"id":"...","nomeAtual":"...","nomeSugerido":"...","motivo":"..."}]. Só itens que precisam correção; se nenhum, []. Sem markdown.',
    livre:
      "Você é o assistente CybhorIA do lojista. Respostas práticas em tópicos.",
  };

  const system = sistemas[modo] || sistemas.livre;
  const modelo =
    String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim() ||
    "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelo
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${system}\n\nPedido:\n${mensagem}` }],
          },
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      return res.status(502).json({
        ok: false,
        mensagem: corpo?.error?.message || "Falha na API Gemini.",
      });
    }
    const texto = (corpo?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!texto) {
      return res.status(502).json({
        ok: false,
        mensagem: "A IA não retornou texto.",
      });
    }
    return res.json({ ok: true, texto });
  } catch (erro) {
    return res.status(500).json({
      ok: false,
      mensagem: erro?.message || "Falha ao consultar a IA.",
    });
  }
});

app.listen(PORTA, () => {
  console.log(`Cybhor vendas em ${BASE_URL}`);
  console.log(`Landing: ${BASE_URL}/`);
  console.log(`API health: ${BASE_URL}/api/health`);
});
