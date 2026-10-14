/**
 * Cria (ou atualiza a senha de) um administrador do SISTEMA.
 *
 * Uso: npm run admin:criar -- "Seu Nome" email@dominio.com
 * A senha é pedida no terminal (sem eco) ou lida de ADMIN_SENHA, para não
 * ficar no histórico do shell nem na lista de processos.
 */
import { createInterface } from "node:readline";
import { fecharPool } from "../src/db.js";
import { validarVariaveisObrigatorias } from "../src/config.js";
import { ErroNegocio } from "../src/erros.js";
import { criarOuAtualizarAdminSistema } from "../src/servicos/adminServico.js";

function perguntarSenhaSemEco(pergunta) {
  return new Promise((resolver) => {
    const leitor = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    leitor._writeToOutput = (texto) => {
      if (texto.startsWith(pergunta)) process.stdout.write(pergunta);
    };
    leitor.question(pergunta, (resposta) => {
      leitor.close();
      process.stdout.write("\n");
      resolver(resposta);
    });
  });
}

async function principal() {
  const [nome, email] = process.argv.slice(2);
  if (!nome || !email) {
    process.stderr.write('Uso: npm run admin:criar -- "Nome" email@dominio.com\n');
    process.exitCode = 1;
    return;
  }

  validarVariaveisObrigatorias();
  const senha = process.env.ADMIN_SENHA || (await perguntarSenhaSemEco("Senha (min 8): "));
  try {
    const { email: emailSalvo } = await criarOuAtualizarAdminSistema({ nome, email, senha });
    process.stdout.write(`Administrador do sistema pronto: ${emailSalvo}\n`);
  } catch (erro) {
    if (!(erro instanceof ErroNegocio)) throw erro;
    process.stderr.write(`${erro.message}\n`);
    process.exitCode = 1;
  } finally {
    await fecharPool();
  }
}

principal().catch(async (erro) => {
  process.stderr.write(`Falha ao criar administrador: ${erro.message}\n`);
  await fecharPool();
  process.exitCode = 1;
});
