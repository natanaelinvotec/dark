"""Consultas do painel: o banco vira JSON pronto para cada tela (uma tela por pergunta)."""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

from estudio import __version__, db
from estudio.acoes import proximo_horario
from estudio.config import Canal, Config
from estudio.gatilho import condicoes, medir
from estudio.tempo import agora, de_iso, iso, mes_de

NIVEL_ORDEM = {"cr": 0, "at": 1, "in": 2}


def _conta(con: sqlite3.Connection, sql: str, params: tuple = ()) -> int:
    return int(con.execute(sql, params).fetchone()[0] or 0)


def _soma_views(con: sqlite3.Connection, desde: str, ate: str, canal: str | None = None) -> int:
    if canal:
        return _conta(
            con,
            "SELECT SUM(views) FROM metricas_dia WHERE data >= ? AND data < ? AND canal_id = ?",
            (desde, ate, canal),
        )
    return _conta(con, "SELECT SUM(views) FROM metricas_dia WHERE data >= ? AND data < ?",
                  (desde, ate))


def _num_config(con: sqlite3.Connection, chave: str) -> float | None:
    bruto = db.obter_config(con, chave)
    try:
        return float(bruto) if bruto else None
    except ValueError:
        return None


def _horas_desde(texto: str | None, momento: datetime) -> float | None:
    if not texto:
        return None
    return (momento - de_iso(texto)).total_seconds() / 3600


def _canal_json(canais: dict[str, Canal], canal_id: str) -> dict[str, str]:
    c = canais.get(canal_id)
    return {"id": canal_id, "nome": c.nome if c else canal_id, "cor": c.cor if c else "#56676A"}


# --------------------------------------------------------------------------- visão geral


def resumo(con: sqlite3.Connection, cfg: Config, canais: dict[str, Canal]) -> dict[str, Any]:
    momento = agora()
    hoje = momento.date()
    prontos = _conta(con, "SELECT COUNT(*) FROM videos WHERE status = 'fila'")
    reprovados = _conta(con, "SELECT COUNT(*) FROM videos WHERE status = 'reprovado'")
    por_canal = [
        {**_canal_json(canais, r["canal_id"]), "n": r["n"]}
        for r in con.execute(
            "SELECT canal_id, COUNT(*) AS n FROM videos WHERE status IN ('fila', 'reprovado') "
            "GROUP BY canal_id ORDER BY n DESC"
        )
    ]

    sete = iso(momento - timedelta(days=7))
    publicados = _conta(
        con,
        "SELECT COUNT(*) FROM videos WHERE status IN ('aprovado', 'publicado') "
        "AND horario >= ? AND horario <= ?",
        (sete, iso(momento)),
    )
    ligados = [c for c in canais.values() if _ligado(con, c.slug)]
    planejados = sum(len(c.horarios) for c in ligados) * 7

    views7 = _soma_views(con, (hoje - timedelta(days=7)).isoformat(), hoje.isoformat())
    views_ant = _soma_views(
        con, (hoje - timedelta(days=14)).isoformat(), (hoje - timedelta(days=7)).isoformat()
    )
    variacao = round((views7 - views_ant) / views_ant * 100) if views_ant else None

    mes = mes_de(momento)
    receitas = [
        dict(r)
        for r in con.execute(
            "SELECT fonte, SUM(valor_brl) AS valor FROM receitas WHERE mes = ? GROUP BY fonte",
            (mes,),
        )
    ]

    dias = [(hoje - timedelta(days=14 - i)).isoformat() for i in range(14)]
    series: dict[str, list[int]] = {}
    for r in con.execute(
        "SELECT data, canal_id, views FROM metricas_dia WHERE data >= ? ORDER BY data", (dias[0],)
    ):
        series.setdefault(r["canal_id"], [0] * 14)
        if r["data"] in dias:
            series[r["canal_id"]][dias.index(r["data"])] = r["views"]

    return {
        "numeros_em": db.obter_config(con, "worker_batimento") or iso(momento),
        "exemplo": db.obter_config(con, "dados_exemplo") == "1",
        "kpis": {
            "esperando": prontos + reprovados,
            "prontos": prontos,
            "reprovados": reprovados,
            "por_canal": por_canal,
            "publicados_7d": publicados,
            "planejados_7d": planejados,
            "views_7d": views7,
            "variacao_views": variacao,
            "receita_prevista": sum(r["valor"] or 0 for r in receitas),
            "receitas": receitas,
        },
        "grafico": {
            "dias": dias,
            "series": [
                {**_canal_json(canais, cid), "valores": vals}
                if cid in canais
                else {"id": cid, "nome": cid.title(), "cor": "#B7791F", "valores": vals}
                for cid, vals in series.items()
            ],
        },
        "precisa": precisa_de_voce(con, cfg, canais, momento),
        "linha": linha_de_producao(con),
        "gatilho": condicoes(medir(con)),
    }


