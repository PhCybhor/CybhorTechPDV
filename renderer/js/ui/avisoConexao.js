import { EVENTO_CONEXAO, servidorEstaAlcancavel } from "../config/apiClient.js";
import {
  observarFilaOffline,
  sincronizarFilaOffline,
} from "../services/filaVendasOffline.js";
import { notificar } from "./notificacao.js";

function vendas(quantidade) {
  return `${quantidade} venda${quantidade === 1 ? "" : "s"}`;
}

/**
 * @param {{ online: boolean, pendentes: number, recusadas: number, sincronizando: boolean }} situacao
 * @returns {{ mensagem: string, tom: "alerta" | "perigo" | "neutro", podeEnviar: boolean }}
 */
function descreverSituacao({ online, pendentes, recusadas, sincronizando }) {
  if (!online) {
    return {
      mensagem: pendentes
        ? `Sem internet. ${vendas(pendentes)} guardada${pendentes === 1 ? "" : "s"} neste computador; o envio é automático quando a conexão voltar.`
        : "Sem internet. Pode continuar vendendo: as vendas ficam guardadas neste computador.",
      tom: "alerta",
      podeEnviar: false,
    };
  }
  if (sincronizando) {
    return {
      mensagem: `Enviando ${vendas(pendentes)} guardada${pendentes === 1 ? "" : "s"} sem internet…`,
      tom: "neutro",
      podeEnviar: false,
    };
  }
  if (pendentes) {
    return { mensagem: `${vendas(pendentes)} aguardando envio ao servidor.`, tom: "alerta", podeEnviar: true };
  }
  if (recusadas) {
    return {
      mensagem: `${vendas(recusadas)} guardada${recusadas === 1 ? "" : "s"} sem internet ${recusadas === 1 ? "foi recusada" : "foram recusadas"} pelo servidor. Avise o administrador.`,
      tom: "perigo",
      podeEnviar: false,
    };
  }
  return { mensagem: "", tom: "neutro", podeEnviar: false };
}

/**
 * Faixa no topo do app que mostra queda de internet e vendas guardadas.
 */
export function iniciarAvisoConexao() {
  const aviso = document.getElementById("aviso-conexao");
  const texto = document.getElementById("aviso-conexao-texto");
  const botaoEnviar = document.getElementById("btn-enviar-vendas-guardadas");
  if (!aviso || !texto || !botaoEnviar) return;

  let online = servidorEstaAlcancavel() && navigator.onLine !== false;
  let fila = { pendentes: 0, recusadas: 0, sincronizando: false };

  const renderizar = () => {
    const { mensagem, tom, podeEnviar } = descreverSituacao({ online, ...fila });
    aviso.classList.toggle("oculto", !mensagem);
    aviso.classList.toggle("aviso-app--alerta", tom === "alerta");
    aviso.classList.toggle("aviso-app--perigo", tom === "perigo");
    texto.textContent = mensagem;
    botaoEnviar.classList.toggle("oculto", !podeEnviar);
  };

  observarFilaOffline((status) => {
    fila = status;
    if (status.enviadas > 0) {
      notificar(`${vendas(status.enviadas)} guardada${status.enviadas === 1 ? "" : "s"} sem internet ${status.enviadas === 1 ? "foi enviada" : "foram enviadas"} ao servidor.`, "sucesso", 4000);
    }
    renderizar();
  });

  window.addEventListener(EVENTO_CONEXAO, (evento) => {
    online = Boolean(evento.detail?.online);
    renderizar();
  });
  // "online" do Windows não garante que o servidor responde; quem confirma é a próxima requisição.
  window.addEventListener("offline", () => {
    online = false;
    renderizar();
  });

  botaoEnviar.addEventListener("click", () => void sincronizarFilaOffline());
  renderizar();
}
