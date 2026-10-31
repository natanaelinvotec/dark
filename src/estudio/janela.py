"""Janela de missão (pergaminho dourado) desenhada por código: texto sempre correto em português."""

from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont

from estudio.config import EstiloJanela
from estudio.esquemas import Janela

log = logging.getLogger(__name__)

ROTULOS = {
    "MISSAO": "Missão recebida",
    "MISSAO_OCULTA": "Missão oculta",
    "ITEM": "Item obtido",
    "STATUS": "Status",
    "ALERTA": "Alerta",
}

Fonte = ImageFont.FreeTypeFont | ImageFont.ImageFont


def _fonte(pasta: Path, arquivo: str, tamanho: int, peso: int) -> Fonte:
    caminho = pasta / arquivo
    if caminho.is_file():
        fonte = ImageFont.truetype(str(caminho), tamanho)
        try:  # fontes variáveis (Google Fonts): escolhe o peso
            fonte.set_variation_by_axes([peso])
        except (OSError, AttributeError, ValueError):
            pass
        return fonte
    log.warning("fonte %s não encontrada em %s; usando a padrão do Pillow", arquivo, pasta)
    return ImageFont.load_default(size=tamanho)


def _quebrar(texto: str, fonte: Fonte, largura: int, desenho: ImageDraw.ImageDraw) -> list[str]:
    linhas: list[str] = []
    atual = ""
    for palavra in texto.split():
        tentativa = f"{atual} {palavra}".strip()
        if desenho.textlength(tentativa, font=fonte) <= largura or not atual:
            atual = tentativa
        else:
            linhas.append(atual)
            atual = palavra
    if atual:
        linhas.append(atual)
    return linhas


def _rgba(hexa: str, alfa: int = 255) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(hexa)[:3]
    return (r, g, b, alfa)


def desenhar_janela(
    janela: Janela, estilo: EstiloJanela, pasta_fontes: Path, largura: int = 900
) -> Image.Image:
    cores = estilo.cores
    pad, margem, raio = 40, 30, 26
    titulo_f = _fonte(pasta_fontes, estilo.fonte_titulo, 44, 700)
    ref_f = _fonte(pasta_fontes, estilo.fonte_texto, 30, 800)
    principal_f = _fonte(pasta_fontes, estilo.fonte_texto, 50, 800)
    detalhe_f = _fonte(pasta_fontes, estilo.fonte_texto, 34, 600)

    rascunho = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    util = largura - 2 * pad
    linhas_principal = _quebrar(janela.titulo, principal_f, util, rascunho)
    linhas_detalhe = _quebrar(janela.detalhe, detalhe_f, util, rascunho) if janela.detalhe else []
    altura = pad + 52 + 26 + len(linhas_principal) * 62 + len(linhas_detalhe) * 44 + pad
    if linhas_detalhe:
        altura += 12

    imagem = Image.new("RGBA", (largura + 2 * margem, altura + 2 * margem), (0, 0, 0, 0))
    caixa = (margem, margem, margem + largura, margem + altura)

    brilho = Image.new("RGBA", imagem.size, (0, 0, 0, 0))
    ImageDraw.Draw(brilho).rounded_rectangle(
        caixa, radius=raio, outline=_rgba(cores.borda, 170), width=12
    )
    imagem = Image.alpha_composite(imagem, brilho.filter(ImageFilter.GaussianBlur(14)))

    d = ImageDraw.Draw(imagem)
    d.rounded_rectangle(
        caixa, radius=raio, fill=_rgba(cores.fundo, 240), outline=_rgba(cores.borda), width=4
    )
    x, y = margem + pad, margem + pad
    rotulo = ROTULOS.get(janela.tipo, janela.tipo.title())
    d.text((x, y), rotulo, font=titulo_f, fill=_rgba(cores.titulo))
    if janela.referencia:
        largura_ref = d.textlength(janela.referencia, font=ref_f)
        d.text((margem + largura - pad - largura_ref, y + 10), janela.referencia, font=ref_f,
               fill=_rgba(cores.destaque))
    y += 52 + 10
    d.line((x, y, margem + largura - pad, y), fill=_rgba(cores.borda, 110), width=2)
    y += 16
    for linha in linhas_principal:
        d.text((x, y), linha, font=principal_f, fill=_rgba(cores.texto))
        y += 62
    if linhas_detalhe:
        y += 12
        for linha in linhas_detalhe:
            d.text((x, y), linha, font=detalhe_f, fill=_rgba(cores.texto, 225))
            y += 44
    return imagem


def salvar_janela(
    janela: Janela, estilo: EstiloJanela, pasta_fontes: Path, destino: Path
) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    desenhar_janela(janela, estilo, pasta_fontes).save(destino, "PNG")
    return destino
