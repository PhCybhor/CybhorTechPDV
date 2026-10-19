import { criarApp } from './app.js';
import { config, validarConfiguracaoObrigatoria } from './config.js';
import { fecharPool, ping } from './db.js';
import { logger } from './logger.js';

const TIMEOUT_ENCERRAMENTO_MS = 10_000;

async function iniciar() {
  validarConfiguracaoObrigatoria();

  // Falhar no boot evita subir uma API "saudável" que responde 500 a tudo.
  if (!(await ping())) {
    throw new Error('Nao foi possivel conectar ao MySQL. Verifique DATABASE_URL.');
  }

  const servidor = criarApp().listen(config.porta, () => {
    logger.info(`API CybhorPDV ouvindo na porta ${config.porta}`);
  });

  let encerrando = false;
  const encerrar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    logger.info(`${sinal} recebido; encerrando`);
    const limite = setTimeout(() => process.exit(1), TIMEOUT_ENCERRAMENTO_MS);
    limite.unref();
    servidor.close(async () => {
      await fecharPool();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

iniciar().catch((erro) => {
  logger.error('falha ao iniciar a API', erro?.message ?? erro);
  process.exit(1);
});
