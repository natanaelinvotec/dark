"""Banco SQLite: esquema e funções de acesso usadas pelo pipeline e pelo painel."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from estudio.config import Canal
from estudio.tempo import agora, iso, mes_de

ETAPAS: tuple[str, ...] = (
    "pauta",
    "roteiro",
    "checagem",
    "quadros",
    "gancho",
    "voz",
    "montagem",
    "testes",
)
STATUS_ETAPA = ("espera", "rodando", "voce", "feito", "erro", "pulado")
STATUS_VIDEO = (
    "pauta",
    "produzindo",
    "voce",
    "fila",
    "reprovado",
    "aprovado",
    "rejeitado",
    "refazer",
    "publicado",
)
NIVEIS = ("ok", "run", "at", "cr", "info")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS canais (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cor TEXT NOT NULL,
    ligado INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    canal_id TEXT NOT NULL REFERENCES canais(id),
    titulo TEXT NOT NULL DEFAULT '',
    serie TEXT NOT NULL DEFAULT '',
    referencia TEXT NOT NULL DEFAULT '',
    tema TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pauta',
    roteiro_json TEXT,
    duracao_s REAL,
    arquivo TEXT,
    horario TEXT,
    aviso TEXT NOT NULL DEFAULT '',
    nota_refazer TEXT NOT NULL DEFAULT '',
    revisao_s REAL,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_videos_status ON videos(status);
CREATE TABLE IF NOT EXISTS etapas (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    etapa TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'espera',
    nota TEXT NOT NULL DEFAULT '',
    atualizado_em TEXT NOT NULL,
    PRIMARY KEY (video_id, etapa)
);
CREATE TABLE IF NOT EXISTS testes (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    nome TEXT NOT NULL,
    status TEXT NOT NULL,
    detalhe TEXT NOT NULL DEFAULT '',
    ordem INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (video_id, nome)
);
CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    etapa TEXT NOT NULL,
    alvo TEXT NOT NULL,
    msg TEXT NOT NULL,
    nivel TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    video_id TEXT NOT NULL,
    acao TEXT NOT NULL,
    nota TEXT NOT NULL DEFAULT '',
    status_anterior TEXT NOT NULL,
    status_novo TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    mes TEXT NOT NULL,
    fornecedor TEXT NOT NULL,
    valor_brl REAL NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    detalhe TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ativos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    fonte TEXT NOT NULL,
    url_origem TEXT NOT NULL DEFAULT '',
    autor TEXT NOT NULL DEFAULT '',
    licenca TEXT NOT NULL DEFAULT '',
    caminho TEXT NOT NULL,
    sha256 TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metricas_dia (
    data TEXT NOT NULL,
    canal_id TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (data, canal_id)
);
CREATE TABLE IF NOT EXISTS receitas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mes TEXT NOT NULL,
    fonte TEXT NOT NULL,
    valor_brl REAL NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'prevista'
);
CREATE TABLE IF NOT EXISTS campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT '',
    valor_mil_usd REAL NOT NULL DEFAULT 0,
    teto_views INTEGER NOT NULL DEFAULT 0,
    views_aprovadas INTEGER NOT NULL DEFAULT 0,
    horas REAL NOT NULL DEFAULT 0,
    situacao TEXT NOT NULL DEFAULT 'em analise'
);
CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
"""


