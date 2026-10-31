"""Publicação em várias plataformas: contas por canal, legenda por plataforma e o que já saiu.

Nada aqui faz login nem guarda senha. O painel abre a página oficial de cada plataforma;
você sobe o MP4, cola o link do post e este módulo registra.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any

from estudio import db
from estudio.config import Canal, Plataforma, Registro
from estudio.tempo import agora, iso

SITUACOES_CONTA = ("planejada", "criada", "crescendo", "monetizando", "pausada")
SITUACOES_PUBLICACAO = ("pendente", "publicado", "pulado")
NUMERO_MAX = 10**12
RESOLVIDAS = ("publicado", "pulado")


class PublicacaoInvalida(ValueError):
    """Pedido sem sentido: plataforma fora do canal, link de outro site, vídeo não aprovado."""


# --------------------------------------------------------------------------- regras puras


def elegibilidade(plataforma: Plataforma, duracao_s: float | None) -> tuple[str, str]:
    """A duração conta para o programa desta plataforma? ('ok' | 'at' | 'ne', explicação)."""
    if not duracao_s:
        return "ne", "duração ainda desconhecida"
    if plataforma.duracao_min_s and duracao_s < plataforma.duracao_min_s:
        return "at", f"não rende: o programa pede {plataforma.duracao_min_s} s ou mais"
    if plataforma.duracao_max_s and duracao_s > plataforma.duracao_max_s:
        return "at", f"passa do limite de {plataforma.duracao_max_s} s"
    return "ok", "a duração conta para o programa"


def _hashtags(roteiro: dict[str, Any]) -> str:
    tags = []
    for bruto in roteiro.get("hashtags") or []:
        tag = str(bruto).strip().replace(" ", "")
        if tag:
            tags.append(tag if tag.startswith("#") else f"#{tag}")
    return " ".join(tags)


def legenda(plataforma: Plataforma, titulo: str, roteiro: dict[str, Any]) -> dict[str, str]:
    """Texto pronto para colar. 'titulo' só vem quando a plataforma tem campo próprio de título."""
    descricao = str(roteiro.get("descricao") or "").strip()
    tags = _hashtags(roteiro)
    if plataforma.legenda == "titulo_descricao":
        fontes = [str(f).strip() for f in roteiro.get("fontes") or [] if str(f).strip()]
        partes = [descricao, "Fontes: " + "; ".join(fontes) if fontes else "", tags]
        return {"titulo": titulo[:100], "texto": "\n\n".join(p for p in partes if p)}
    if plataforma.legenda == "curta":
        return {"titulo": "", "texto": " ".join(p for p in (titulo, tags) if p)}
    return {"titulo": "", "texto": "\n\n".join(p for p in (titulo, descricao, tags) if p)}


def progresso(plataforma: Plataforma, numeros: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {
            "chave": m.chave,
            "rotulo": m.rotulo,
            "alvo": m.alvo,
            "atual": int(numeros.get(m.chave, 0)),
            "pct": min(100, round(int(numeros.get(m.chave, 0)) / m.alvo * 100)),
        }
        for m in plataforma.metas
    ]


# --------------------------------------------------------------------------- contas


def obter_conta(con: sqlite3.Connection, canal_id: str, plataforma_id: str) -> dict[str, Any]:
    linha = con.execute(
        "SELECT * FROM contas WHERE canal_id = ? AND plataforma = ?", (canal_id, plataforma_id)
    ).fetchone()
    if linha is None:
        return {"usuario": "", "url": "", "situacao": "planejada", "seguranca": False,
                "numeros": {}, "atualizado_em": None}
    return {
        "usuario": linha["usuario"],
        "url": linha["url"],
        "situacao": linha["situacao"],
        "seguranca": bool(linha["seguranca"]),
        "numeros": json.loads(linha["numeros_json"] or "{}"),
        "atualizado_em": linha["atualizado_em"],
    }


def salvar_conta(
    con: sqlite3.Connection,
    canal: Canal,
    plataforma: Plataforma,
    *,
    usuario: str = "",
    url: str = "",
    situacao: str = "planejada",
    seguranca: bool = False,
    numeros: dict[str, int] | None = None,
) -> dict[str, Any]:
    if plataforma.id not in canal.plataformas:
        raise PublicacaoInvalida(f"o canal {canal.nome} não publica em {plataforma.nome}")
    if situacao not in SITUACOES_CONTA:
        raise PublicacaoInvalida(f"situação inválida: {situacao}")
    usuario = usuario.strip()
    if len(usuario) > 60 or any(c in usuario for c in " <>\"'"):
        raise PublicacaoInvalida("usuário: até 60 caracteres, sem espaços nem aspas")
    url = url.strip()
    if url and not plataforma.aceita_link(url):
        raise PublicacaoInvalida(
            f"link do perfil precisa ser https em {', '.join(plataforma.dominios)}"
        )
    numeros = dict(numeros or {})
    permitidas = {"seguidores"} | {m.chave for m in plataforma.metas}
    estranhas = sorted(set(numeros) - permitidas)
    if estranhas:
        raise PublicacaoInvalida(f"número desconhecido para {plataforma.nome}: {estranhas[0]}")
    if any(not 0 <= int(v) <= NUMERO_MAX for v in numeros.values()):
        raise PublicacaoInvalida("os números precisam ser positivos")
    con.execute(
        "INSERT INTO contas (canal_id, plataforma, usuario, url, situacao, seguranca, "
        "numeros_json, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(canal_id, plataforma) DO UPDATE SET usuario = excluded.usuario, "
        "url = excluded.url, situacao = excluded.situacao, seguranca = excluded.seguranca, "
        "numeros_json = excluded.numeros_json, atualizado_em = excluded.atualizado_em",
        (canal.slug, plataforma.id, usuario, url, situacao, int(seguranca),
         json.dumps({k: int(v) for k, v in numeros.items()}), iso(agora())),
    )
    con.commit()
    db.registrar_evento(con, "contas", f"{canal.slug}/{plataforma.id}", f"conta {situacao}", "info")
    return obter_conta(con, canal.slug, plataforma.id)


# --------------------------------------------------------------------------- publicações


def publicacoes_do_video(con: sqlite3.Connection, video_id: str) -> dict[str, dict[str, Any]]:
    return {
        r["plataforma"]: dict(r)
        for r in con.execute("SELECT * FROM publicacoes WHERE video_id = ?", (video_id,))
    }


def pendentes(registro: Registro, canal: Canal, feitas: dict[str, dict[str, Any]]) -> list[str]:
    return [
        p.id for p in registro.do_canal(canal)
        if feitas.get(p.id, {}).get("situacao") not in RESOLVIDAS
    ]


def marcar(
    con: sqlite3.Connection,
    registro: Registro,
    canais: dict[str, Canal],
    video_id: str,
    plataforma_id: str,
    situacao: str,
    url: str = "",
    momento: datetime | None = None,
) -> dict[str, Any]:
    """Registra o que aconteceu numa plataforma. O vídeo vira 'publicado' quando sai em ao menos
    uma; volta a 'aprovado' se você desfizer todas."""
    video = db.obter_video(con, video_id)
    if video is None:
        raise LookupError("vídeo não encontrado")
    if video["status"] not in ("aprovado", "publicado"):
        raise PublicacaoInvalida("só vídeos aprovados vão para as plataformas")
    canal = canais.get(video["canal_id"])
    plataforma = registro.plataformas.get(plataforma_id)
    if canal is None or plataforma is None or plataforma_id not in canal.plataformas:
        raise PublicacaoInvalida("esta plataforma não está na lista do canal")
    if situacao not in SITUACOES_PUBLICACAO:
        raise PublicacaoInvalida(f"situação inválida: {situacao}")
    url = url.strip() if situacao == "publicado" else ""
    if url and not plataforma.aceita_link(url):
        raise PublicacaoInvalida(
            f"o link do post precisa ser https em {', '.join(plataforma.dominios)}"
        )
    momento = momento or agora()
    con.execute(
        "INSERT INTO publicacoes (video_id, plataforma, situacao, url, publicado_em, "
        "atualizado_em) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(video_id, plataforma) DO UPDATE "
        "SET situacao = excluded.situacao, url = excluded.url, "
        # colar o link depois não muda a data em que o post saiu
        "publicado_em = CASE WHEN excluded.situacao = 'publicado' "
        "THEN COALESCE(publicacoes.publicado_em, excluded.publicado_em) ELSE NULL END, "
        "atualizado_em = excluded.atualizado_em",
        (video_id, plataforma_id, situacao, url,
         iso(momento) if situacao == "publicado" else None, iso(momento)),
    )
    con.commit()

    feitas = publicacoes_do_video(con, video_id)
    alguma = any(f["situacao"] == "publicado" for f in feitas.values())
    novo_status = "publicado" if alguma else "aprovado"
    if novo_status != video["status"]:
        db.atualizar_video(con, video_id, status=novo_status)
    titulo = video["titulo"] or video["tema"]
    db.registrar_evento(con, "publicar", plataforma_id, f"{titulo}: {situacao}",
                        "ok" if alguma else "info")
    return {
        "situacao": situacao,
        "url": url,
        "video_status": novo_status,
        "pendentes": pendentes(registro, canal, feitas),
    }
