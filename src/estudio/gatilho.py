"""Gatilho de expansão: quando abrir o canal 3, 4, 5 (plano, seção 5)."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import timedelta

from estudio import db
from estudio.tempo import agora, iso


@dataclass(frozen=True)
class Semana:
    revisao_media_min: float
    melhor_media_views_short: float
    maior_inscritos: int
    avisos_politica: int
    horas_semana: float


def _num(con: sqlite3.Connection, chave: str) -> float:
    bruto = db.obter_config(con, chave)
    try:
        return float(bruto) if bruto else 0.0
    except ValueError:
        return 0.0


def medir(con: sqlite3.Connection) -> Semana:
    """Mede a semana atual. Views e inscritos vêm do coletor de métricas (config 'metrica:*')."""
    desde = iso(agora() - timedelta(days=7))
    linha = con.execute(
        "SELECT AVG(revisao_s) AS media, SUM(revisao_s) AS soma FROM videos "
        "WHERE revisao_s IS NOT NULL AND atualizado_em >= ?",
        (desde,),
    ).fetchone()
    media_s = linha["media"]
    soma_s = linha["soma"] or 0.0
    canais = [r["id"] for r in con.execute("SELECT id FROM canais WHERE ligado = 1")]
    return Semana(
        revisao_media_min=(media_s / 60) if media_s else _num(con, "metrica:revisao_media_min"),
        melhor_media_views_short=max(
            (_num(con, f"metrica:media_views_short:{c}") for c in canais), default=0.0
        ),
        maior_inscritos=int(max((_num(con, f"metrica:inscritos:{c}") for c in canais), default=0)),
        avisos_politica=int(_num(con, "metrica:avisos_politica")),
        horas_semana=(soma_s / 3600) if soma_s else _num(con, "metrica:horas_semana"),
    )


def condicoes(s: Semana) -> list[dict[str, object]]:
    """As 4 condições do plano, prontas para o painel."""
    return [
        {
            "nome": "Revisão de até 10 min por vídeo",
            "ok": 0 < s.revisao_media_min <= 10,
            "valor": f"Média: {s.revisao_media_min:.1f} min".replace(".", ","),
        },
        {
            "nome": "Um canal com 5 mil views por Short ou 1.000 inscritos",
            "ok": s.melhor_media_views_short >= 5000 or s.maior_inscritos >= 1000,
            "valor": f"Melhor média: {s.melhor_media_views_short / 1000:.1f} mil".replace(".", ","),
        },
        {
            "nome": "Nenhum aviso de política",
            "ok": s.avisos_politica == 0,
            "valor": f"{s.avisos_politica} aviso(s)",
        },
        {
            "nome": "Menos de 7 h por semana",
            "ok": s.horas_semana < 7,
            "valor": f"Esta semana: {s.horas_semana:.1f} h".replace(".", ","),
        },
    ]


def deve_abrir_proximo_canal(historico: list[Semana]) -> bool:
    """Decide se o próximo canal pode abrir.

    TODO (dono): esta regra é sua — é a decisão de negócio que protege os canais.
    O plano sugere: as 4 condições de `condicoes()` valendo em cada uma das últimas
    4 semanas de `historico` (a mais recente por último). Pense também em:
      - exigir as 4 semanas *seguidas* ou aceitar uma semana ruim no meio?
      - travar de vez se houver qualquer aviso de política no período?
    O painel ainda não chama esta função; quando ela existir, o canal 3 pode
    ser ligado automaticamente (ou só sugerido) a partir dela.
    """
    raise NotImplementedError("regra do dono: implemente deve_abrir_proximo_canal()")
