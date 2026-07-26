import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

let instanciaDatabase = null;

/**
 * Inicializa o app Firebase e o Realtime Database uma unica vez.
 * A configuracao vem do processo principal (via preload), nunca do codigo-fonte,
 * garantindo que as credenciais fiquem no arquivo .env.
 *
 * @returns {Promise<import("firebase/database").Database>}
 */
export async function obterDatabase() {
  if (instanciaDatabase) return instanciaDatabase;

  const config = await window.pdvAPI.obterConfigFirebase();

  if (!config || !config.databaseURL) {
    throw new Error(
      "Configuração do Firebase ausente. Verifique o arquivo .env (FIREBASE_DATABASE_URL)."
    );
  }

  const app = initializeApp(config);
  instanciaDatabase = getDatabase(app);
  return instanciaDatabase;
}
