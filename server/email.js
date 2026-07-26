"use strict";

/**
 * Envio opcional da chave por e-mail (SMTP).
 * Se SMTP_* não estiver configurado, apenas registra no log.
 */

async function enviarChavePorEmail({ para, nomeLoja, chave, pagamentoId }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !user || !pass || !para) {
    console.log(
      `[email] (não enviado — configure SMTP_*) chave para ${para}: ${chave}`
    );
    return { ok: false, motivo: "smtp_ausente" };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    console.warn("[email] Instale nodemailer no server: npm install nodemailer");
    return { ok: false, motivo: "nodemailer_ausente" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to: para,
    subject: "Sua licença CybhorPDV",
    text: [
      `Olá! Segue a chave da loja "${nomeLoja}".`,
      "",
      `Chave: ${chave}`,
      pagamentoId ? `Pagamento: ${pagamentoId}` : "",
      "",
      "1) Baixe o CybhorPDV",
      "2) Cole a chave na tela Ativar licença",
      "3) Crie o administrador da sua loja",
      "",
      "Guarde este e-mail. Cada chave isola os dados da sua loja.",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  return { ok: true };
}

module.exports = { enviarChavePorEmail };
