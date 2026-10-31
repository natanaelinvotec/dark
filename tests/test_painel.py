from __future__ import annotations

import dataclasses
import json

import pytest
from fastapi.testclient import TestClient

from estudio import db
from estudio.exemplo import carregar_exemplo
from painel.app import criar_app
from painel.seguranca import LimitadorTentativas, dentro_de, gerar_hash, verificar_senha
from tests.conftest import colocar_na_fila

SENHA = "senha-de-teste-123"
H = {"X-Estudio": "1"}


@pytest.fixture
def cfg_painel(cfg):
    return dataclasses.replace(cfg, senha_hash=gerar_hash(SENHA), gemini_chave="chave-secreta")


@pytest.fixture
def cliente(cfg_painel, canais, con):
    return TestClient(criar_app(cfg_painel, canais))


@pytest.fixture
def logado(cliente):
    assert cliente.post("/login", json={"senha": SENHA}, headers=H).status_code == 200
    return cliente


# --------------------------------------------------------------------------- segurança


def test_hash_de_senha():
    guardado = gerar_hash(SENHA)
    assert guardado.startswith("scrypt$")
    assert verificar_senha(SENHA, guardado)
    assert not verificar_senha("outra", guardado)
    assert not verificar_senha(SENHA, "lixo")


def test_limitador_e_guarda_de_caminho(tmp_path):
    lim = LimitadorTentativas(maximo=2, janela_s=60)
    lim.registrar_falha("ip", 1.0)
    lim.registrar_falha("ip", 2.0)
    assert lim.bloqueado("ip", 3.0)
    assert not lim.bloqueado("ip", 100.0)
    (tmp_path / "ok.mp4").write_bytes(b"x")
    assert dentro_de(tmp_path, "ok.mp4") == (tmp_path / "ok.mp4").resolve()
    assert dentro_de(tmp_path, "../fora.mp4") is None
    assert dentro_de(tmp_path, "") is None


def test_painel_recusa_subir_sem_segredos(cfg, canais):
    with pytest.raises(RuntimeError):
        criar_app(cfg, canais)


def test_sem_sessao_401_e_sem_cabecalho_403(cliente):
    assert cliente.get("/api/resumo").status_code == 401
    assert cliente.post("/login", json={"senha": SENHA}).status_code == 403


def test_login_errado_e_limite_de_tentativas(cliente):
    for _ in range(10):
        assert cliente.post("/login", json={"senha": "errada"}, headers=H).status_code == 401
    assert cliente.post("/login", json={"senha": SENHA}, headers=H).status_code == 429


def test_cabecalhos_de_seguranca(cliente):
    r = cliente.get("/login")
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"


def test_config_nunca_devolve_chave(logado):
    r = logado.get("/api/config")
    assert r.status_code == 200
    assert "chave-secreta" not in r.text
    assert r.json()["chaves"]["gemini"] is True


# --------------------------------------------------------------------------- fila


