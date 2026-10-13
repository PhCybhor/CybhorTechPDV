import { normalizarCodigoLido } from "./codigoBarras.js";

/**
 * Leitores USB/Bluetooth se comportam como teclado: digitam o código inteiro
 * em poucos milissegundos e terminam com Enter. Uma pessoa não digita 6+
 * teclas com menos de 50 ms entre elas, então a velocidade separa os dois.
 */
const INTERVALO_MAXIMO_ENTRE_TECLAS_MS = 50;
const TAMANHO_MINIMO_CODIGO = 6;

/**
 * @param {EventTarget | null} alvo
 * @returns {alvo is HTMLInputElement | HTMLTextAreaElement}
 */
function ehCampoDeTexto(alvo) {
  return (
    alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement
  );
}

/**
 * Tira do campo os caracteres que o leitor digitou nele por engano.
 * @param {EventTarget | null} alvo
 * @param {string} digitado
 */
function removerCodigoDigitadoNoCampo(alvo, digitado) {
  if (!ehCampoDeTexto(alvo) || !digitado) return;
  const valor = alvo.value || "";
  if (!valor.endsWith(digitado)) return;
  alvo.value = valor.slice(0, valor.length - digitado.length);
  alvo.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Escuta o leitor de código de barras em qualquer tela.
 * Campos marcados com `data-leitor-proprio` tratam o próprio Enter e são ignorados.
 *
 * @param {(codigo: string, contexto: { emCampoDeTexto: boolean }) => boolean} aoLerCodigo
 *   Retorna true quando o código foi usado; só então o Enter é consumido
 *   e o texto é retirado do campo que estava com o foco.
 * @returns {() => void} função para parar de escutar
 */
export function instalarLeitorTeclado(aoLerCodigo) {
  let digitado = "";
  let ultimaTeclaEm = 0;
  /** @type {EventTarget | null} */
  let alvoDaLeitura = null;

  const reiniciar = () => {
    digitado = "";
    alvoDaLeitura = null;
  };

  const aoPressionarTecla = (evento) => {
    const alvo = evento.target;
    if (
      evento.ctrlKey ||
      evento.altKey ||
      evento.metaKey ||
      (alvo instanceof Element && alvo.closest("[data-leitor-proprio]"))
    ) {
      reiniciar();
      return;
    }

    const agora = evento.timeStamp;
    const rapido = agora - ultimaTeclaEm <= INTERVALO_MAXIMO_ENTRE_TECLAS_MS;

    if (evento.key === "Enter") {
      const codigo = normalizarCodigoLido(digitado);
      const alvoOriginal = alvoDaLeitura;
      const bruto = digitado;
      reiniciar();
      if (!rapido || codigo.length < TAMANHO_MINIMO_CODIGO) return;

      const usado = aoLerCodigo(codigo, {
        emCampoDeTexto: ehCampoDeTexto(alvoOriginal),
      });
      if (usado) {
        evento.preventDefault();
        evento.stopPropagation();
        removerCodigoDigitadoNoCampo(alvoOriginal, bruto);
      }
      return;
    }

    if (evento.key === "Shift") return;
    if (evento.key.length !== 1) {
      reiniciar();
      return;
    }

    if (!rapido) {
      digitado = "";
      alvoDaLeitura = alvo;
    }
    digitado += evento.key;
    ultimaTeclaEm = agora;
  };

  document.addEventListener("keydown", aoPressionarTecla, true);
  return () => document.removeEventListener("keydown", aoPressionarTecla, true);
}
