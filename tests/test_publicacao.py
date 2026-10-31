from __future__ import annotations

import pytest

from estudio.config import RAIZ, carregar_plataformas, conferir_plataformas, host_aceito
from estudio.publicacao import (
    PublicacaoInvalida,
    elegibilidade,
    legenda,
    progresso,
    salvar_conta,
)


@pytest.fixture
def registro():
    return carregar_plataformas(RAIZ / "plataformas.yaml")


def test_registro_tem_as_6_plataformas_com_links_https(registro):
    assert list(registro.plataformas) == [
        "youtube", "tiktok", "facebook", "instagram", "kwai", "snapchat",
    ]
    for p in registro.plataformas.values():
        assert all(not u or u.startswith("https://") for u in p.urls.model_dump().values())
    assert registro.plataformas["kwai"].publicacao == "app"


def test_host_aceito_so_https_do_dominio_certo():
    dom = ["tiktok.com"]
    assert host_aceito("https://www.tiktok.com/@x", dom)
    assert host_aceito("https://tiktok.com", dom)
    assert not host_aceito("http://www.tiktok.com", dom)
    assert not host_aceito("https://tiktok.com.golpe.io/x", dom)
    assert not host_aceito("https://faketiktok.com", dom)
    assert not host_aceito("https://eu:senha@tiktok.com", dom)
    assert not host_aceito("javascript:alert(1)", dom)
    assert not host_aceito("https://golpe.com\\.tiktok.com/x", dom)  # '\' vira '/' no navegador
    assert not host_aceito("https://golpe.com%2f.tiktok.com/x", dom)
    assert host_aceito("HTTPS://WWW.TIKTOK.COM/@x", dom)


def test_canal_com_plataforma_desconhecida_falha_cedo(registro, canais):
    errado = canais["curiosidades"].model_copy(update={"plataformas": ["youtube", "orkut"]})
    with pytest.raises(ValueError, match="orkut"):
        conferir_plataformas({"curiosidades": errado}, registro)
    conferir_plataformas(canais, registro)  # os canais do repositório estão certos


def test_link_fora_do_dominio_no_yaml_e_recusado(tmp_path):
    arquivo = tmp_path / "plataformas.yaml"
    arquivo.write_text(
        "verificado_em: 2026-10-31\nplataformas:\n  - id: x\n    nome: X\n"
        "    dominios: [x.com]\n    urls: {subir: 'https://golpe.io/up'}\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="urls.subir"):
        carregar_plataformas(arquivo)


def test_legenda_muda_com_a_plataforma(registro):
    roteiro = {"descricao": "Raios quase sem parar.", "hashtags": ["#ciencia", "raios"],
               "fontes": ["NASA"]}
    yt = legenda(registro.plataformas["youtube"], "Catatumbo", roteiro)
    assert yt["titulo"] == "Catatumbo"
    assert "Fontes: NASA" in yt["texto"] and "#raios" in yt["texto"]
    tk = legenda(registro.plataformas["tiktok"], "Catatumbo", roteiro)
    assert tk == {"titulo": "", "texto": "Catatumbo\n\nRaios quase sem parar.\n\n#ciencia #raios"}
    snap = legenda(registro.plataformas["snapchat"], "Catatumbo", roteiro)
    assert snap["texto"] == "Catatumbo #ciencia #raios"


def test_elegibilidade_pela_duracao(registro):
    tiktok, facebook, snap = (registro.plataformas[p] for p in ("tiktok", "facebook", "snapchat"))
    assert elegibilidade(tiktok, 55)[0] == "at"
    assert elegibilidade(tiktok, 66)[0] == "ok"
    assert elegibilidade(facebook, 95)[0] == "at"
    assert elegibilidade(snap, 25)[0] == "at"
    assert elegibilidade(tiktok, None)[0] == "ne"


def test_conta_valida_dados_e_mostra_progresso(con, canais, registro):
    tiktok = registro.plataformas["tiktok"]
    canal = canais["curiosidades"]
    conta = salvar_conta(con, canal, tiktok, usuario="@curio", situacao="crescendo",
                         numeros={"seguidores": 2500, "views_30d": 150000})
    assert {m["chave"]: m["pct"] for m in progresso(tiktok, conta["numeros"])} == {
        "seguidores": 25, "views_30d": 100,
    }
    with pytest.raises(PublicacaoInvalida):
        salvar_conta(con, canal, tiktok, usuario="eu mesmo", situacao="criada")
    with pytest.raises(PublicacaoInvalida):
        salvar_conta(con, canal, tiktok, situacao="banida")
    with pytest.raises(PublicacaoInvalida):
        salvar_conta(con, canal, tiktok, situacao="criada", numeros={"inscritos": 1})
    with pytest.raises(PublicacaoInvalida):
        salvar_conta(con, canal, tiktok, situacao="criada", url="https://golpe.io/@curio")