def test_aprovar_pelo_painel_exige_cabecalho_e_audita(logado, con):
    vid = colocar_na_fila(con)
    itens = logado.get("/api/fila").json()["itens"]
    assert [i["id"] for i in itens] == [vid]
    assert itens[0]["horario_sugerido"]

    assert logado.post(f"/api/videos/{vid}/acao", json={"acao": "aprovar"}).status_code == 403
    r = logado.post(f"/api/videos/{vid}/acao", json={"acao": "aprovar"}, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "aprovado"
    assert con.execute("SELECT COUNT(*) FROM acoes WHERE video_id = ?", (vid,)).fetchone()[0] == 1

    r = logado.post(f"/api/videos/{vid}/acao", json={"acao": "aprovar"}, headers=H)
    assert r.status_code == 409
    agendados = logado.get("/api/fila?aba=agendados").json()["itens"]
    assert [i["id"] for i in agendados] == [vid]


def test_acao_invalida_e_video_inexistente(logado):
    assert logado.post("/api/videos/x/acao", json={"acao": "apagar"}, headers=H).status_code == 422
    assert logado.post("/api/videos/x/acao", json={"acao": "aprovar"}, headers=H).status_code == 404


def test_previa_nao_sai_da_pasta_de_dados(logado, con):
    vid = colocar_na_fila(con)
    db.atualizar_video(con, vid, arquivo="../../segredo.mp4")
    assert logado.get(f"/api/videos/{vid}/previa").status_code == 404


# --------------------------------------------------------------------------- escrita


def test_lote_config_e_canal(logado, con):
    r = logado.post("/api/lotes", json={"canal": "curiosidades", "tema": "Catatumbo", "qtd": 2},
                    headers=H)
    assert r.status_code == 200 and len(r.json()["ids"]) == 2
    assert logado.post("/api/lotes", json={"canal": "x", "tema": "abc", "qtd": 1},
                       headers=H).status_code == 422
    assert logado.post("/api/lotes", json={"canal": "curiosidades", "tema": "abc", "qtd": 50},
                       headers=H).status_code == 422

    r = logado.post("/api/config", json={"cambio_usd_brl": "99"}, headers=H)
    assert r.status_code == 422 and "cambio_usd_brl" in r.json()["erros"]
    assert logado.post("/api/config", json={"cambio_usd_brl": "5,30"}, headers=H).status_code == 200
    assert db.obter_config(con, "cambio_usd_brl") == "5.3"

    r = logado.post("/api/canais/curiosidades/ligado", json={"ligado": False}, headers=H)
    assert r.status_code == 200
    canais = {c["id"]: c for c in logado.get("/api/canais").json()["canais"]}
    assert canais["curiosidades"]["ligado"] is False


def test_contas_das_plataformas(logado):
    d = logado.get("/api/plataformas").json()
    assert [p["id"] for p in d["plataformas"]] == [
        "youtube", "tiktok", "facebook", "instagram", "kwai", "snapchat",
    ]
    tiktok = next(p for p in d["plataformas"] if p["id"] == "tiktok")
    assert tiktok["duracao_min_s"] == 60 and len(tiktok["contas"]) == 2

    url = "/api/contas/curiosidades/tiktok"
    corpo = {"situacao": "criada", "usuario": "@curiosidades",
             "url": "https://golpe.example/x", "numeros": {"seguidores": 10}}
    assert logado.post(url, json=corpo, headers=H).status_code == 422
    corpo["url"] = "https://www.tiktok.com/@curiosidades"
    assert logado.post(url, json=corpo).status_code == 403
    assert logado.post(url, json={**corpo, "numeros": {"seguidores": -1}},
                       headers=H).status_code == 422
    r = logado.post(url, json=corpo, headers=H)
    assert r.status_code == 200 and r.json()["numeros"] == {"seguidores": 10}
    assert logado.post("/api/contas/curiosidades/orkut", json=corpo,
                       headers=H).status_code == 404


def test_publicar_em_cada_plataforma(logado, con):
    vid = colocar_na_fila(con, canal="curiosidades", titulo="Catatumbo")
    base = f"/api/publicacoes/{vid}"
    assert logado.post(f"{base}/youtube", json={"situacao": "publicado"},
                       headers=H).status_code == 422  # ainda não foi aprovado
    db.atualizar_video(con, vid, status="aprovado", duracao_s=55.0,
                       roteiro_json=json.dumps({"descricao": "Raios.", "hashtags": ["ciencia"]}))

    item = next(i for i in logado.get("/api/publicar").json()["itens"] if i["id"] == vid)
    plats = {p["id"]: p for p in item["plataformas"]}
    assert plats["tiktok"]["elegivel"]["status"] == "at"  # 55 s não rende no TikTok
    assert plats["youtube"]["legenda"]["titulo"] == "Catatumbo"
    assert "#ciencia" in plats["tiktok"]["legenda"]["texto"]

    falso = {"situacao": "publicado", "url": "https://youtube.com.golpe.io/x"}
    assert logado.post(f"{base}/youtube", json=falso, headers=H).status_code == 422
    r = logado.post(f"{base}/youtube", headers=H,
                    json={"situacao": "publicado", "url": "https://www.youtube.com/shorts/abc"})
    assert r.status_code == 200 and r.json()["video_status"] == "publicado"
    assert "youtube" not in r.json()["pendentes"]
    primeiro = con.execute("SELECT publicado_em FROM publicacoes WHERE video_id = ?",
                           (vid,)).fetchone()[0]
    logado.post(f"{base}/youtube", headers=H,
                json={"situacao": "publicado", "url": "https://youtu.be/abc"})
    assert con.execute("SELECT publicado_em FROM publicacoes WHERE video_id = ?",
                       (vid,)).fetchone()[0] == primeiro  # trocar o link não muda a data
    r = logado.post(f"{base}/youtube", json={"situacao": "pendente"}, headers=H)
    assert r.json()["video_status"] == "aprovado"

    for p in ("youtube", "tiktok", "facebook", "instagram", "kwai", "snapchat"):
        assert logado.post(f"{base}/{p}", json={"situacao": "pulado"}, headers=H).status_code == 200
    feitos = logado.get("/api/publicar?aba=feitos").json()["itens"]
    assert [i["id"] for i in feitos] == [vid]


def test_baixar_so_aprovado_e_com_nome_seguro(logado, con, cfg_painel):
    vid = colocar_na_fila(con)
    renders = cfg_painel.dados / "Canal-Biblico" / "Renders"
    renders.mkdir(parents=True)
    (renders / f"{vid}.mp4").write_bytes(b"mp4")
    db.atualizar_video(con, vid, arquivo=f"Canal-Biblico/Renders/{vid}.mp4",
                       titulo="Davi: a missão!")
    assert logado.get(f"/api/videos/{vid}/arquivo").status_code == 409
    db.atualizar_video(con, vid, status="aprovado")
    r = logado.get(f"/api/videos/{vid}/arquivo")
    assert r.status_code == 200 and r.content == b"mp4"
    assert f"biblico-manhwa-davi-a-missao-{vid}.mp4" in r.headers["content-disposition"]


def test_todas_as_telas_respondem_com_dados_de_exemplo(logado, con):
    carregar_exemplo(con)
    for rota in ("resumo", "fila", "producao", "canais", "series", "dinheiro", "config", "saude",
                 "plataformas", "publicar"):
        r = logado.get(f"/api/{rota}")
        assert r.status_code == 200, rota
    resumo = logado.get("/api/resumo").json()
    assert resumo["exemplo"] is True
    assert resumo["kpis"]["esperando"] == 6
    assert any(p["rota"] == "aprovacao/reprovados" for p in resumo["precisa"])
    dinheiro = logado.get("/api/dinheiro").json()
    assert dinheiro["receita"] == 1240
    assert dinheiro["sobra"] == pytest.approx(1240 - 178)
    publicar = logado.get("/api/publicar").json()
    assert {i["titulo"] for i in publicar["itens"]} >= {"O gigante de Gate desafia Israel"}
    assert any(p["rota"] == "plataformas" for p in resumo["precisa"])


def test_logout_encerra_a_sessao(logado):
    assert logado.post("/logout", headers=H).status_code == 200
    assert logado.get("/api/resumo").status_code == 401