def _ligado(con: sqlite3.Connection, canal_id: str) -> bool:
    linha = con.execute("SELECT ligado FROM canais WHERE id = ?", (canal_id,)).fetchone()
    return bool(linha and linha["ligado"])


def precisa_de_voce(
    con: sqlite3.Connection, cfg: Config, canais: dict[str, Canal], momento: datetime
) -> list[dict[str, Any]]:
    itens: list[dict[str, Any]] = []
    batimento = _horas_desde(db.obter_config(con, "worker_batimento"), momento)
    if db.obter_config(con, "dados_exemplo") != "1" and (batimento is None or batimento > 0.25):
        itens.append({"nivel": "cr", "titulo": "O worker não está rodando",
                      "detalhe": "Nenhum ciclo nos últimos 15 minutos", "rota": "saude"})

    reprovados = con.execute(
        "SELECT t.nome FROM testes t JOIN videos v ON v.id = t.video_id "
        "WHERE v.status = 'reprovado' AND t.status = 'cr'"
    ).fetchall()
    n_reprov = _conta(con, "SELECT COUNT(*) FROM videos WHERE status = 'reprovado'")
    if n_reprov:
        nomes = sorted({r["nome"].split()[0].lower() for r in reprovados})
        itens.append({"nivel": "cr", "titulo": f"{n_reprov} vídeo(s) reprovado(s) nos testes",
                      "detalhe": "Falhou: " + ", ".join(nomes), "rota": "aprovacao/reprovados"})

    for v in con.execute(
        "SELECT v.id, v.titulo, v.tema, e.etapa, e.nota FROM videos v "
        "JOIN etapas e ON e.video_id = v.id WHERE e.status = 'erro' LIMIT 5"
    ):
        itens.append({"nivel": "cr", "titulo": f"Erro na etapa {v['etapa']}",
                      "detalhe": f"{v['titulo'] or v['tema']}: {v['nota']}", "rota": "producao"})

    antigo = con.execute(
        "SELECT MIN(atualizado_em) FROM videos WHERE status = 'fila'"
    ).fetchone()[0]
    n_fila = _conta(con, "SELECT COUNT(*) FROM videos WHERE status = 'fila'")
    if n_fila:
        horas = _horas_desde(antigo, momento) or 0
        itens.append({"nivel": "at", "titulo": f"{n_fila} vídeo(s) esperando aprovação",
                      "detalhe": f"O mais antigo está na fila há {horas:.0f} h",
                      "rota": "aprovacao"})

    restantes = _num_config(con, "creditos_flow_restantes")
    total = _num_config(con, "creditos_flow_total") or 1000
    if restantes is not None and restantes / total < 0.25:
        itens.append({"nivel": "at", "titulo": f"Restam {restantes:.0f} créditos do Flow",
                      "detalhe": f"Dá para uns {restantes // 20:.0f} ganchos", "rota": "dinheiro"})

    for v in con.execute(
        "SELECT v.id, v.titulo, v.tema, e.etapa, e.nota FROM videos v "
        "JOIN etapas e ON e.video_id = v.id WHERE e.status = 'voce' LIMIT 5"
    ):
        itens.append({"nivel": "in", "titulo": f"{v['titulo'] or v['tema']} espera você",
                      "detalhe": v["nota"] or f"etapa {v['etapa']}", "rota": "producao"})

    gasto = db.gasto_ia_mes(con)
    if cfg.teto_mes_brl > 0 and gasto / cfg.teto_mes_brl >= 0.6:
        itens.append({"nivel": "in" if gasto < cfg.teto_mes_brl * 0.85 else "at",
                      "titulo": f"IA em {gasto / cfg.teto_mes_brl:.0%} do teto",
                      "detalhe": f"R$ {gasto:.0f} de R$ {cfg.teto_mes_brl:.0f} neste mês",
                      "rota": "dinheiro"})

    itens.sort(key=lambda i: NIVEL_ORDEM.get(i["nivel"], 9))
    return itens