def conectar(caminho: Path | str) -> sqlite3.Connection:
    if str(caminho) != ":memory:":
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    # FastAPI pode abrir e usar a conexão em threads diferentes do pool; cada requisição
    # tem a sua conexão, então desligar a checagem de thread é seguro aqui.
    con = sqlite3.connect(str(caminho), timeout=15, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    if str(caminho) != ":memory:":
        con.execute("PRAGMA journal_mode = WAL")
    return con


def inicializar(con: sqlite3.Connection) -> None:
    con.executescript(ESQUEMA)
    con.commit()


def sincronizar_canais(con: sqlite3.Connection, canais: Iterable[Canal]) -> None:
    """Insere canais novos e atualiza nome/cor. O liga/desliga do painel é preservado;
    um canal com enabled: false no YAML fica sempre desligado."""
    for c in canais:
        con.execute(
            """INSERT INTO canais (id, nome, cor, ligado) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, cor = excluded.cor,
               ligado = CASE WHEN ? = 0 THEN 0 ELSE canais.ligado END""",
            (c.slug, c.nome, c.cor, int(c.enabled), int(c.enabled)),
        )
    con.commit()


# --------------------------------------------------------------------------- config


def obter_config(con: sqlite3.Connection, chave: str, padrao: str = "") -> str:
    linha = con.execute("SELECT valor FROM config WHERE chave = ?", (chave,)).fetchone()
    return linha["valor"] if linha else padrao


def definir_config(con: sqlite3.Connection, chave: str, valor: str) -> None:
    con.execute(
        "INSERT INTO config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )
    con.commit()


# --------------------------------------------------------------------------- eventos e custos


def registrar_evento(
    con: sqlite3.Connection, etapa: str, alvo: str, msg: str, nivel: str = "info"
) -> None:
    if nivel not in NIVEIS:
        nivel = "info"
    con.execute(
        "INSERT INTO eventos (ts, etapa, alvo, msg, nivel) VALUES (?, ?, ?, ?, ?)",
        (iso(), etapa[:20], alvo[:80], msg[:300], nivel),
    )
    con.commit()


def registrar_custo(
    con: sqlite3.Connection,
    fornecedor: str,
    valor_brl: float,
    *,
    tokens_in: int = 0,
    tokens_out: int = 0,
    detalhe: str = "",
) -> None:
    momento = agora()
    con.execute(
        "INSERT INTO custos (ts, mes, fornecedor, valor_brl, tokens_in, tokens_out, detalhe) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (iso(momento), mes_de(momento), fornecedor, round(valor_brl, 4), tokens_in, tokens_out,
         detalhe[:200]),
    )
    con.commit()


FORNECEDORES_IA = ("gemini", "azure")


def gasto_ia_mes(con: sqlite3.Connection, mes: str | None = None) -> float:
    """Só o que conta para o teto de IA (sem servidor, assinatura etc.)."""
    return sum(gasto_mes(con, mes, fornecedor=f) for f in FORNECEDORES_IA)


def gasto_mes(
    con: sqlite3.Connection, mes: str | None = None, fornecedor: str | None = None
) -> float:
    mes = mes or mes_de()
    if fornecedor:
        linha = con.execute(
            "SELECT COALESCE(SUM(valor_brl), 0) AS t FROM custos WHERE mes = ? AND fornecedor = ?",
            (mes, fornecedor),
        ).fetchone()
    else:
        linha = con.execute(
            "SELECT COALESCE(SUM(valor_brl), 0) AS t FROM custos WHERE mes = ?", (mes,)
        ).fetchone()
    return float(linha["t"])


# --------------------------------------------------------------------------- vídeos e etapas


def criar_video(
    con: sqlite3.Connection,
    canal_id: str,
    tema: str,
    *,
    serie: str = "",
    referencia: str = "",
) -> str:
    vid = uuid.uuid4().hex[:12]
    momento = iso()
    con.execute(
        "INSERT INTO videos (id, canal_id, tema, serie, referencia, status, criado_em, "
        "atualizado_em) VALUES (?, ?, ?, ?, ?, 'pauta', ?, ?)",
        (vid, canal_id, tema[:300], serie[:120], referencia[:120], momento, momento),
    )
    con.executemany(
        "INSERT INTO etapas (video_id, etapa, status, atualizado_em) VALUES (?, ?, ?, ?)",
        [(vid, e, "feito" if e == "pauta" else "espera", momento) for e in ETAPAS],
    )
    con.commit()
    return vid


def obter_video(con: sqlite3.Connection, video_id: str) -> sqlite3.Row | None:
    return con.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()


def atualizar_video(con: sqlite3.Connection, video_id: str, **campos: Any) -> None:
    permitidos = {
        "titulo", "serie", "referencia", "tema", "status", "roteiro_json", "duracao_s",
        "arquivo", "horario", "aviso", "nota_refazer", "revisao_s",
    }
    desconhecidos = set(campos) - permitidos
    if desconhecidos:
        raise ValueError(f"campos não permitidos: {sorted(desconhecidos)}")
    if "status" in campos and campos["status"] not in STATUS_VIDEO:
        raise ValueError(f"status inválido: {campos['status']}")
    if not campos:
        return
    sets = ", ".join(f"{k} = ?" for k in campos)  # nomes vêm da lista fixa acima
    valores = [*campos.values(), iso(), video_id]
    con.execute(f"UPDATE videos SET {sets}, atualizado_em = ? WHERE id = ?", valores)  # noqa: S608
    con.commit()


def etapas_do_video(con: sqlite3.Connection, video_id: str) -> dict[str, sqlite3.Row]:
    linhas = con.execute(
        "SELECT * FROM etapas WHERE video_id = ?", (video_id,)
    ).fetchall()
    return {linha["etapa"]: linha for linha in linhas}


def definir_etapa(
    con: sqlite3.Connection, video_id: str, etapa: str, status: str, nota: str = ""
) -> None:
    if etapa not in ETAPAS or status not in STATUS_ETAPA:
        raise ValueError(f"etapa/status inválidos: {etapa}/{status}")
    con.execute(
        "UPDATE etapas SET status = ?, nota = ?, atualizado_em = ? "
        "WHERE video_id = ? AND etapa = ?",
        (status, nota[:300], iso(), video_id, etapa),
    )
    con.commit()


def reabrir_etapas(con: sqlite3.Connection, video_id: str, a_partir_de: str) -> None:
    """Volta para 'espera' a etapa indicada e todas as seguintes."""
    indice = ETAPAS.index(a_partir_de)
    for etapa in ETAPAS[indice:]:
        definir_etapa(con, video_id, etapa, "espera")


def proxima_etapa(con: sqlite3.Connection, video_id: str) -> str | None:
    etapas = etapas_do_video(con, video_id)
    for etapa in ETAPAS:
        linha = etapas.get(etapa)
        if linha is None or linha["status"] not in ("feito", "pulado"):
            return etapa
    return None


@dataclass(frozen=True)
class Teste:
    nome: str
    status: str  # ok | at | cr
    detalhe: str = ""


def gravar_testes(con: sqlite3.Connection, video_id: str, testes: Sequence[Teste]) -> None:
    con.execute("DELETE FROM testes WHERE video_id = ?", (video_id,))
    con.executemany(
        "INSERT INTO testes (video_id, nome, status, detalhe, ordem) VALUES (?, ?, ?, ?, ?)",
        [(video_id, t.nome, t.status, t.detalhe[:300], i) for i, t in enumerate(testes)],
    )
    con.commit()


def registrar_ativo(
    con: sqlite3.Connection,
    video_id: str,
    *,
    fonte: str,
    caminho: str,
    licenca: str,
    url_origem: str = "",
    autor: str = "",
    sha256: str = "",
) -> None:
    con.execute(
        "INSERT INTO ativos (video_id, fonte, url_origem, autor, licenca, caminho, sha256, "
        "criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (video_id, fonte, url_origem[:500], autor[:120], licenca[:200], caminho, sha256, iso()),
    )
    con.commit()


def roteiro_de(linha: sqlite3.Row) -> dict[str, Any] | None:
    bruto = linha["roteiro_json"]
    return json.loads(bruto) if bruto else None
