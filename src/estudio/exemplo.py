"""Dados de exemplo (os mesmos do mockup) para conhecer o painel sem gastar API."""

from __future__ import annotations

import sqlite3
from datetime import timedelta

from estudio import db
from estudio.db import Teste
from estudio.tempo import agora, mes_de


def _video(
    con: sqlite3.Connection,
    canal: str,
    titulo: str,
    *,
    serie: str = "",
    referencia: str = "",
    status: str,
    etapas: dict[str, str] | None = None,
    duracao: float | None = None,
    aviso: str = "",
    testes: list[Teste] | None = None,
) -> str:
    vid = db.criar_video(con, canal, titulo, serie=serie, referencia=referencia)
    padrao = "feito" if status in ("fila", "reprovado", "aprovado", "publicado") else "espera"
    for etapa in db.ETAPAS:
        # a pauta já existe para todo vídeo; 'espera' nela faria o worker procurar uma função
        inicial = "feito" if etapa == "pauta" else padrao
        db.definir_etapa(con, vid, etapa, (etapas or {}).get(etapa, inicial))
    db.atualizar_video(
        con, vid, titulo=titulo, status=status, duracao_s=duracao, aviso=aviso
    )
    if testes:
        db.gravar_testes(con, vid, testes)
    return vid


def _ok(nome: str) -> Teste:
    return Teste(nome, "ok")


def _padrao(
    similaridade: float, checagem: Teste | None = None, legenda: Teste | None = None
) -> list[Teste]:
    rotulo = f"Similaridade {similaridade:.2f}".replace(".", ",")
    return [
        _ok("Formato 9:16"),
        _ok("Áudio -14 LUFS"),
        _ok("Tela preta"),
        _ok("Silêncio"),
        legenda or _ok("Legenda"),
        _ok("Licenças"),
        Teste(rotulo, "ok" if similaridade < 0.45 else "cr"),
        checagem or _ok("Checagem"),
    ]


