import { normalizarCodigoLido } from "../utils/codigoBarras.js";

const ID_MODAL = "modal-leitor-camera";
const INTERVALO_ENTRE_LEITURAS_MS = 140;
/**
 * Quadros alternam entre resolução cheia (código pequeno/longe) e reduzida
 * (código desfocado: reduzir funciona como nitidez). Cada escala sozinha falha
 * num dos casos.
 */
const LARGURAS_DE_ANALISE = [1280, 800, 560];
/**
 * Só a faixa central (onde fica a mira) é analisada: corta o trabalho por quadro
 * pela metade e evita ler outro código que apareça na borda da imagem.
 */
const RECORTE_HORIZONTAL = 0.9;
const RECORTE_VERTICAL = 0.6;
/**
 * No modo contínuo o mesmo código fica na frente da câmera por vários quadros.
 * Só conta de novo depois que ele some da imagem por este tempo.
 */
const PAUSA_PARA_REPETIR_MESMO_CODIGO_MS = 1800;

/** @type {Promise<void> | null} */
let carregandoDecodificador = null;

/** @type {null | { encerrar: () => void }} */
let sessaoAtiva = null;

/**
 * Carrega o decodificador (chunk lazy) sob demanda.
 * @returns {Promise<{ decodificarQuadro: (canvas: HTMLCanvasElement) => string | null }>}
 */
async function carregarDecodificador() {
  if (globalThis.CybhorDecodificadorBarras) {
    return globalThis.CybhorDecodificadorBarras;
  }
  if (!carregandoDecodificador) {
    carregandoDecodificador = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "dist/leitor-camera.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        carregandoDecodificador = null;
        reject(new Error("Falha ao carregar o leitor da câmera."));
      };
      document.head.appendChild(script);
    });
  }
  await carregandoDecodificador;
  if (!globalThis.CybhorDecodificadorBarras) {
    carregandoDecodificador = null;
    throw new Error("Leitor da câmera indisponível.");
  }
  return globalThis.CybhorDecodificadorBarras;
}

/**
 * Desliga a câmera e fecha a janela do leitor, se estiverem abertas.
 */
export function fecharLeitorCamera() {
  sessaoAtiva?.encerrar();
}

/**
 * @returns {Promise<boolean>}
 */
export async function existeCameraConectada() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    return dispositivos.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}

/**
 * @param {unknown} erro
 * @returns {string}
 */
function mensagemErroCamera(erro) {
  const nome = erro && typeof erro === "object" ? erro.name : "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "Acesso à câmera bloqueado. Libere em Configurações do Windows › Privacidade › Câmera.";
  }
  if (nome === "NotFoundError" || nome === "OverconstrainedError") {
    return "Nenhuma câmera encontrada neste computador.";
  }
  if (nome === "NotReadableError" || nome === "AbortError") {
    return "A câmera está em uso por outro programa. Feche-o e tente de novo.";
  }
  return "Não foi possível abrir a câmera.";
}

function tocarBipe() {
  try {
    const contexto = new AudioContext();
    const oscilador = contexto.createOscillator();
    const volume = contexto.createGain();
    oscilador.frequency.value = 1760;
    volume.gain.value = 0.08;
    oscilador.connect(volume).connect(contexto.destination);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.09);
    oscilador.onended = () => contexto.close();
  } catch {
    // Sem saída de áudio o leitor continua funcionando; o bipe é só conforto.
  }
}

/**
 * Abre a janela da câmera e chama `aoLerCodigo` a cada código reconhecido.
 *
 * @param {{
 *   titulo?: string,
 *   dica?: string,
 *   continuo?: boolean,
 *   aoLerCodigo: (codigo: string) => void
 * }} opcoes
 *   `continuo`: mantém a câmera aberta para ler vários códigos (caixa);
 *   sem ele, fecha no primeiro código (cadastro e busca).
 */
