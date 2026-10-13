import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from "@zxing/library";

/**
 * Entry point separado: o decodificador (~400 KB) só carrega ao abrir a câmera.
 * Exposto em globalThis para o bundle principal (IIFE) consumir sem ESM.
 *
 * Só formatos lineares e sem TRY_HARDER: QR e o modo "tentar mais" levam
 * segundos por quadro vazio em PC fraco e travariam a leitura contínua.
 */
const leitor = new MultiFormatReader();
leitor.setHints(
  new Map([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
      ],
    ],
  ])
);

/**
 * @param {HTMLCanvasElement} canvas quadro atual da câmera
 * @returns {string | null} texto do código, ou null se não houver código legível
 */
function decodificarQuadro(canvas) {
  try {
    const imagem = new BinaryBitmap(
      new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas))
    );
    return leitor.decodeWithState(imagem).getText();
  } catch {
    // A maioria dos quadros não tem código legível; isso é o fluxo normal.
    return null;
  } finally {
    leitor.reset();
  }
}

globalThis.CybhorDecodificadorBarras = { decodificarQuadro };
