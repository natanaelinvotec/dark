"""Ciclo do worker com serviços falsos: sem rede, sem FFmpeg."""

from __future__ import annotations

from pathlib import Path

import pytest

from estudio import db
from estudio.esquemas import Checagem
from estudio.gatilho import Semana, condicoes, deve_abrir_proximo_canal, medir
from estudio.legendas import Palavra
from estudio.pipeline import Contexto, Servicos, ciclo, preparar_refazer, processar_video
from estudio.qualidade import Analise, InfoMidia
from estudio.visuais import LICENCA_PEXELS, Resultado
from tests.fabricas import ClienteFalso, fazer_roteiro


def _servicos(llm) -> Servicos:
    def sintetizar(texto: str, destino: Path) -> int:
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(b"RIFF")
        return len(texto)

    def baixar(resultado: Resultado, destino: Path) -> str:
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(b"img")
        return "abc"

    def executar_ffmpeg(cmd: list[str], pasta: Path) -> None:
        assert "-filter_complex" in cmd
        (pasta / "saida.mp4").write_bytes(b"mp4")

    contador = iter(range(10_000))
    return Servicos(
        llm=llm,
        sintetizar=sintetizar,
        transcrever=lambda audio: [Palavra("ola", 0.0, 0.5), Palavra("mundo", 0.5, 50.0)],
        buscar_visual=lambda termo, usados: Resultado(
            f"https://images.pexels.com/{next(contador)}.jpg", "pexels", "Autor",
            LICENCA_PEXELS, False,
        ),
        baixar=baixar,
        executar_ffmpeg=executar_ffmpeg,
        ffprobe=lambda caminho: InfoMidia(1080, 1920, 50.0, True),
        analisar=lambda caminho: Analise(-14.0, [], []),
    )


@pytest.fixture
def ctx(con, cfg, canais):
    llm = ClienteFalso([fazer_roteiro(janelas=0), Checagem(avisos=[])])
    return Contexto(con=con, cfg=cfg, canais=canais, servicos=_servicos(llm))


def test_curiosidades_vai_da_pauta_ate_a_fila(ctx):
    vid = db.criar_video(ctx.con, "curiosidades", "Relâmpagos do Catatumbo")
    for _ in range(7):
        processar_video(ctx, vid)
    video = db.obter_video(ctx.con, vid)
    assert video["status"] == "fila", db.etapas_do_video(ctx.con, vid)
    assert video["arquivo"] == f"Canal-Curiosidades/Renders/{vid}.mp4"
    testes = ctx.con.execute(
        "SELECT nome, status FROM testes WHERE video_id = ?", (vid,)
    ).fetchall()
    assert testes and all(t["status"] != "cr" for t in testes)
    ativos = ctx.con.execute("SELECT * FROM ativos WHERE video_id = ?", (vid,)).fetchall()
    assert len(ativos) == 10 and all(a["licenca"] for a in ativos)


def test_biblico_espera_os_quadros_do_dono(ctx):
    ctx.servicos.llm = ClienteFalso([fazer_roteiro(), Checagem(avisos=[])])
    vid = db.criar_video(ctx.con, "biblico-manhwa", "Davi e Golias", serie="Temporada Davi")
    for _ in range(4):
        processar_video(ctx, vid)
    assert db.obter_video(ctx.con, vid)["status"] == "voce"
    etapas = db.etapas_do_video(ctx.con, vid)
    assert etapas["quadros"]["status"] == "voce"
    prompts = ctx.cfg.dados / "Canal-Biblico" / "Paineis" / vid / "prompts.txt"
    assert "Quadro 01:" in prompts.read_text(encoding="utf-8")
    eventos = ctx.con.execute("SELECT COUNT(*) FROM eventos WHERE nivel = 'at'").fetchone()[0]
    assert eventos == 1  # repetir o ciclo não enche o console

    for i in range(10):
        (prompts.parent / f"{i + 1:02d}.png").write_bytes(b"png")
    processar_video(ctx, vid)
    assert db.etapas_do_video(ctx.con, vid)["quadros"]["status"] == "feito"


def test_erro_vira_evento_e_espera_antes_de_tentar_de_novo(ctx):
    ctx.servicos.llm = None
    vid = db.criar_video(ctx.con, "curiosidades", "x")
    assert processar_video(ctx, vid) == "roteiro"
    assert db.etapas_do_video(ctx.con, vid)["roteiro"]["status"] == "erro"
    assert processar_video(ctx, vid) is None  # dentro da janela de espera
    evento = ctx.con.execute("SELECT * FROM eventos ORDER BY id DESC LIMIT 1").fetchone()
    assert evento["nivel"] == "cr" and "GEMINI_API_KEY" in evento["msg"]


def test_canal_desligado_nao_entra_no_ciclo(ctx):
    db.criar_video(ctx.con, "curiosidades", "x")
    ctx.con.execute("UPDATE canais SET ligado = 0")
    assert ciclo(ctx) == 0
    assert db.obter_config(ctx.con, "worker_batimento")


def test_refazer_recomeca_no_lugar_certo(ctx):
    vid = db.criar_video(ctx.con, "curiosidades", "x")
    for etapa in db.ETAPAS:
        db.definir_etapa(ctx.con, vid, etapa, "feito")
    db.atualizar_video(ctx.con, vid, status="refazer", nota_refazer="trocar a imagem da cena 3")
    assert preparar_refazer(ctx, db.obter_video(ctx.con, vid)) == "quadros"
    db.atualizar_video(ctx.con, vid, status="refazer", nota_refazer="")
    assert preparar_refazer(ctx, db.obter_video(ctx.con, vid)) == "montagem"


def test_condicoes_do_gatilho(con):
    s = Semana(8.4, 3100, 940, 0, 6.5)
    estado = {c["nome"]: c["ok"] for c in condicoes(s)}
    assert list(estado.values()) == [True, False, True, True]
    assert medir(con).avisos_politica == 0


def test_regra_do_gatilho_e_do_dono():
    with pytest.raises(NotImplementedError):
        deve_abrir_proximo_canal([])
