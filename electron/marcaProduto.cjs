module.exports = {
  NOME_PRODUTO: "Operar",
  NOME_PRODUTO_COMPLETO: "Operar by Cybhor",
  TAGLINE: "Sua loja inteira, não só o caixa.",
  APP_BACKUP_ATUAL: "Operar",
  APP_BACKUP_LEGADOS: Object.freeze(["CybhorPDV"]),
  appBackupValido(app) {
    if (typeof app !== "string") return false;
    if (app === this.APP_BACKUP_ATUAL) return true;
    return this.APP_BACKUP_LEGADOS.includes(app);
  },
};
