"""Montagem do vídeo 9:16 com FFmpeg. O comando é sempre uma lista de argumentos (sem shell)."""

from __future__ import annotations

import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

_NOME_SEGURO = re.compile(r"^[A-Za-z0-9_./-]+$")


class ErroFFmpeg(RuntimeError):
    pass


@dataclass(frozen=True)
class Clipe:
    caminho: str  # relativo à pasta de trabalho (cwd do FFmpeg)
    duracao: float
    eh_video: bool = False


@dataclass(frozen=True)
class Sobreposicao:
    imagem: str
    inicio: float
    fim: float
    y: int = 240


def distribuir_duracoes(pesos: Sequence[int], total: float, minimo: float = 1.5) -> list[float]:
    """Divide o tempo da narração entre as cenas, proporcional às palavras de cada uma."""
    if not pesos:
        return []
    if total < minimo * len(pesos):
        return [round(total / len(pesos), 3)] * len(pesos)
    soma = sum(max(1, p) for p in pesos)
    duracoes = [max(minimo, total * max(1, p) / soma) for p in pesos]
    excesso = sum(duracoes) - total
    # tira o excesso das cenas mais longas, sem ficar abaixo do mínimo
    for i in sorted(range(len(duracoes)), key=lambda k: -duracoes[k]):
        if excesso <= 1e-9:
            break
        folga = duracoes[i] - minimo
        corte = min(folga, excesso)
        duracoes[i] -= corte
        excesso -= corte
    duracoes = [round(d, 3) for d in duracoes]
    duracoes[-1] = round(duracoes[-1] + (total - sum(duracoes)), 3)
    return duracoes


def _seguro(nome: str) -> str:
    if not _NOME_SEGURO.match(nome):
        raise ValueError(f"nome de arquivo inseguro para o filtro do FFmpeg: {nome!r}")
    return nome


def montar_comando(
    clipes: Sequence[Clipe],
    narracao: str,
    saida: str,
    *,
    musica: str | None = None,
    legendas: str | None = None,
    pasta_fontes: str | None = None,
    sobreposicoes: Sequence[Sobreposicao] = (),
    largura: int = 1080,
    altura: int = 1920,
    fps: int = 30,
    volume_musica: float = 0.12,
    zoom_maximo: float = 1.12,
    ffmpeg: str = "ffmpeg",
) -> list[str]:
    if not clipes:
        raise ValueError("nenhum clipe para montar")
    w, h = largura, altura
    cmd: list[str] = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]
    filtros: list[str] = []

    for i, c in enumerate(clipes):
        if c.eh_video:
            cmd += ["-stream_loop", "-1", "-t", f"{c.duracao:.3f}", "-i", c.caminho]
            filtros.append(
                f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
                f"fps={fps},trim=duration={c.duracao:.3f},setpts=PTS-STARTPTS,setsar=1,"
                f"format=yuv420p[v{i}]"
            )
        else:
            cmd += ["-i", c.caminho]
            quadros = max(1, round(c.duracao * fps))
            passo = (zoom_maximo - 1) / quadros
            if i % 2 == 0:  # alterna aproximar/afastar para não virar molde
                zoom = f"min(zoom+{passo:.6f},{zoom_maximo})"
            else:
                zoom = f"if(eq(on,0),{zoom_maximo},max(zoom-{passo:.6f},1))"
            filtros.append(
                f"[{i}:v]scale={2 * w}:{2 * h}:force_original_aspect_ratio=increase,"
                f"crop={2 * w}:{2 * h},zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':"
                f"y='ih/2-(ih/zoom/2)':d={quadros}:s={w}x{h}:fps={fps},setsar=1,"
                f"format=yuv420p[v{i}]"
            )

    indice = len(clipes)
    cmd += ["-i", narracao]
    i_narracao = indice
    indice += 1
    i_musica = None
    if musica:
        cmd += ["-stream_loop", "-1", "-i", musica]
        i_musica = indice
        indice += 1

    entradas = "".join(f"[v{i}]" for i in range(len(clipes)))
    filtros.append(f"{entradas}concat=n={len(clipes)}:v=1:a=0[base]")

    atual = "base"
    for k, s in enumerate(sobreposicoes):
        cmd += ["-i", s.imagem]
        filtros.append(
            f"[{atual}][{indice}:v]overlay=x=(main_w-overlay_w)/2:y={s.y}:"
            f"enable='between(t,{s.inicio:.2f},{s.fim:.2f})'[o{k}]"
        )
        atual = f"o{k}"
        indice += 1

    if legendas:
        filtro_legenda = f"subtitles=filename={_seguro(legendas)}"
        if pasta_fontes:
            filtro_legenda += f":fontsdir={_seguro(pasta_fontes)}"
        filtros.append(f"[{atual}]{filtro_legenda}[vout]")
    else:
        filtros.append(f"[{atual}]null[vout]")

    filtros.append(f"[{i_narracao}:a]loudnorm=I=-14:TP=-1.5:LRA=11[narr]")
    if i_musica is not None:
        filtros.append(
            f"[{i_musica}:a]volume={volume_musica:.3f}[mus];"
            "[narr][mus]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]"
        )
    else:
        filtros.append("[narr]anull[aout]")

    cmd += [
        "-filter_complex", ";".join(filtros),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-r", str(fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", "-y", saida,
    ]  # fmt: skip
    return cmd


def executar_ffmpeg(cmd: list[str], pasta: Path, timeout: int = 1200) -> None:
    """Roda o FFmpeg com cwd na pasta de trabalho do vídeo (os filtros usam nomes relativos)."""
    resultado = subprocess.run(  # noqa: S603 - lista de argumentos montada por nós, sem shell
        cmd, cwd=pasta, capture_output=True, text=True, timeout=timeout, check=False
    )
    if resultado.returncode != 0:
        cauda = (resultado.stderr or "").strip().splitlines()[-8:]
        raise ErroFFmpeg("FFmpeg falhou: " + " | ".join(cauda))
