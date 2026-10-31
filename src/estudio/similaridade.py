"""Mede o quanto um roteiro se parece com os anteriores (defesa contra 'conteúdo repetitivo')."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

_PALAVRA = re.compile(r"[a-z0-9]+")


def normalizar(texto: str) -> list[str]:
    sem_acento = unicodedata.normalize("NFKD", texto.lower())
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return _PALAVRA.findall(sem_acento)


def shingles(texto: str, n: int = 3) -> set[tuple[str, ...]]:
    palavras = normalizar(texto)
    if len(palavras) < n:
        return {tuple(palavras)} if palavras else set()
    return {tuple(palavras[i : i + n]) for i in range(len(palavras) - n + 1)}


def jaccard(a: str, b: str, n: int = 3) -> float:
    sa, sb = shingles(a, n), shingles(b, n)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def mais_parecido(texto: str, anteriores: Iterable[tuple[str, str]]) -> tuple[float, str | None]:
    """Recebe (id, texto) anteriores e devolve (maior similaridade, id do mais parecido)."""
    melhor, quem = 0.0, None
    for ident, outro in anteriores:
        valor = jaccard(texto, outro)
        if valor > melhor:
            melhor, quem = valor, ident
    return melhor, quem
