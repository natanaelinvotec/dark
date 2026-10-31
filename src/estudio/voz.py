"""Narração com a voz neural da Azure (REST). Uso comercial permitido pelo plano pago da Azure."""

from __future__ import annotations

import re
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import httpx

_REGIAO = re.compile(r"^[a-z0-9]{2,30}$")
_VOZ = re.compile(r"^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$")
_TAXA = re.compile(r"^[+-]?\d{1,2}%$")


class ErroVoz(RuntimeError):
    pass


def montar_ssml(texto: str, voz: str, taxa: str = "+8%") -> str:
    if not _VOZ.match(voz):
        raise ErroVoz(f"voz inválida: {voz!r}")
    if not _TAXA.match(taxa):
        raise ErroVoz(f"taxa inválida: {taxa!r}")
    idioma = voz[:5]
    return (
        f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
        f"xml:lang={quoteattr(idioma)}><voice name={quoteattr(voz)}>"
        f"<prosody rate={quoteattr(taxa)}>{escape(texto)}</prosody></voice></speak>"
    )


def sintetizar(
    texto: str,
    destino: Path,
    *,
    chave: str,
    regiao: str,
    voz: str,
    taxa: str = "+8%",
    cliente: httpx.Client | None = None,
) -> int:
    """Gera WAV 24 kHz mono. Devolve o número de caracteres cobrados."""
    if not chave:
        raise ErroVoz("AZURE_TTS_CHAVE não configurada")
    if not _REGIAO.match(regiao):
        raise ErroVoz(f"região inválida: {regiao!r}")
    url = f"https://{regiao}.tts.speech.microsoft.com/cognitiveservices/v1"
    corpo = montar_ssml(texto, voz, taxa).encode("utf-8")
    cabecalhos = {
        "Ocp-Apim-Subscription-Key": chave,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "estudio-canais",
    }
    proprio = cliente is None
    cliente = cliente or httpx.Client(timeout=90)
    try:
        resposta = cliente.post(url, content=corpo, headers=cabecalhos)
    finally:
        if proprio:
            cliente.close()
    if resposta.status_code != 200:
        raise ErroVoz(f"Azure respondeu {resposta.status_code}")
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(resposta.content)
    return len(texto)
