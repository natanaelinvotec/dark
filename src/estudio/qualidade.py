"""Testes automáticos de cada vídeo. Parsers e regras são puros; só os 'rodar_*' chamam o FFmpeg."""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from estudio.db import Teste


@dataclass(frozen=True)
class InfoMidia:
    largura: int
    altura: int
    duracao: float
    tem_audio: bool


@dataclass(frozen=True)
class Analise:
    lufs: float | None
    pretos: list[tuple[float, float]]
    silencios: list[float]  # duração de cada silêncio


@dataclass(frozen=True)
class Limites:
    duracao_min: float = 15
    duracao_max: float = 180
    lufs_alvo: float = -14
    preto_max: float = 0.5
    silencio_at: float = 1.5
    silencio_cr: float = 3.0
    cobertura_ok: float = 0.9
    cobertura_at: float = 0.75
    similaridade_at: float = 0.45
    similaridade_cr: float = 0.6


LIMITES_PADRAO = Limites()


# --------------------------------------------------------------------------- parsers


def parse_ffprobe(saida_json: str) -> InfoMidia:
    dados = json.loads(saida_json)
    video = next((s for s in dados.get("streams", []) if s.get("codec_type") == "video"), {})
    tem_audio = any(s.get("codec_type") == "audio" for s in dados.get("streams", []))
    duracao = float(dados.get("format", {}).get("duration") or video.get("duration") or 0)
    return InfoMidia(int(video.get("width", 0)), int(video.get("height", 0)), duracao, tem_audio)


_LUFS = re.compile(r"I:\s+(-?\d+(?:\.\d+)?)\s+LUFS")
_PRETO = re.compile(r"black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)")
_SILENCIO = re.compile(r"silence_duration:\s*([\d.]+)")


def parse_analise(stderr: str) -> Analise:
    lufs = _LUFS.findall(stderr)
    return Analise(
        lufs=float(lufs[-1]) if lufs else None,
        pretos=[(float(a), float(b)) for a, b in _PRETO.findall(stderr)],
        silencios=[float(d) for d in _SILENCIO.findall(stderr)],
    )


# --------------------------------------------------------------------------- regras


def avaliar(
    info: InfoMidia,
    analise: Analise,
    *,
    cobertura_legenda: float,
    ativos_sem_licenca: int,
    similaridade: float,
    avisos_checagem: int,
    limites: Limites = LIMITES_PADRAO,
) -> list[Teste]:
    testes: list[Teste] = []

    formato_ok = (info.largura, info.altura) == (1080, 1920)
    duracao_ok = limites.duracao_min <= info.duracao <= limites.duracao_max
    testes.append(
        Teste(
            "Formato 9:16",
            "ok" if formato_ok and duracao_ok else "cr",
            f"{info.largura}×{info.altura}, {info.duracao:.1f} s",
        )
    )

    if not info.tem_audio or analise.lufs is None:
        testes.append(Teste("Áudio", "cr", "sem áudio ou sem medição de volume"))
    else:
        desvio = abs(analise.lufs - limites.lufs_alvo)
        status = "ok" if desvio <= 2 else ("at" if desvio <= 4 else "cr")
        testes.append(Teste(f"Áudio {analise.lufs:.0f} LUFS", status, f"alvo {limites.lufs_alvo}"))

    pior_preto = max((b - a for a, b in analise.pretos), default=0.0)
    testes.append(
        Teste(
            "Tela preta",
            "cr" if pior_preto >= limites.preto_max else "ok",
            f"maior trecho: {pior_preto:.1f} s" if pior_preto else "nenhum trecho",
        )
    )

    pior_silencio = max(analise.silencios, default=0.0)
    status_silencio = (
        "cr"
        if pior_silencio >= limites.silencio_cr
        else ("at" if pior_silencio >= limites.silencio_at else "ok")
    )
    testes.append(Teste("Silêncio", status_silencio, f"maior pausa: {pior_silencio:.1f} s"))

    status_legenda = (
        "ok"
        if cobertura_legenda >= limites.cobertura_ok
        else ("at" if cobertura_legenda >= limites.cobertura_at else "cr")
    )
    testes.append(Teste("Legenda", status_legenda, f"cobertura {cobertura_legenda:.0%}"))

    testes.append(
        Teste(
            "Licenças",
            "ok" if ativos_sem_licenca == 0 else "cr",
            "todas registradas" if ativos_sem_licenca == 0 else f"{ativos_sem_licenca} sem licença",
        )
    )

    status_sim = (
        "cr"
        if similaridade >= limites.similaridade_cr
        else ("at" if similaridade >= limites.similaridade_at else "ok")
    )
    testes.append(
        Teste(f"Similaridade {similaridade:.2f}".replace(".", ","), status_sim, "contra o canal")
    )

    testes.append(
        Teste(
            "Checagem" if avisos_checagem == 0 else f"Checagem: {avisos_checagem} aviso(s)",
            "ok" if avisos_checagem == 0 else "at",
        )
    )
    return testes


def reprovado(testes: list[Teste]) -> bool:
    return any(t.status == "cr" for t in testes)


# --------------------------------------------------------------------------- execução


def rodar_ffprobe(arquivo: Path, ffprobe: str = "ffprobe") -> InfoMidia:
    resultado = subprocess.run(  # noqa: S603 - argumentos fixos, sem shell
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(arquivo)],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return parse_ffprobe(resultado.stdout)


def rodar_analise(arquivo: Path, ffmpeg: str = "ffmpeg") -> Analise:
    resultado = subprocess.run(  # noqa: S603 - argumentos fixos, sem shell
        [
            ffmpeg, "-hide_banner", "-nostats", "-nostdin", "-i", str(arquivo),
            "-af", "ebur128=framelog=verbose,silencedetect=n=-40dB:d=1.5",
            "-vf", "blackdetect=d=0.5:pix_th=0.10",
            "-f", "null", "-",
        ],  # fmt: skip
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if resultado.returncode != 0:
        cauda = (resultado.stderr or "").strip().splitlines()[-5:]
        raise RuntimeError("análise do FFmpeg falhou: " + " | ".join(cauda))
    return parse_analise(resultado.stderr or "")
