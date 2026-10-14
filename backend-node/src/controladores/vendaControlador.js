import { exigirPermissao, exigirPermissoesVenda } from "../servicos/authServico.js";
import { cancelarVenda, finalizarVenda } from "../servicos/caixaServico.js";
import { listarVendas, registrarVenda } from "../servicos/vendaServico.js";
import { contextoPermissao, funcionarioLogado, lerConsultaInteira, lerCorpo } from "./requisicao.js";

export async function registrar(req, res) {
  const corpo = lerCorpo(req);
  await exigirPermissoesVenda(contextoPermissao(req), corpo);
  res.status(201).json(await registrarVenda(req.auth.lojaId, funcionarioLogado(req), corpo));
}

export async function listar(req, res) {
  const limite = lerConsultaInteira(req, "limite", 100);
  res.json(await listarVendas(req.auth.lojaId, limite));
}

export async function finalizarNoCaixa(req, res) {
  const corpo = lerCorpo(req);
  await exigirPermissoesVenda(contextoPermissao(req), corpo);
  res.status(201).json(await finalizarVenda(req.auth.lojaId, funcionarioLogado(req), corpo));
}

export async function cancelarNoCaixa(req, res) {
  const corpo = lerCorpo(req);
  // Cancelamento no caixa exige admin (senha validada no cliente) OU permissão.
  await exigirPermissao({
    ...contextoPermissao(req),
    chave: "cancelarVenda",
    mensagem: "Sem permissao para cancelar venda.",
  });
  res.json(
    await cancelarVenda(req.auth.lojaId, {
      vendaId: String(corpo.vendaId || ""),
      motivo: String(corpo.motivo || ""),
      canceladoPorNome: String(corpo.canceladoPorNome || req.auth.nome || ""),
    }),
  );
}