def linha_de_producao(con: sqlite3.Connection) -> list[dict[str, Any]]:
    contagem = {e: {"total": 0, "voce": 0, "rodando": 0, "erro": 0} for e in db.ETAPAS[1:]}
    for v in con.execute(
        "SELECT id FROM videos WHERE status IN ('pauta', 'produzindo', 'voce', 'refazer')"
    ):
        etapa = db.proxima_etapa(con, v["id"])
        if etapa in contagem:
            status = db.etapas_do_video(con, v["id"])[etapa]["status"]
            contagem[etapa]["total"] += 1
            if status in ("voce", "rodando", "erro"):
                contagem[etapa][status] += 1
    linha = [{"etapa": e, **c} for e, c in contagem.items()]
    linha.append({"etapa": "fila", "total": _conta(
        con, "SELECT COUNT(*) FROM videos WHERE status IN ('fila', 'reprovado')"),
        "voce": 0, "rodando": 0, "erro": 0})
    return linha


# --------------------------------------------------------------------------- aprovação


ABAS = {
    "fila": ("Na fila", "status IN ('fila', 'reprovado')"),
    "prontos": ("Prontos", "status = 'fila'"),
    "reprovados": ("Para refazer", "status = 'reprovado'"),
    "agendados": ("Agendados", "status = 'aprovado'"),
}


def _janela_do_roteiro(bruto: str | None) -> dict[str, str] | None:
    if not bruto:
        return None
    try:
        janelas = json.loads(bruto).get("janelas") or []
    except (ValueError, AttributeError):
        return None
    if not janelas:
        return None
    j = janelas[0]
    return {"tipo": j.get("tipo", ""), "titulo": j.get("titulo", ""),
            "referencia": j.get("referencia", "")}


def fila(
    con: sqlite3.Connection, cfg: Config, canais: dict[str, Canal], aba: str
) -> dict[str, Any]:
    if aba not in ABAS:
        aba = "fila"
    abas = [
        {"id": chave, "rotulo": rotulo,
         "n": _conta(con, f"SELECT COUNT(*) FROM videos WHERE {condicao}")}  # noqa: S608
        for chave, (rotulo, condicao) in ABAS.items()
    ]
    linhas = con.execute(
        f"SELECT * FROM videos WHERE {ABAS[aba][1]} ORDER BY atualizado_em"  # noqa: S608
    ).fetchall()
    momento = agora()
    itens = []
    for v in linhas:
        testes = [
            dict(t)
            for t in con.execute(
                "SELECT nome, status, detalhe FROM testes WHERE video_id = ? ORDER BY ordem",
                (v["id"],),
            )
        ]
        canal = canais.get(v["canal_id"])
        sugestao = (
            proximo_horario(con, canal, momento)
            if canal and v["status"] == "fila"
            else None
        )
        itens.append({
            "id": v["id"],
            "canal": _canal_json(canais, v["canal_id"]),
            "titulo": v["titulo"] or v["tema"],
            "serie": v["serie"],
            "referencia": v["referencia"],
            "status": v["status"],
            "duracao": v["duracao_s"],
            "horario": v["horario"],
            "horario_sugerido": sugestao,
            "aviso": v["aviso"],
            "testes": testes,
            "tem_previa": bool(v["arquivo"]) and (cfg.dados / v["arquivo"]).is_file(),
            "janela": _janela_do_roteiro(v["roteiro_json"]),
        })
    return {"aba": aba, "abas": abas, "itens": itens}


# --------------------------------------------------------------------------- produção


def producao(con: sqlite3.Connection, canais: dict[str, Canal]) -> dict[str, Any]:
    videos = []
    for v in con.execute(
        "SELECT * FROM videos WHERE status IN ('pauta', 'produzindo', 'voce', 'refazer') "
        "ORDER BY criado_em DESC LIMIT 30"
    ):
        etapas = db.etapas_do_video(con, v["id"])
        lista = [
            {"etapa": e, "status": etapas[e]["status"], "nota": etapas[e]["nota"]}
            for e in db.ETAPAS[1:]
            if e in etapas
        ]
        atual = next((x for x in lista if x["status"] in ("voce", "erro")), None)
        videos.append({
            "id": v["id"],
            "canal": _canal_json(canais, v["canal_id"]),
            "titulo": v["titulo"] or v["tema"],
            "serie": v["serie"],
            "referencia": v["referencia"],
            "etapas": lista,
            "destaque": atual,
        })
    eventos = [
        dict(e)
        for e in con.execute(
            "SELECT ts, etapa, alvo, msg, nivel FROM eventos ORDER BY id DESC LIMIT 40"
        )
    ]
    return {"videos": videos, "eventos": eventos}


