/**
 * Exporta um snapshot JSON da loja (backup / migração).
 * Exportação de dados no estilo dos ERPs — sem depender de nuvem terceira.
 */

/**
 * @param {{
 *   lojaId?: string,
 *   lojaNome?: string,
 *   produtos?: Array<object>,
 *   vendas?: Array<object>,
 *   despesas?: Array<object>,
 *   sangrias?: Array<object>,
 *   fornecedores?: Array<object>,
 *   funcionarios?: Array<object>,
 * }} dados
 * @returns {{ nomeArquivo: string, blob: Blob }}
 */
export function montarBackupLoja(dados = {}) {
  const payload = {
    app: "CybhorPDV",
    versao: 2,
    exportadoEm: new Date().toISOString(),
    lojaId: dados.lojaId || null,
    lojaNome: dados.lojaNome || null,
    produtos: dados.produtos || [],
    vendas: dados.vendas || [],
    despesas: dados.despesas || [],
    sangrias: dados.sangrias || [],
    fornecedores: dados.fornecedores || [],
    // Sem hashes de senha
    funcionarios: (dados.funcionarios || []).map((f) => ({
      id: f.id,
      nome: f.nome,
      usuario: f.usuario,
      cargo: f.cargo,
      areas: f.areas || [],
      tipoVinculo: f.tipoVinculo || null,
    })),
  };

  const slug = String(dados.lojaNome || dados.lojaId || "loja")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 40);
  const data = new Date().toISOString().slice(0, 10);
  const nomeArquivo = `CybhorPDV-backup-${slug}-${data}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  return { nomeArquivo, blob };
}

/**
 * Dispara download no renderer.
 * @param {Blob} blob
 * @param {string} nomeArquivo
 */
export function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
