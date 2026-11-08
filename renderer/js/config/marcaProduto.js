export const NOME_PRODUTO = "Operar";
export const NOME_PRODUTO_COMPLETO = "Operar by Cybhor";
export const MARCA_PUBLISHER = "Cybhor";
export const TAGLINE = "Sua loja inteira, não só o caixa.";
export const APP_BACKUP_ATUAL = "Operar";
export const APP_BACKUP_LEGADOS = Object.freeze(["CybhorPDV"]);

export function appBackupValido(app) {
  if (typeof app !== "string") return false;
  if (app === APP_BACKUP_ATUAL) return true;
  return APP_BACKUP_LEGADOS.includes(app);
}
