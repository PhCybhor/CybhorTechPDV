"""Gera narração do Reels (Gemini TTS humano, 1 request; fallback edge-tts)."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
CLIPS = OUT / "clips"
ROTEIRO = ROOT / "roteiro-voz.json"
ENV_CANDIDATOS = [
    ROOT.parent / ".env",
    ROOT.parent / "server" / ".env",
]


def carregar_env() -> None:
    for caminho in ENV_CANDIDATOS:
        if not caminho.is_file():
            continue
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            s = linha.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            chave, _, valor = s.partition("=")
            chave = chave.strip()
            valor = valor.strip().strip('"').strip("'")
            if chave and chave not in os.environ:
                os.environ[chave] = valor


def duracao_audio_ms(ffmpeg: str, caminho: Path) -> int:
    proc = subprocess.run(
        [ffmpeg, "-i", str(caminho)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", proc.stderr or "")
    if not m:
        raise RuntimeError(f"Não li duração de {caminho}")
    h, mi, s, frac = m.groups()
    return ((int(h) * 3600 + int(mi) * 60 + int(s)) * 1000) + int((frac + "000")[:3])


def escrever_silencio_wav(caminho: Path, ms: int, rate: int = 24000) -> None:
    frames = int(rate * (ms / 1000.0))
    with wave.open(str(caminho), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(b"\x00\x00" * frames)


def pcm_para_wav(pcm: bytes, destino: Path, rate: int = 24000) -> None:
    with wave.open(str(destino), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm)


def extrair_rate(mime: str, padrao: int = 24000) -> int:
    m = re.search(r"rate=(\d+)", mime or "")
    return int(m.group(1)) if m else padrao


def sintetizar_gemini(
    texto: str, voz: str, modelo: str, api_key: str, tentativas: int = 6
) -> tuple[bytes, int]:
    body = {
        "contents": [{"parts": [{"text": texto}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voz}}
            },
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{modelo}:generateContent?key={urllib.parse.quote(api_key)}"
    )

    ultimo_erro = ""
    for tentativa in range(1, tentativas + 1):
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            part = (
                ((payload.get("candidates") or [{}])[0].get("content") or {}).get(
                    "parts"
                )
                or [{}]
            )[0]
            inline = part.get("inlineData") or part.get("inline_data") or {}
            data_b64 = inline.get("data")
            if not data_b64:
                raise RuntimeError(
                    f"Gemini não retornou áudio: {json.dumps(payload)[:400]}"
                )
            mime = inline.get("mimeType") or inline.get("mime_type") or ""
            return base64.b64decode(data_b64), extrair_rate(mime)
        except urllib.error.HTTPError as erro:
            detalhe = erro.read().decode("utf-8", errors="replace")
            ultimo_erro = f"HTTP {erro.code}: {detalhe[:400]}"
            espera = 8 * tentativa
            m = re.search(r"retry in ([0-9.]+)s", detalhe, re.I)
            if m:
                espera = max(espera, int(float(m.group(1)) + 1.5))
            if erro.code != 429 or tentativa == tentativas:
                raise RuntimeError(f"Gemini TTS {ultimo_erro}") from erro
            print(f"  cota/rate limit — aguardando {espera}s…")
            time.sleep(espera)

    raise RuntimeError(f"Gemini TTS falhou: {ultimo_erro}")


def tempos_proporcionais(falas: list[str], audio_ms: int, pad_antes: int, pad_depois: int) -> list[int]:
    """Divide o áudio contínuo entre slides pelo peso do texto."""
    pesos = [max(len(re.sub(r"\s+", "", f)), 1) for f in falas]
    soma = sum(pesos)
    util = max(audio_ms - (pad_antes + pad_depois) * len(falas), audio_ms // 2)
    tempos = []
    acumulado = 0
    for i, peso in enumerate(pesos):
        if i == len(pesos) - 1:
            fala_ms = util - acumulado
        else:
            fala_ms = int(round(util * (peso / soma)))
            acumulado += fala_ms
        tempos.append(pad_antes + max(fala_ms, 800) + pad_depois)

    # Ajusta para o total do áudio real (com pads internos já no áudio)
    # Preferimos que sum(tempos) ~= audio_ms
    alvo = audio_ms
    atual = sum(tempos)
    if atual > 0 and abs(atual - alvo) > 200:
        fator = alvo / atual
        tempos = [max(900, int(round(t * fator))) for t in tempos]
        # corrige arredondamento no último
        tempos[-1] = max(900, alvo - sum(tempos[:-1]))
    return tempos


async def sintetizar_edge(texto: str, voz: str, rate: str, destino: Path) -> None:
    communicate = edge_tts.Communicate(texto, voz, rate=rate)
    await communicate.save(str(destino))


def montar_prompt_unico(estilo: str, falas: list[str]) -> str:
    blocos = "\n\n".join(f"BLOCO {i + 1}: {fala}" for i, fala in enumerate(falas))
    return (
        f"{estilo.strip()}\n\n"
        "Leia os blocos em sequência. Entre um BLOCO e o próximo, faça uma pausa "
        "clara de cerca de um segundo, sem ler a palavra BLOCO nem o número.\n\n"
        f"{blocos}"
    )


async def main() -> int:
    carregar_env()
    ffmpeg = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
    cfg = json.loads(ROTEIRO.read_text(encoding="utf-8"))
    falas: list[str] = cfg["falas"]
    provedor = str(cfg.get("provedor") or "gemini").lower()
    voz = cfg.get("voz") or (
        "Aoede" if provedor == "gemini" else "pt-BR-ThalitaMultilingualNeural"
    )
    rate = cfg.get("rate", "+0%")
    estilo = cfg.get("estilo") or (
        "Fale em português brasileiro, de forma humana e natural. Texto:"
    )
    modelo = cfg.get("modelo") or "gemini-2.5-flash-preview-tts"
    pad_antes = int(cfg.get("padAntesMs", 180))
    pad_depois = int(cfg.get("padDepoisMs", 220))
    api_key = str(os.environ.get("GEMINI_API_KEY") or "").strip()

    if provedor == "gemini" and not api_key:
        print("GEMINI_API_KEY ausente — usando edge-tts.")
        provedor = "edge"
        voz = "pt-BR-ThalitaMultilingualNeural"

    OUT.mkdir(parents=True, exist_ok=True)
    CLIPS.mkdir(parents=True, exist_ok=True)

    print(f"Provedor: {provedor} · voz: {voz}")

    naracao_wav = CLIPS / "naracao_cheia.wav"

    if provedor == "gemini":
        prompt = montar_prompt_unico(estilo, falas)
        print("Gerando narração completa (1 request Gemini)…")
        pcm, sample_rate = sintetizar_gemini(prompt, voz, modelo, api_key)
        pcm_para_wav(pcm, naracao_wav, sample_rate)
        audio_ms = duracao_audio_ms(ffmpeg, naracao_wav)
        tempos = tempos_proporcionais(falas, audio_ms, pad_antes, pad_depois)

        # Áudio final = narração completa (já tem pausas naturais)
        naracao = OUT / "naracao.mp3"
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-i",
                str(naracao_wav),
                "-c:a",
                "libmp3lame",
                "-q:a",
                "2",
                str(naracao),
            ],
            check=True,
            capture_output=True,
        )
        # Com áudio contínuo, tempos devem somar ≈ duração do áudio
        tempos = tempos_proporcionais(falas, audio_ms, 0, 0)
    else:
        tempos = []
        partes_audio: list[Path] = []
        sil_antes = CLIPS / "sil_antes.wav"
        sil_depois = CLIPS / "sil_depois.wav"
        escrever_silencio_wav(sil_antes, pad_antes)
        escrever_silencio_wav(sil_depois, pad_depois)

        for i, fala in enumerate(falas):
            print(f"[{i + 1}/{len(falas)}] {fala[:72]}…")
            mp3 = CLIPS / f"fala_{i:02d}.mp3"
            wav = CLIPS / f"fala_{i:02d}.wav"
            await sintetizar_edge(fala, voz, rate, mp3)
            subprocess.run(
                [ffmpeg, "-y", "-i", str(mp3), "-ac", "1", "-ar", "24000", str(wav)],
                check=True,
                capture_output=True,
            )
            audio_ms = duracao_audio_ms(ffmpeg, wav)
            tempos.append(pad_antes + audio_ms + pad_depois)
            partes_audio.extend([sil_antes, wav, sil_depois])

        lista = CLIPS / "concat.txt"
        lista.write_text(
            "\n".join(f"file '{p.resolve().as_posix()}'" for p in partes_audio) + "\n",
            encoding="utf-8",
        )
        naracao = OUT / "naracao.mp3"
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(lista),
                "-c:a",
                "libmp3lame",
                "-q:a",
                "2",
                str(naracao),
            ],
            check=True,
            capture_output=True,
        )

    timings = {
        "temposMs": tempos,
        "totalMs": sum(tempos),
        "provedor": provedor,
        "voz": voz,
        "naracao": str(OUT / "naracao.mp3"),
        "falas": falas,
    }
    (OUT / "timings.json").write_text(
        json.dumps(timings, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Narração: {OUT / 'naracao.mp3'}")
    print(f"Total: {sum(tempos) / 1000:.1f}s · slides: {tempos}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
