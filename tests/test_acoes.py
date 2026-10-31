from __future__ import annotations

from datetime import datetime

import pytest

from estudio import db
from estudio.acoes import AcaoInvalida, executar_acao, proximo_horario, pular_gancho
from estudio.tempo import TZ
from tests.conftest import colocar_na_fila

MOMENTO = datetime(2026, 11, 1, 11, 40, tzinfo=TZ)


def test_proximo_horario_respeita_folga_de_30_min(con, canais):
    horario = proximo_horario(con, canais["biblico-manhwa"], MOMENTO)
    assert horario == "2026-11-01T19:00:00-03:00"


def test_aprovar_agenda_e_audita(con, canais):
    vid = colocar_na_fila(con)
    video = executar_acao(con, vid, "aprovar", canais, momento=MOMENTO, revisao_s=420)
    assert video["status"] == "aprovado"
    assert video["horario"] == "2026-11-01T19:00:00-03:00"
    assert video["revisao_s"] == 420
    acao = con.execute("SELECT * FROM acoes WHERE video_id = ?", (vid,)).fetchone()
    assert (acao["acao"], acao["status_anterior"], acao["status_novo"]) == (
        "aprovar",
        "fila",
        "aprovado",
    )


def test_segundo_aprovado_pega_o_proximo_horario(con, canais):
    a = colocar_na_fila(con)
    b = colocar_na_fila(con)
    executar_acao(con, a, "aprovar", canais, momento=MOMENTO)
    video_b = executar_acao(con, b, "aprovar", canais, momento=MOMENTO)
    assert video_b["horario"] == "2026-11-02T12:00:00-03:00"


def test_nao_aprova_fora_da_fila(con, canais):
    vid = db.criar_video(con, "biblico-manhwa", "x")
    with pytest.raises(AcaoInvalida):
        executar_acao(con, vid, "aprovar", canais)


def test_desfazer_volta_ao_estado_anterior_uma_vez(con, canais):
    vid = colocar_na_fila(con)
    executar_acao(con, vid, "aprovar", canais, momento=MOMENTO)
    video = executar_acao(con, vid, "desfazer", canais)
    assert video["status"] == "fila"
    assert video["horario"] is None
    with pytest.raises(AcaoInvalida):
        executar_acao(con, vid, "desfazer", canais)


def test_refazer_guarda_a_nota_e_rejeitar_vale_para_reprovado(con, canais):
    a = colocar_na_fila(con)
    video = executar_acao(con, a, "refazer", canais, nota="trocar o quadro 4")
    assert video["status"] == "refazer"
    assert video["nota_refazer"] == "trocar o quadro 4"

    b = colocar_na_fila(con)
    db.atualizar_video(con, b, status="reprovado")
    assert executar_acao(con, b, "rejeitar", canais)["status"] == "rejeitado"


def test_acao_desconhecida_e_video_inexistente(con, canais):
    vid = colocar_na_fila(con)
    with pytest.raises(AcaoInvalida):
        executar_acao(con, vid, "publicar", canais)
    with pytest.raises(LookupError):
        executar_acao(con, "nao-existe", "aprovar", canais)


def test_pular_gancho_so_quando_espera_o_dono(con):
    vid = db.criar_video(con, "biblico-manhwa", "x")
    with pytest.raises(AcaoInvalida):
        pular_gancho(con, vid)
    db.definir_etapa(con, vid, "gancho", "voce")
    pular_gancho(con, vid)
    assert db.etapas_do_video(con, vid)["gancho"]["status"] == "pulado"
