"""Legendas palavra a palavra: transcrição (faster-whisper) → blocos → arquivo ASS."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Palavra:
    texto: str
    inicio: float
    fim: float


@dataclass(frozen=True)
class Bloco:
    palavras: tuple[Palavra, ...]

    @property
    def inicio(self) -> float:
        return self.palavras[0].inicio

    @property
    def fim(self) -> float:
        return self.palavras[-1].fim


@dataclass(frozen=True)
class EstiloLegenda:
    fonte: str = "Manrope"
    tamanho: int = 74
    cor: str = "#FFFFFF"
    destaque: str = "#FFD700"
    contorno: int = 6
    margem_v: int = 520  # distância da base; fica acima da interface do Shorts/TikTok


def transcrever(audio: Path, modelo: str = "small") -> list[Palavra]:
    """Precisa do extra 'voz' (faster-whisper). Roda em CPU com int8."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as erro:  # pragma: no cover - depende do extra instalado
        raise RuntimeError("instale o extra de voz: uv sync --extra voz") from erro
    whisper = WhisperModel(modelo, device="cpu", compute_type="int8")
    segmentos, _ = whisper.transcribe(str(audio), language="pt", word_timestamps=True)
    palavras: list[Palavra] = []
    for segmento in segmentos:
        for w in segmento.words or []:
            texto = w.word.strip()
            if texto:
                palavras.append(Palavra(texto, float(w.start), float(w.end)))
    return palavras


def agrupar(palavras: Sequence[Palavra], max_palavras: int = 3, pausa: float = 0.6) -> list[Bloco]:
    blocos: list[Bloco] = []
    atual: list[Palavra] = []
    for p in palavras:
        quebra = atual and (
            len(atual) >= max_palavras
            or p.inicio - atual[-1].fim > pausa
            or atual[-1].texto.endswith((".", "!", "?"))
        )
        if quebra:
            blocos.append(Bloco(tuple(atual)))
            atual = []
        atual.append(p)
    if atual:
        blocos.append(Bloco(tuple(atual)))
    return blocos


def tempo_ass(segundos: float) -> str:
    centesimos = max(0, round(segundos * 100))
    h, resto = divmod(centesimos, 360000)
    m, resto = divmod(resto, 6000)
    s, cs = divmod(resto, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _cor_ass(hexa: str) -> str:
    """#RRGGBB → &H00BBGGRR (formato do estilo, com alfa)."""
    r, g, b = hexa[1:3], hexa[3:5], hexa[5:7]
    return f"&H00{b}{g}{r}".upper()


def _cor_tag(hexa: str) -> str:
    """#RRGGBB → &HBBGGRR (formato da tag \\c, sem alfa)."""
    r, g, b = hexa[1:3], hexa[3:5], hexa[5:7]
    return f"&H{b}{g}{r}".upper()


def _limpar(texto: str) -> str:
    """Tira o que o ASS interpretaria como comando ({, }, \\)."""
    return texto.replace("{", "").replace("}", "").replace("\\", "").replace("\n", " ")


ESTILO_PADRAO = EstiloLegenda()


def gerar_ass(blocos: Sequence[Bloco], estilo: EstiloLegenda = ESTILO_PADRAO) -> str:
    cabecalho = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n"
        "WrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, "
        "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Padrao,{estilo.fonte},{estilo.tamanho},{_cor_ass(estilo.cor)},&H000000FF,"
        f"&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{estilo.contorno},2,2,60,60,"
        f"{estilo.margem_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    destaque = _cor_tag(estilo.destaque)
    normal = _cor_tag(estilo.cor)
    linhas: list[str] = []
    for bloco in blocos:
        textos = [_limpar(p.texto) for p in bloco.palavras]
        for i, palavra in enumerate(bloco.palavras):
            inicio = palavra.inicio
            fim = bloco.palavras[i + 1].inicio if i + 1 < len(bloco.palavras) else bloco.fim
            if fim <= inicio:
                fim = inicio + 0.05
            partes = [
                f"{{\\c{destaque}&}}{t}{{\\c{normal}&}}" if j == i else t
                for j, t in enumerate(textos)
            ]
            texto = " ".join(partes)
            tempos = f"{tempo_ass(inicio)},{tempo_ass(fim)}"
            linhas.append(f"Dialogue: 0,{tempos},Padrao,,0,0,0,,{texto}")
    return cabecalho + "\n".join(linhas) + "\n"


def cobertura(blocos: Sequence[Bloco], duracao_audio: float) -> float:
    """Fração do áudio com fala legendada (usada no teste de legenda)."""
    if duracao_audio <= 0 or not blocos:
        return 0.0
    coberto = sum(max(0.0, b.fim - b.inicio) for b in blocos)
    fala_estimada = max(blocos[-1].fim - blocos[0].inicio, 0.001)
    return min(1.0, coberto / fala_estimada)
