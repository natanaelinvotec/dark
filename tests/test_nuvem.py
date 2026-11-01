from __future__ import annotations

import json

import pytest

from estudio import db, nuvem
from estudio.exemplo import carregar_exemplo
from tests.conftest import colocar_na_fila


@pytest.fixture
def cliente(cfg, canais, con):
    with nuvem.cliente_local(cfg, canais) as c:
        yield c


def test_chave_da_tela_igual_a_do_site():
    assert nuvem.chave_da_tela("/api/resumo") == "resumo"
    assert nuvem.chave_da_tela("/api/fila?aba=prontos") == "fila-prontos"
    assert nuvem.chave_da_tela("/api/publicar?x=1&aba=feitos") == "publicar-feitos"
    assert [c for c, _ in nuvem.TELAS] == [nuvem.chave_da_tela(p) for _, p in nuvem.TELAS]


@pytest.mark.parametrize("caminho", [
    "/api/videos/abc123def456/acao", "/api/lotes", "/api/config",
    "/api/contas/curiosidades/tiktok", "/api/publicacoes/abc123def456/youtube",
    "/api/canais/biblico-manhwa/ligado", "/api/videos/abc123def456/etapas/gancho/pular",
])
def test_ponte_aceita_so_as_escritas_do_painel(caminho):
    assert nuvem.caminho_permitido(caminho)


@pytest.mark.parametrize("caminho", [
    "/login", "/logout", "/api/videos/../config", "/api/config?x=1", "/api/videos/ABC/acao",
    "/api/resumo", "https://golpe.io/api/lotes", None, 42,
])
def test_ponte_recusa_o_resto(caminho):
    assert not nuvem.caminho_permitido(caminho)


def test_telas_saem_iguais_a_api_local(cliente, con):
    carregar_exemplo(con)
    telas = nuvem.gerar_telas(cliente)
    assert set(telas) == {c for c, _ in nuvem.TELAS}
    assert telas["resumo"]["exemplo"] is True
    assert telas["fila-fila"]["aba"] == "fila"


def test_comando_aprova_com_a_mesma_validacao(cliente, con):
    vid = colocar_na_fila(con)
    r = nuvem.executar_comando(cliente, f"/api/videos/{vid}/acao", {"acao": "aprovar"})
    assert r["status"] == "ok" and r["resposta"]["status"] == "aprovado"
    assert db.obter_video(con, vid)["status"] == "aprovado"

    r = nuvem.executar_comando(cliente, f"/api/videos/{vid}/acao", {"acao": "apagar"})
    assert r["status"] == "erro" and r["codigo"] == 422
    r = nuvem.executar_comando(cliente, "/logout", {})
    assert r["status"] == "erro" and r["codigo"] == 403
    r = nuvem.executar_comando(cliente, "/api/lotes", "não é objeto")
    assert r["status"] == "erro" and r["codigo"] == 422


def test_anexar_drive_so_aceita_id_valido():
    telas = {"fila-fila": {"itens": [{"id": "a"}, {"id": "b"}]}, "resumo": {"itens": [{"id": "a"}]}}
    nuvem.anexar_drive(telas, {"a": "1AbC_dEf-1234567890", "b": "x\"><script>"})
    assert telas["fila-fila"]["itens"][0]["drive_id"] == "1AbC_dEf-1234567890"
    assert telas["fila-fila"]["itens"][1]["drive_id"] is None
    assert "drive_id" not in telas["resumo"]["itens"][0]


def test_envio_ao_drive_por_assinatura(con, cfg):
    vid = colocar_na_fila(con)
    renders = cfg.dados / "Canal-Biblico" / "Renders"
    renders.mkdir(parents=True)
    (renders / f"{vid}.mp4").write_bytes(b"mp4")
    db.atualizar_video(con, vid, arquivo=f"Canal-Biblico/Renders/{vid}.mp4")
    proximo = nuvem.proximo_para_subir(con, cfg)
    assert proximo and proximo[0] == vid
    assert nuvem.registrar_envio(con, vid, "drive-id-0000000001", proximo[2]) is None
    assert nuvem.proximo_para_subir(con, cfg) is None
    assert nuvem.mapa_drive(con) == {vid: "drive-id-0000000001"}
    # vídeo refeito: sobe de novo e devolve o id antigo para apagar
    assert nuvem.registrar_envio(con, vid, "drive-id-0000000002", "outra") == "drive-id-0000000001"


def test_regras_do_firestore_so_para_o_dono():
    regras = nuvem.regras_firestore("Dono@Gmail.com")
    assert "request.auth.token.email == 'dono@gmail.com'" in regras
    assert "allow update, delete: if false" in regras
    with pytest.raises(ValueError):
        nuvem.regras_firestore("x'; allow read: if true; //")


def test_site_do_pages(tmp_path):
    saida = nuvem.construir_site(tmp_path / "_site")
    html = (saida / "index.html").read_text(encoding="utf-8")
    assert 'http-equiv="Content-Security-Policy"' in html
    assert html.index("config.js") < html.index("fonte.js") < html.index('src="app.js"')
    assert "/static/" not in html
    for nome in ("app.js", "app.css", "fonte.js", "config.js", ".nojekyll"):
        assert (saida / nome).is_file(), nome
    telas = json.loads((saida / "exemplo" / "telas.json").read_text(encoding="utf-8"))
    assert telas["resumo"]["exemplo"] is True
    assert telas["plataformas"]["plataformas"]


def test_html_do_site_avisa_se_o_index_mudar():
    with pytest.raises(ValueError):
        nuvem.html_do_site("<html></html>")
