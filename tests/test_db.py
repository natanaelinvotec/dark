from __future__ import annotations

import pytest

from estudio import db


def test_inicializar_e_idempotente(con):
    db.inicializar(con)
    db.inicializar(con)
    tabelas = {r["name"] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"videos", "etapas", "testes", "acoes", "custos", "config"} <= tabelas


def test_criar_video_cria_todas_as_etapas(con):
    vid = db.criar_video(con, "curiosidades", "Relâmpagos do Catatumbo")
    etapas = db.etapas_do_video(con, vid)
    assert set(etapas) == set(db.ETAPAS)
    assert etapas["pauta"]["status"] == "feito"
    assert db.proxima_etapa(con, vid) == "roteiro"


def test_reabrir_etapas_volta_as_seguintes(con):
    vid = db.criar_video(con, "curiosidades", "x")
    for etapa in db.ETAPAS:
        db.definir_etapa(con, vid, etapa, "feito")
    db.reabrir_etapas(con, vid, "montagem")
    etapas = db.etapas_do_video(con, vid)
    assert etapas["voz"]["status"] == "feito"
    assert etapas["montagem"]["status"] == "espera"
    assert etapas["testes"]["status"] == "espera"
    assert db.proxima_etapa(con, vid) == "montagem"


def test_atualizar_video_recusa_campo_e_status_desconhecidos(con):
    vid = db.criar_video(con, "curiosidades", "x")
    with pytest.raises(ValueError):
        db.atualizar_video(con, vid, senha="x")
    with pytest.raises(ValueError):
        db.atualizar_video(con, vid, status="sumiu")


def test_custos_somam_por_mes(con):
    db.registrar_custo(con, "gemini", 1.5)
    db.registrar_custo(con, "azure", 0.25)
    assert db.gasto_mes(con) == pytest.approx(1.75)
    assert db.gasto_mes(con, fornecedor="gemini") == pytest.approx(1.5)
    db.registrar_custo(con, "vps", 60)
    assert db.gasto_ia_mes(con) == pytest.approx(1.75)


def test_sincronizar_preserva_desligado_pelo_painel(con, canais):
    con.execute("UPDATE canais SET ligado = 0 WHERE id = 'curiosidades'")
    db.sincronizar_canais(con, canais.values())
    ligado = con.execute("SELECT ligado FROM canais WHERE id = 'curiosidades'").fetchone()[0]
    assert ligado == 0


def test_config_chave_valor(con):
    assert db.obter_config(con, "x", "padrao") == "padrao"
    db.definir_config(con, "x", "1")
    db.definir_config(con, "x", "2")
    assert db.obter_config(con, "x") == "2"