def carregar_exemplo(con: sqlite3.Connection) -> None:
    if db.obter_config(con, "dados_exemplo") == "1":
        return
    serie = "Temporada Davi"
    _video(con, "biblico-manhwa", "O gigante de Gate desafia Israel", serie=serie,
           referencia="1 Samuel 17:1-10", status="publicado", duracao=55.0,
           testes=_padrao(0.12))
    _video(con, "biblico-manhwa", "O gigante que desafiou um exército por 40 dias", serie=serie,
           referencia="1 Samuel 17:11-16", status="fila", duracao=58.0, testes=_padrao(0.22))
    _video(con, "biblico-manhwa", "Davi recebe a missão que ninguém queria", serie=serie,
           referencia="1 Samuel 17:17-30", status="fila", duracao=54.0,
           aviso="Altura de Golias: o texto massorético diz 6 côvados e 1 palmo; outros "
                 "manuscritos dizem 4 → confira 1 Samuel 17:4",
           testes=_padrao(0.18, checagem=Teste("Checagem: 1 aviso(s)", "at")))
    _video(con, "biblico-manhwa", "O pastor que já tinha enfrentado um leão e um urso",
           serie=serie, referencia="1 Samuel 17:31-37", status="fila", duracao=57.0,
           testes=_padrao(0.25))
    _video(con, "biblico-manhwa", "Davi recusa a armadura do rei", serie=serie,
           referencia="1 Samuel 17:38-39", status="voce",
           etapas={"roteiro": "feito", "checagem": "feito", "quadros": "voce", "voz": "feito"})
    _video(con, "biblico-manhwa", "Cinco pedras lisas do riacho", serie=serie,
           referencia="1 Samuel 17:40-51", status="produzindo", etapas={"roteiro": "rodando"})
    _video(con, "curiosidades", "O planeta onde chove vidro de lado", status="fila",
           duracao=52.0, testes=_padrao(0.14))
    legenda_atrasada = Teste("Legenda", "cr", "atrasada 0,8 s a partir de 0:31")
    _video(con, "curiosidades", "Por que o pôr do sol em Marte é azul", status="reprovado",
           duracao=49.0, testes=_padrao(0.19, legenda=legenda_atrasada))
    _video(con, "curiosidades", "O som mais alto já registrado", status="reprovado",
           duracao=55.0, testes=_padrao(0.72))
    _video(con, "curiosidades", "Os relâmpagos que quase não param no Catatumbo",
           status="produzindo",
           etapas={e: "feito" for e in ("roteiro", "checagem", "quadros", "voz", "montagem")}
           | {"gancho": "pulado", "testes": "rodando"})
    _video(con, "curiosidades", "A árvore mais solitária do mundo", status="produzindo",
           etapas={e: "feito" for e in ("roteiro", "checagem", "quadros", "voz")}
           | {"gancho": "pulado", "montagem": "erro"})

    hoje = agora().date()
    biblico = [11.2, 12.8, 13.5, 12.1, 14.9, 16.2, 15.4, 14.8, 17.3, 16.9, 18.4, 17.7, 19.2, 20.1]
    curio = [7.4, 8.1, 7.9, 8.8, 9.2, 8.6, 9.9, 10.4, 9.7, 10.8, 11.2, 10.6, 11.9, 12.3]
    clip = [3.1, 4.2, 5.6, 4.8, 6.1, 7.4, 6.9, 5.8, 7.2, 8.1, 6.6, 7.9, 8.4, 9.2]
    for i in range(14):
        dia = (hoje - timedelta(days=14 - i)).isoformat()
        for canal, serie_views in (("biblico-manhwa", biblico), ("curiosidades", curio),
                                   ("clipping", clip)):
            con.execute(
                "INSERT OR REPLACE INTO metricas_dia (data, canal_id, views) VALUES (?, ?, ?)",
                (dia, canal, int(serie_views[i] * 1000)),
            )

    for fornecedor, valor in (("gemini", 96.0), ("azure", 22.0), ("vps", 60.0)):
        db.registrar_custo(con, fornecedor, valor, detalhe="exemplo")
    mes = mes_de()
    con.executemany(
        "INSERT INTO receitas (mes, fonte, valor_brl, situacao) VALUES (?, ?, ?, ?)",
        [(mes, "clipping", 890.0, "prevista"), (mes, "afiliados", 350.0, "prevista")],
    )
    con.executemany(
        "INSERT INTO campanhas (nome, tipo, valor_mil_usd, teto_views, views_aprovadas, horas, "
        "situacao) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("Campanha A", "podcast", 1.0, 300000, 128000, 7.0, "aprovada"),
            ("Campanha B", "aplicativo", 0.7, 150000, 61500, 4.0, "em analise"),
        ],
    )
    eventos = [
        ("montagem", "curiosidades/tenere", 'erro: nenhum asset vertical para "acacia desert"',
         "cr"),
        ("quadros", "biblico-manhwa/davi-05", "esperando você: 10 prompts gerados", "at"),
        ("roteiro", "biblico-manhwa/davi-06", "gerando (Gemini API)", "run"),
        ("checagem", "curiosidades/catatumbo", "0 avisos, 4 fontes conferidas", "ok"),
        ("voz", "curiosidades/catatumbo", "WAV 0:56, -14,1 LUFS", "ok"),
        ("montagem", "curiosidades/catatumbo", "MP4 1080×1920, 0:56", "ok"),
        ("testes", "curiosidades/catatumbo", "rodando 6 de 8 checagens", "run"),
    ]
    for etapa, alvo, msg, nivel in eventos:
        db.registrar_evento(con, etapa, alvo, msg, nivel)
    metricas = {
        "metrica:revisao_media_min": "8.4",
        "metrica:horas_semana": "6.5",
        "metrica:avisos_politica": "0",
        "metrica:media_views_short:biblico-manhwa": "3100",
        "metrica:media_views_short:curiosidades": "2200",
        "metrica:inscritos:biblico-manhwa": "940",
        "metrica:inscritos:curiosidades": "680",
        "metrica:seguidores_tiktok:biblico-manhwa": "3860",
        "metrica:seguidores_tiktok:curiosidades": "2140",
        "creditos_flow_restantes": "180",
        "creditos_flow_total": "1000",
    }
    for chave, valor in metricas.items():
        db.definir_config(con, chave, valor)
    db.definir_config(con, "dados_exemplo", "1")
    con.commit()
