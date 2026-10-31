from __future__ import annotations

import csv
import json
import shutil
import wave
from datetime import date

import pytest
from PIL import Image

from estudio import db
from estudio.config import EstiloJanela
from estudio.esquemas import Janela
from estudio.janela import desenhar_janela
from estudio.montagem import (
    Clipe,
    Sobreposicao,
    distribuir_duracoes,
    executar_ffmpeg,
    montar_comando,
)
from estudio.pacote import celula_segura, gerar_pacote
from estudio.qualidade import (
    Analise,
    InfoMidia,
    avaliar,
    parse_analise,
    parse_ffprobe,
    reprovado,
    rodar_ffprobe,
)
from tests.conftest import colocar_na_fila

# --------------------------------------------------------------------------- janela


def test_janela_tem_transparencia_e_largura_esperada(tmp_path):
    janela = Janela(
        tipo="MISSAO",
        titulo="Levar provisões aos irmãos no acampamento",
        detalhe="Grão tostado e dez pães",
        referencia="1 Sm 17:17",
        cena=1,
    )
    imagem = desenhar_janela(janela, EstiloJanela(), tmp_path)
    assert imagem.mode == "RGBA"
    assert imagem.width == 900 + 60
    assert imagem.getpixel((0, 0))[3] < 20  # canto praticamente transparente
    centro = imagem.getpixel((imagem.width // 2, imagem.height // 2))
    assert centro[3] > 200  # corpo da janela opaco


# --------------------------------------------------------------------------- montagem


def test_distribuir_duracoes_soma_o_total_e_respeita_minimo():
    duracoes = distribuir_duracoes([2, 20, 20, 20], 20.0, minimo=1.5)
    assert sum(duracoes) == pytest.approx(20.0, abs=0.01)
    assert min(duracoes) >= 1.5 - 0.01


def test_comando_e_lista_sem_shell_e_com_filtros_esperados():
    cmd = montar_comando(
        [Clipe("q0.png", 3.0), Clipe("gancho.mp4", 5.0, eh_video=True), Clipe("q1.png", 4.0)],
        "narracao.wav",
        "saida.mp4",
        musica="musica.mp3",
        legendas="legendas.ass",
        pasta_fontes="fontes",
        sobreposicoes=[Sobreposicao("janela0.png", 3.0, 7.0)],
    )
    assert isinstance(cmd, list) and all(isinstance(p, str) for p in cmd)
    filtro = cmd[cmd.index("-filter_complex") + 1]
    assert "concat=n=3:v=1:a=0[base]" in filtro
    assert "overlay=" in filtro and "between(t,3.00,7.00)" in filtro
    assert "subtitles=filename=legendas.ass:fontsdir=fontes" in filtro
    assert "amix=inputs=2" in filtro
    assert cmd[-1] == "saida.mp4"


def test_comando_recusa_nome_inseguro_no_filtro():
    with pytest.raises(ValueError):
        montar_comando([Clipe("q.png", 2)], "n.wav", "s.mp4", legendas="x';rm -rf /;'.ass")


# --------------------------------------------------------------------------- qualidade

FFPROBE = json.dumps(
    {
        "streams": [
            {"codec_type": "video", "width": 1080, "height": 1920},
            {"codec_type": "audio"},
        ],
        "format": {"duration": "54.2"},
    }
)

STDERR = """
[blackdetect @ 0x1] black_start:0 black_end:0.2 black_duration:0.2
[silencedetect @ 0x2] silence_end: 31.4 | silence_duration: 1.8
[Parsed_ebur128_0 @ 0x3] Summary:
  Integrated loudness:
    I:         -14.3 LUFS
"""


def test_parsers():
    info = parse_ffprobe(FFPROBE)
    assert info == InfoMidia(1080, 1920, 54.2, True)
    analise = parse_analise(STDERR)
    assert analise.lufs == -14.3
    assert analise.pretos == [(0.0, 0.2)]
    assert analise.silencios == [1.8]


def test_avaliar_aprova_video_bom_com_alerta_de_silencio():
    testes = avaliar(
        InfoMidia(1080, 1920, 54.2, True),
        parse_analise(STDERR),
        cobertura_legenda=0.95,
        ativos_sem_licenca=0,
        similaridade=0.18,
        avisos_checagem=1,
    )
    status = {t.nome.split()[0]: t.status for t in testes}
    assert status["Formato"] == "ok"
    assert status["Áudio"] == "ok"
    assert status["Silêncio"] == "at"
    assert status["Checagem:"] == "at"
    assert status["Duração"] == "at"  # 54 s: não rende no TikTok, mas não reprova
    assert not reprovado(testes)


@pytest.mark.parametrize(("segundos", "esperado"), [(59.9, "at"), (61.0, "ok"), (80.0, "ok"),
                                                    (95.0, "at")])
def test_duracao_para_monetizar(segundos, esperado):
    testes = avaliar(
        InfoMidia(1080, 1920, segundos, True),
        Analise(lufs=-14.0, pretos=[], silencios=[]),
        cobertura_legenda=1.0,
        ativos_sem_licenca=0,
        similaridade=0.1,
        avisos_checagem=0,
    )
    assert next(t.status for t in testes if t.nome.startswith("Duração")) == esperado


def test_avaliar_reprova_formato_errado_e_roteiro_repetido():
    testes = avaliar(
        InfoMidia(1920, 1080, 54.0, True),
        Analise(lufs=-14.0, pretos=[], silencios=[]),
        cobertura_legenda=1.0,
        ativos_sem_licenca=2,
        similaridade=0.72,
        avisos_checagem=0,
    )
    reprovados = {t.nome.split()[0] for t in testes if t.status == "cr"}
    assert reprovados == {"Formato", "Licenças", "Similaridade"}
    assert reprovado(testes)


# --------------------------------------------------------------------------- pacote


@pytest.mark.parametrize("valor", ["=HYPERLINK(1)", "+1", "-1", "@x", "\tx"])
def test_celula_segura_neutraliza_formula(valor):
    assert celula_segura(valor).startswith("'")


def test_gerar_pacote_copia_aprovados_do_dia(con, cfg, canais, tmp_path):
    vid = colocar_na_fila(con)
    renders = cfg.dados / "Canal-Biblico" / "Renders"
    renders.mkdir(parents=True)
    (renders / f"{vid}.mp4").write_bytes(b"mp4")
    db.atualizar_video(
        con,
        vid,
        status="aprovado",
        horario="2026-11-01T19:00:00-03:00",
        arquivo=f"Canal-Biblico/Renders/{vid}.mp4",
        roteiro_json=json.dumps({"descricao": "=SOMA(A1)", "hashtags": ["#biblia"]}),
    )
    pasta = gerar_pacote(con, date(2026, 11, 1), cfg.dados, tmp_path / "pacotes")
    with (pasta / "agendamento.csv").open(encoding="utf-8-sig") as f:
        linhas = list(csv.reader(f, delimiter=";"))
    assert linhas[1][3] == "'=SOMA(A1)"
    assert linhas[1][5].endswith(".mp4")
    assert (pasta / linhas[1][5]).read_bytes() == b"mp4"


# --------------------------------------------------------------------------- integração


@pytest.mark.ffmpeg
@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg não instalado")
def test_montagem_real_gera_1080x1920(tmp_path):
    Image.new("RGB", (800, 600), (20, 40, 90)).save(tmp_path / "q0.png")
    Image.new("RGB", (600, 900), (90, 40, 20)).save(tmp_path / "q1.png")
    with wave.open(str(tmp_path / "narracao.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 24000 * 2)
    cmd = montar_comando(
        [Clipe("q0.png", 1.0), Clipe("q1.png", 1.0)], "narracao.wav", "saida.mp4"
    )
    executar_ffmpeg(cmd, tmp_path)
    info = rodar_ffprobe(tmp_path / "saida.mp4")
    assert (info.largura, info.altura) == (1080, 1920)
    assert info.duracao == pytest.approx(2.0, abs=0.3)
