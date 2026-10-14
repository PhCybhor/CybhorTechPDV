import {
  atualizarFuncionario as atualizarFuncionarioServico,
  criarFuncionario as criarFuncionarioServico,
  listarFuncionarios as listarFuncionariosServico,
  loginLoja,
} from "../servicos/authServico.js";
import { lerCorpo } from "./requisicao.js";

export async function login(req, res) {
  const corpo = lerCorpo(req);
  res.json(
    await loginLoja({
      codigoLoja: corpo.codigoLoja || "",
      lojaId: corpo.lojaId || "",
      usuario: corpo.usuario || "",
      senha: corpo.senha || "",
      email: corpo.email || "",
    }),
  );
}

export async function listarFuncionarios(req, res) {
  res.json(await listarFuncionariosServico(req.auth.lojaId));
}

export async function criarFuncionario(req, res) {
  const corpo = lerCorpo(req);
  res.status(201).json(await criarFuncionarioServico(req.auth.lojaId, corpo));
}

export async function atualizarFuncionario(req, res) {
  const corpo = lerCorpo(req);
  await atualizarFuncionarioServico(req.auth.lojaId, req.params.funcionarioId, corpo);
  res.status(204).end();
}
