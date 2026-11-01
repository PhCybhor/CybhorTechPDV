"use strict";

const RISCO_ESCRITA = new Set(["medio", "alto"]);
const JANELA_MS = 60_000;

function criarRuntime({ journal, tools, rag, rateLimitAltoPorMin = 5, chamarLlm }) {
  const altosRecentes = [];

  function cabeAcaoAlta(agora = Date.now()) {
    const corte = agora - JANELA_MS;
    while (altosRecentes.length && altosRecentes[0] <= corte) altosRecentes.shift();
    if (altosRecentes.length >= rateLimitAltoPorMin) return false;
    altosRecentes.push(agora);
    return true;
  }

  async function processarPedido({
    mensagem,
    modo,
    contextoLoja,
    confirmarEscrita,
    ctxTools,
  }) {
    const contextoRag =
      rag && typeof rag.montarContexto === "function" ? rag.montarContexto(mensagem) : "";
    const prompt = montarPrompt({ mensagem, modo, contextoLoja, contextoRag });
    const llm = await chamarLlm({
      prompt,
      tools: tools.listarTools(),
      mensagem,
      contextoLoja,
    });

    const riscoPorNome = new Map(tools.listarTools().map((tool) => [tool.nome, tool.risco]));
    const calls = Array.isArray(llm && llm.tool_calls) ? llm.tool_calls : [];
    const acoes = [];
    const partes = [];
    if (llm && llm.texto) partes.push(String(llm.texto));

    for (const call of calls) {
      const nome = call.nome;
      const args = call.args && typeof call.args === "object" ? call.args : {};
      const risco = riscoPorNome.get(nome);

      if (RISCO_ESCRITA.has(risco) && modo !== "autonomo") {
        const aceito =
          typeof confirmarEscrita === "function"
            ? await confirmarEscrita({
                tool: nome,
                args,
                resumo: `${nome} ${JSON.stringify(args)}`,
              })
            : false;
        if (!aceito) {
          partes.push(`ação não confirmada: ${nome}`);
          continue;
        }
      }

      if (risco === "alto" && !cabeAcaoAlta()) {
        const resumo = `limite de ${rateLimitAltoPorMin} ações de risco alto por minuto atingido`;
        const nota = journal.registrar({
          modo,
          tool: nome,
          resumo,
          before: null,
          after: null,
          reversivel: false,
        });
        acoes.push(nota);
        partes.push(resumo);
        continue;
      }

      const result = await tools.executarTool(nome, args, { ...(ctxTools || {}), modo });
      const entrada = journal.registrar({
        modo,
        tool: nome,
        resumo: result && result.resumo,
        before: result && result.before,
        after: result && result.after,
        reversivel: !!(result && result.reversivel),
      });
      acoes.push(entrada);
      if (result && result.resumo) partes.push(String(result.resumo));
    }

    return {
      ok: !llm || llm.ok !== false,
      texto: partes.filter(Boolean).join("\n"),
      acoes,
      provider: (llm && llm.provider) || "",
    };
  }

  return { processarPedido };
}

function montarPrompt({ mensagem, modo, contextoLoja, contextoRag }) {
  const regra =
    modo === "autonomo"
      ? "Modo autonomo: execute tools de escrita sem pedir confirmação ao operador."
      : "Modo autorizacao: tools de risco medio ou alto só rodam depois que o operador confirmar. Não trate a escrita como feita antes da confirmação.";
  const blocos = [
    "Você é o assistente do PDV Cybhor. Responda em português.",
    regra,
  ];
  if (contextoRag) blocos.push(`Contexto recuperado:\n${contextoRag}`);
  if (contextoLoja) blocos.push(`Loja:\n${JSON.stringify(contextoLoja)}`);
  blocos.push(`Pedido:\n${mensagem || ""}`);
  return blocos.join("\n\n");
}

module.exports = { criarRuntime };