# --------------------------------------------------------------------------- canais e séries


def lista_canais(con: sqlite3.Connection, canais: dict[str, Canal]) -> dict[str, Any]:
    hoje = agora().date()
    momento = iso()
    resultado = []
    for c in canais.values():
        linha = con.execute("SELECT ligado FROM canais WHERE id = ?", (c.slug,)).fetchone()
        revisao = con.execute(
            "SELECT AVG(revisao_s) FROM videos WHERE canal_id = ? AND revisao_s IS NOT NULL",
            (c.slug,),
        ).fetchone()[0]
        proxima = con.execute(
            "SELECT MIN(horario) FROM videos WHERE canal_id = ? AND status = 'aprovado' "
            "AND horario >= ?",
            (c.slug, momento),
        ).fetchone()[0]
        inscritos = _num_config(con, f"metrica:inscritos:{c.slug}")
        views90 = _soma_views(
            con, (hoje - timedelta(days=90)).isoformat(), hoje.isoformat(), c.slug
        )
        resultado.append({
            "id": c.slug,
            "nome": c.nome,
            "cor": c.cor,
            "descricao": c.descricao,
            "ligado": bool(linha and linha["ligado"]),
            "permitido": c.enabled,
            "inscritos": inscritos,
            "seguidores_tiktok": _num_config(con, f"metrica:seguidores_tiktok:{c.slug}"),
            "views_30d": _soma_views(
                con, (hoje - timedelta(days=30)).isoformat(), hoje.isoformat(), c.slug
            ),
            "media_por_short": _num_config(con, f"metrica:media_views_short:{c.slug}"),
            "revisao_min": round(revisao / 60, 1) if revisao else None,
            "avisos": int(_num_config(con, f"metrica:avisos:{c.slug}") or 0),
            "proxima": proxima,
            "ypp": {"inscritos": inscritos, "inscritos_meta": 500,
                    "views_90d": views90, "views_meta": 3_000_000},
        })
    return {"canais": resultado, "gatilho": condicoes(medir(con))}


def series(con: sqlite3.Connection, canais: dict[str, Canal]) -> list[dict[str, Any]]:
    grupos: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for v in con.execute(
        "SELECT id, canal_id, serie, titulo, tema, referencia, status FROM videos "
        "WHERE serie != '' ORDER BY criado_em"
    ):
        grupos.setdefault((v["canal_id"], v["serie"]), []).append({
            "id": v["id"], "titulo": v["titulo"] or v["tema"], "referencia": v["referencia"],
            "status": v["status"],
        })
    return [
        {"canal": _canal_json(canais, canal_id), "serie": serie, "episodios": eps,
         "personagens": [p.model_dump() for p in canais[canal_id].personagens]
         if canal_id in canais else []}
        for (canal_id, serie), eps in grupos.items()
    ]


# --------------------------------------------------------------------------- dinheiro


