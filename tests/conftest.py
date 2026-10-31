from __future__ import annotations

import pytest

from estudio import db
from estudio.config import RAIZ, Config, carregar_canais


@pytest.fixture
def canais():
    return carregar_canais(RAIZ / "channels")


@pytest.fixture
def cfg(tmp_path):
    return Config(
        dados=tmp_path / "drive",
        db=tmp_path / "estudio.db",
        canais_dir=RAIZ / "channels",
        fontes_dir=tmp_path / "fontes",
        segredo_sessao="s" * 48,
    )


@pytest.fixture
def con(cfg, canais):
    conexao = db.conectar(cfg.db)
    db.inicializar(conexao)
    db.sincronizar_canais(conexao, canais.values())
    yield conexao
    conexao.close()


def colocar_na_fila(con, canal="biblico-manhwa", titulo="Davi recebe a missão") -> str:
    vid = db.criar_video(con, canal, "tema de teste")
    for etapa in db.ETAPAS:
        db.definir_etapa(con, vid, etapa, "feito")
    db.atualizar_video(con, vid, status="fila", titulo=titulo)
    return vid
