"use strict";

/**
 * Cria (ou atualiza a senha de) um administrador do SISTEMA.
 * Uso: node scripts/criar-admin-sistema.js "Seu Nome" email@dominio.com "senha-forte"
 */
const { pool, consultar } = require("../src/config/db");
const { gerarSalt, gerarHashSenha } = require("../src/utils/senha");

async function main() {
  const [nome, email, senha] = process.argv.slice(2);
  if (!nome || !email || !senha || senha.length < 8) {
    console.error(
      'Uso: node scripts/criar-admin-sistema.js "Nome" email@dominio.com "senha (min 8)"'
    );
    process.exit(1);
  }

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);

  await consultar(
    `INSERT INTO administradores_sistema (nome, email, salt, senha_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email)
     DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt, senha_hash = EXCLUDED.senha_hash`,
    [nome.trim(), email.trim().toLowerCase(), salt, senhaHash]
  );

  console.log(`Administrador do sistema pronto: ${email}`);
  await pool.end();
}

main().catch((erro) => {
  console.error("Falha ao criar administrador:", erro.message);
  process.exit(1);
});
