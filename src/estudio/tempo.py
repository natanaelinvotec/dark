"""Relógio do projeto (fuso de São Paulo). Injetável nos testes."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from estudio.config import FUSO

TZ = ZoneInfo(FUSO)


def agora() -> datetime:
    return datetime.now(TZ)


def iso(momento: datetime | None = None) -> str:
    return (momento or agora()).isoformat(timespec="seconds")


def de_iso(texto: str) -> datetime:
    momento = datetime.fromisoformat(texto)
    return momento if momento.tzinfo else momento.replace(tzinfo=TZ)


def mes_de(momento: datetime | None = None) -> str:
    return (momento or agora()).strftime("%Y-%m")