export async function abrirLeitorCamera({
  titulo = "Ler código com a câmera",
  dica = "Aponte o código de barras para a câmera, a uns 15 cm, com boa luz.",
  continuo = false,
  aoLerCodigo,
}) {
  sessaoAtiva?.encerrar();

  const modal = document.getElementById(ID_MODAL);
  const video = /** @type {HTMLVideoElement} */ (
    document.getElementById("leitor-camera-video")
  );
  const status = document.getElementById("leitor-camera-status");
  const seletor = /** @type {HTMLSelectElement} */ (
    document.getElementById("leitor-camera-dispositivo")
  );
  const wrapSeletor = document.getElementById("wrap-leitor-camera-dispositivo");
  const botaoFechar = document.getElementById("btn-fechar-leitor-camera");
  if (!modal || !video || !status || !seletor || !wrapSeletor || !botaoFechar) {
    return;
  }

  document.getElementById("leitor-camera-titulo").textContent = titulo;
  document.getElementById("leitor-camera-dica").textContent = dica;
  status.textContent = "Abrindo a câmera…";
  status.classList.remove("erro");
  wrapSeletor.classList.add("oculto");
  modal.classList.remove("oculto");
  botaoFechar.focus();

  const canvas = document.createElement("canvas");
  const contexto2d = canvas.getContext("2d", { willReadFrequently: true });

  /** @type {MediaStream | null} */
  let fluxo = null;
  let temporizador = 0;
  let encerrada = false;
  let ultimoCodigo = "";
  let ultimoCodigoVistoEm = 0;
  let quadrosLidos = 0;
  /** @type {null | { decodificarQuadro: (canvas: HTMLCanvasElement) => string | null }} */
  let decodificador = null;

  const pararFluxo = () => {
    clearTimeout(temporizador);
    fluxo?.getTracks().forEach((faixa) => faixa.stop());
    fluxo = null;
    video.srcObject = null;
  };

  const sessao = {
    encerrar() {
      if (encerrada) return;
      encerrada = true;
      pararFluxo();
      observador.disconnect();
      botaoFechar.removeEventListener("click", aoFechar);
      seletor.removeEventListener("change", aoTrocarCamera);
      modal.removeEventListener("keydown", aoTeclar);
      modal.classList.add("oculto");
      if (sessaoAtiva === sessao) sessaoAtiva = null;
    },
  };
  sessaoAtiva = sessao;

  const aoFechar = () => sessao.encerrar();
  const aoTrocarCamera = () => {
    if (!decodificador) return;
    iniciarFluxo(seletor.value).catch((erro) => {
      if (!encerrada) mostrarErro(mensagemErroCamera(erro));
    });
  };
  const aoTeclar = (evento) => {
    // Esc fecha só a câmera; o atalho global fecharia também o cadastro aberto atrás.
    if (evento.key !== "Escape") return;
    evento.preventDefault();
    evento.stopPropagation();
    sessao.encerrar();
  };
  // O modal pode ser escondido por fora (Esc global, logout): a câmera precisa desligar junto.
  const observador = new MutationObserver(() => {
    if (modal.classList.contains("oculto")) sessao.encerrar();
  });
  observador.observe(modal, { attributes: true, attributeFilter: ["class"] });
  botaoFechar.addEventListener("click", aoFechar);
  seletor.addEventListener("change", aoTrocarCamera);
  modal.addEventListener("keydown", aoTeclar);

  const analisarQuadroAtual = () => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const larguraRecorte = video.videoWidth * RECORTE_HORIZONTAL;
      const alturaRecorte = video.videoHeight * RECORTE_VERTICAL;
      quadrosLidos += 1;
      const larguraDeAnalise = LARGURAS_DE_ANALISE[quadrosLidos % LARGURAS_DE_ANALISE.length];
      const escala = Math.min(1, larguraDeAnalise / larguraRecorte);
      canvas.width = Math.round(larguraRecorte * escala);
      canvas.height = Math.round(alturaRecorte * escala);
      contexto2d.drawImage(
        video,
        (video.videoWidth - larguraRecorte) / 2,
        (video.videoHeight - alturaRecorte) / 2,
        larguraRecorte,
        alturaRecorte,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const codigo = normalizarCodigoLido(decodificador.decodificarQuadro(canvas));
      const agora = Date.now();
      if (codigo) {
        const repetido =
          codigo === ultimoCodigo &&
          agora - ultimoCodigoVistoEm < PAUSA_PARA_REPETIR_MESMO_CODIGO_MS;
        ultimoCodigo = codigo;
        ultimoCodigoVistoEm = agora;
        if (!repetido) {
          tocarBipe();
          if (!continuo) sessao.encerrar();
          else status.textContent = `Lido: ${codigo}`;
          aoLerCodigo(codigo);
        }
      }
    }
  };

  const lerQuadro = () => {
    if (encerrada || !fluxo || !decodificador) return;
    try {
      analisarQuadroAtual();
    } finally {
      // Pausa contada depois da análise: em PC lento a câmera não monopoliza a CPU.
      if (!encerrada && fluxo) {
        temporizador = setTimeout(lerQuadro, INTERVALO_ENTRE_LEITURAS_MS);
      }
    }
  };

  const mostrarErro = (mensagem) => {
    pararFluxo();
    status.textContent = mensagem;
    status.classList.add("erro");
  };

  const iniciarFluxo = async (idDispositivo) => {
    pararFluxo();
    const escolhaDaCamera = idDispositivo
      ? { deviceId: { exact: idDispositivo } }
      : { facingMode: "environment" };
    const novoFluxo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...escolhaDaCamera, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (encerrada) {
      novoFluxo.getTracks().forEach((faixa) => faixa.stop());
      return;
    }
    fluxo = novoFluxo;
    video.srcObject = fluxo;
    await video.play().catch(() => {});
    status.textContent = continuo
      ? "Pronto. Passe os produtos na frente da câmera."
      : "Pronto. Aguardando o código…";
    lerQuadro();
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    mostrarErro(mensagemErroCamera({ name: "NotFoundError" }));
    return;
  }

  try {
    decodificador = await carregarDecodificador();
  } catch (erro) {
    if (!encerrada) mostrarErro(erro.message);
    return;
  }

  try {
    if (encerrada) return;
    await iniciarFluxo("");
    if (encerrada) return;

    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "videoinput"
    );
    if (cameras.length > 1 && !encerrada) {
      const atual = fluxo?.getVideoTracks()[0]?.getSettings().deviceId || "";
      seletor.replaceChildren(
        ...cameras.map((camera, indice) => {
          const opcao = document.createElement("option");
          opcao.value = camera.deviceId;
          opcao.textContent = camera.label || `Câmera ${indice + 1}`;
          opcao.selected = camera.deviceId === atual;
          return opcao;
        })
      );
      wrapSeletor.classList.remove("oculto");
    }
  } catch (erro) {
    if (!encerrada) mostrarErro(mensagemErroCamera(erro));
  }
}
