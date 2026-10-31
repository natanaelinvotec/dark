"""Senha (scrypt), limite de tentativas e guarda de caminho."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

_N, _R, _P, _TAM = 2**14, 8, 1, 32


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).decode().rstrip("=")


def _de_b64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def gerar_hash(senha: str) -> str:
    sal = secrets.token_bytes(16)
    chave = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=_TAM)
    return f"scrypt${_N}${_R}${_P}${_b64(sal)}${_b64(chave)}"


def verificar_senha(senha: str, guardado: str) -> bool:
    try:
        algoritmo, n, r, p, sal, chave = guardado.split("$")
        if algoritmo != "scrypt":
            return False
        calculada = hashlib.scrypt(
            senha.encode(), salt=_de_b64(sal), n=int(n), r=int(r), p=int(p),
            dklen=len(_de_b64(chave)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calculada, _de_b64(chave))


class LimitadorTentativas:
    """Até `maximo` falhas por IP numa janela de `janela_s` segundos (um processo só)."""

    def __init__(self, maximo: int = 10, janela_s: float = 900):
        self.maximo = maximo
        self.janela_s = janela_s
        self._falhas: dict[str, deque[float]] = defaultdict(deque)

    def _limpar(self, ip: str, agora: float) -> deque[float]:
        fila = self._falhas[ip]
        while fila and agora - fila[0] > self.janela_s:
            fila.popleft()
        return fila

    def bloqueado(self, ip: str, agora: float | None = None) -> bool:
        return len(self._limpar(ip, agora or time.monotonic())) >= self.maximo

    def registrar_falha(self, ip: str, agora: float | None = None) -> None:
        momento = agora or time.monotonic()
        self._limpar(ip, momento).append(momento)

    def zerar(self, ip: str) -> None:
        self._falhas.pop(ip, None)


def dentro_de(base: Path, relativo: str) -> Path | None:
    """Resolve `relativo` dentro de `base`; devolve None se escapar (../, link, absoluto)."""
    if not relativo:
        return None
    alvo = (base / relativo).resolve()
    raiz = base.resolve()
    if alvo != raiz and alvo.is_relative_to(raiz) and alvo.is_file():
        return alvo
    return None
