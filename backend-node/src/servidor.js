import { criarApp } from "./app.js";
import { config, validarVariaveisObrigatorias } from "./config.js";
import { fecharPool, pingar } from "./db.js";
import { logger } from "./logger.js";

const TEMPO_MAXIMO_DESLIGAMENTO_MS = 10_000;

async function iniciar() {
  validarVariaveisObrigatorias();
  if (!(await pingar())) logger.aviso("banco_indisponivel_no_boot");

  const servidor = criarApp().listen(config.porta, () => {
    logger.info("api_iniciada", { porta: config.porta, producao: config.emProducao });
  });

  const desligar = (sinal) => {
    logger.info("api_desligando", { sinal });
    servidor.close(() => fecharPool().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), TEMPO_MAXIMO_DESLIGAMENTO_MS).unref();
  };
  process.on("SIGTERM", desligar);
  process.on("SIGINT", desligar);
}

iniciar().catch((erro) => {
  logger.erro("falha_ao_iniciar", erro);
  process.exit(1);
});
