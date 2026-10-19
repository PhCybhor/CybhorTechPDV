// Cria (ou atualiza a senha de) um administrador do SISTEMA.
// Uso: npm run admin:criar -- "Seu Nome" email@dominio.com "senha-forte"
import { validarConfiguracaoObrigatoria } from '../src/config.js';
import { fecharPool } from '../src/db.js';
import { criarOuAtualizarAdminSistema } from '../src/services/adminService.js';

async function criarAdmin() {
  const [nome, email, senha] = process.argv.slice(2);
  if (!nome || !email || !senha) {
    throw new Error('Uso: npm run admin:criar -- "Nome" email@dominio.com "senha (min 8)"');
  }
  validarConfiguracaoObrigatoria();
  const criado = await criarOuAtualizarAdminSistema({ nome, email, senha });
  console.info(`Administrador do sistema pronto: ${criado.email}`);
}

criarAdmin()
  .catch((erro) => {
    console.error(erro.mensagem || erro.message);
    process.exitCode = 1;
  })
  .finally(fecharPool);
