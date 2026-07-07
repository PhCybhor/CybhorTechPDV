import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

let instanciaDatabase = null;

/**
 * Inicializa o app Firebase e o Realtime Database uma unica vez.
 * A configuracao vem do processo principal (via preload), embutida no instalador.
 *
 * @returns {Promise<import("firebase/database").Database>}
 */
export async function obterDatabase() {
  if (instanciaDatabase) return instanciaDatabase;

  const config = await window.pdvAPI.obterConfigFirebase();

  if (!config || !config.databaseURL) {
    throw new Error(
      "Nao foi possivel conectar ao servidor. Reinstale o aplicativo ou contate o suporte."
    );
  }

  const app = initializeApp(config);
  instanciaDatabase = getDatabase(app);
  return instanciaDatabase;
}
