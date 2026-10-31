"""Ações do dono na fila: aprovar, refazer, rejeitar e desfazer (com auditoria)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta

from estudio.config import Canal
from estudio.db import (
    atualizar_video,
    definir_etapa,
    etapas_do_video,
    obter_video,
    registrar_evento,
)
from estudio.tempo import TZ, agora, iso

ACOES = ("aprovar", "refazer", "rejeitar", "desfazer")
_ORIGEM = {
    "aprovar": {"fila"},
    "refazer": {"fila", "reprovado"},
    "rejeitar": {"fila", "reprovado", "voce"},
}
_DESTINO = {"aprovar": "aprovado", "refazer": "refazer", "rejeitar": "rejeitado"}
_FOLGA = timedelta(minutes=30)


class AcaoInvalida(ValueError):
    """A ação não vale para o estado atual do vídeo."""


def proximo_horario(
    con: sqlite3.Connection, canal: Canal, momento: datetime, dias: int = 14
) -> str | None:
    """Primeiro horário livre do canal a partir de agora + 30 min."""
    ocupados = {
        linha["horario"]
        for linha in con.execute(
            "SELECT horario FROM videos WHERE canal_id = ? AND horario IS NOT NULL "
            "AND status IN ('aprovado', 'publicado')",
            (canal.slug,),
        )
    }
    base = momento.astimezone(TZ)
    for dia in range(dias):
        data = (base + timedelta(days=dia)).date()
        for hora in canal.horarios:
            h, m = (int(x) for x in hora.split(":"))
            candidato = datetime(data.year, data.month, data.day, h, m, tzinfo=TZ)
            if candidato >= base + _FOLGA and iso(candidato) not in ocupados:
                return iso(candidato)
    return None


def _auditar(
    con: sqlite3.Connection, video_id: str, acao: str, nota: str, antes: str, depois: str
) -> None:
    con.execute(
        "INSERT INTO acoes (ts, video_id, acao, nota, status_anterior, status_novo) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (iso(), video_id, acao, nota[:500], antes, depois),
    )
    con.commit()


def executar_acao(
    con: sqlite3.Connection,
    video_id: str,
    acao: str,
    canais: dict[str, Canal],
    *,
    nota: str = "",
    revisao_s: float | None = None,
    momento: datetime | None = None,
) -> sqlite3.Row:
    video = obter_video(con, video_id)
    if video is None:
        raise LookupError("vídeo não encontrado")
    if acao not in ACOES:
        raise AcaoInvalida(f"ação desconhecida: {acao}")
    if acao == "desfazer":
        return _desfazer(con, video)

    status = video["status"]
    if status not in _ORIGEM[acao]:
        raise AcaoInvalida(f"não dá para {acao} um vídeo com status '{status}'")

    campos: dict[str, object] = {"status": _DESTINO[acao]}
    if acao == "aprovar":
        canal = canais.get(video["canal_id"])
        if canal is None:
            raise AcaoInvalida("canal do vídeo não está configurado")
        horario = proximo_horario(con, canal, momento or agora())
        if horario is None:
            raise AcaoInvalida("nenhum horário livre nos próximos 14 dias")
        campos["horario"] = horario
        if revisao_s is not None and 0 < revisao_s < 6 * 3600:
            campos["revisao_s"] = round(revisao_s, 1)
    if acao == "refazer":
        campos["nota_refazer"] = nota.strip()[:500]

    atualizar_video(con, video_id, **campos)
    _auditar(con, video_id, acao, nota, status, str(campos["status"]))
    registrar_evento(con, "fila", video_id, f"{acao}: {video['titulo'] or video['tema']}", "info")
    return obter_video(con, video_id)  # type: ignore[return-value]


def _desfazer(con: sqlite3.Connection, video: sqlite3.Row) -> sqlite3.Row:
    ultima = con.execute(
        "SELECT * FROM acoes WHERE video_id = ? AND acao != 'desfazer' ORDER BY id DESC LIMIT 1",
        (video["id"],),
    ).fetchone()
    if ultima is None or ultima["status_novo"] != video["status"]:
        raise AcaoInvalida("nada para desfazer")
    campos: dict[str, object] = {"status": ultima["status_anterior"]}
    if ultima["acao"] == "aprovar":
        campos["horario"] = None
    if ultima["acao"] == "refazer":
        campos["nota_refazer"] = ""
    atualizar_video(con, video["id"], **campos)
    _auditar(con, video["id"], "desfazer", "", video["status"], ultima["status_anterior"])
    return obter_video(con, video["id"])  # type: ignore[return-value]


def pular_gancho(con: sqlite3.Connection, video_id: str) -> None:
    """Segue sem o gancho animado (só quando a etapa está esperando o dono)."""
    etapas = etapas_do_video(con, video_id)
    linha = etapas.get("gancho")
    if linha is None or linha["status"] != "voce":
        raise AcaoInvalida("o gancho deste vídeo não está esperando você")
    definir_etapa(con, video_id, "gancho", "pulado", "seguiu sem gancho")
    atualizar_video(con, video_id, status="produzindo")
    registrar_evento(con, "gancho", video_id, "seguiu sem gancho animado", "info")