def dinheiro(con: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    mes = mes_de()
    receitas = [
        dict(r)
        for r in con.execute(
            "SELECT fonte, SUM(valor_brl) AS valor FROM receitas WHERE mes = ? GROUP BY fonte",
            (mes,),
        )
    ]
    custos = [
        dict(r)
        for r in con.execute(
            "SELECT fornecedor, SUM(valor_brl) AS valor FROM custos WHERE mes = ? "
            "GROUP BY fornecedor ORDER BY valor DESC",
            (mes,),
        )
    ]
    ai_pro = _num_config(con, "preco_ai_pro_brl")
    receita = sum(r["valor"] or 0 for r in receitas)
    gasto = sum(c["valor"] or 0 for c in custos) + (ai_pro or 0)
    cambio = _num_config(con, "cambio_usd_brl") or cfg.cambio_usd_brl
    campanhas = []
    for c in con.execute("SELECT * FROM campanhas ORDER BY id"):
        a_receber = c["views_aprovadas"] / 1000 * c["valor_mil_usd"] * cambio
        campanhas.append({
            **dict(c),
            "a_receber_brl": round(a_receber, 2),
            "rs_hora": round(a_receber / c["horas"], 2) if c["horas"] else None,
        })
    return {
        "mes": mes,
        "receitas": receitas,
        "custos": custos,
        "ai_pro_brl": ai_pro,
        "receita": receita,
        "gasto": gasto,
        "sobra": receita - gasto,
        "gemini": {"gasto": db.gasto_mes(con, fornecedor="gemini"), "teto": cfg.teto_mes_brl},
        "flow": {
            "restantes": _num_config(con, "creditos_flow_restantes"),
            "total": _num_config(con, "creditos_flow_total") or 1000,
        },
        "cambio": cambio,
        "campanhas": campanhas,
    }


# --------------------------------------------------------------------------- configuração e saúde

FAIXAS_CONFIG = {
    "preco_entrada_milhao_brl": (0, 10_000),
    "preco_saida_milhao_brl": (0, 10_000),
    "preco_tts_milhao_chars_brl": (0, 10_000),
    "preco_ai_pro_brl": (0, 2_000),
    "cambio_usd_brl": (1, 20),
    "creditos_flow_restantes": (0, 100_000),
    "creditos_flow_total": (1, 100_000),
}


def config_publica(con: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    return {
        "valores": {chave: db.obter_config(con, chave) for chave in FAIXAS_CONFIG},
        "teto_mes_brl": cfg.teto_mes_brl,
        "modelo": cfg.gemini_modelo,
        "voz": cfg.azure_voz,
        "chaves": cfg.chaves_configuradas(),
    }


def salvar_config(con: sqlite3.Connection, valores: dict[str, Any]) -> dict[str, str]:
    """Valida tudo antes de gravar. Devolve {campo: erro} (vazio = salvo)."""
    erros: dict[str, str] = {}
    limpos: dict[str, str] = {}
    for chave, bruto in valores.items():
        if chave not in FAIXAS_CONFIG:
            erros[chave] = "campo desconhecido"
            continue
        texto = str(bruto).strip().replace(",", ".")
        if texto == "":
            limpos[chave] = ""
            continue
        try:
            numero = float(texto)
        except ValueError:
            erros[chave] = "precisa ser um número"
            continue
        minimo, maximo = FAIXAS_CONFIG[chave]
        if not minimo <= numero <= maximo:
            erros[chave] = f"entre {minimo} e {maximo}"
            continue
        limpos[chave] = f"{numero:g}"
    if not erros:
        for chave, valor in limpos.items():
            db.definir_config(con, chave, valor)
    return erros


@lru_cache(maxsize=1)
def _versao_ffmpeg() -> str | None:
    caminho = shutil.which("ffmpeg")
    if not caminho:
        return None
    try:
        saida = subprocess.run(  # noqa: S603 - binário localizado, argumentos fixos
            [caminho, "-version"], capture_output=True, text=True, timeout=10, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return saida.splitlines()[0] if saida else None


def saude(con: sqlite3.Connection, cfg: Config) -> dict[str, Any]:
    momento = agora()
    batimento = db.obter_config(con, "worker_batimento")
    idade = _horas_desde(batimento, momento)
    disco = None
    if cfg.dados.exists():
        uso = shutil.disk_usage(cfg.dados)
        disco = {"livre_gb": round(uso.free / 1e9, 1), "total_gb": round(uso.total / 1e9, 1)}
    ultimo = con.execute(
        "SELECT ts, etapa, alvo, msg, nivel FROM eventos ORDER BY id DESC LIMIT 1"
    ).fetchone()
    desde = iso(momento - timedelta(hours=24))
    return {
        "versao": __version__,
        "worker": {"batimento": batimento,
                   "minutos": round(idade * 60) if idade is not None else None},
        "ultimo_evento": dict(ultimo) if ultimo else None,
        "erros_24h": _conta(con, "SELECT COUNT(*) FROM eventos WHERE nivel = 'cr' AND ts >= ?",
                            (desde,)),
        "ffmpeg": _versao_ffmpeg(),
        "pasta_dados": cfg.dados.is_dir(),
        "fontes": sorted(p.name for p in cfg.fontes_dir.glob("*.ttf"))
        if cfg.fontes_dir.is_dir() else [],
        "disco": disco,
        "status": {
            r["status"]: r["n"]
            for r in con.execute("SELECT status, COUNT(*) AS n FROM videos GROUP BY status")
        },
    }
