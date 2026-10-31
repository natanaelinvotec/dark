from __future__ import annotations

import pytest
from pydantic import ValidationError

from estudio.config import Canal, carregar_config, ler_dotenv


def test_ler_dotenv_ignora_comentarios_e_tira_aspas(tmp_path):
    arquivo = tmp_path / ".env"
    arquivo.write_text(
        "# comentário\nGEMINI_MODELO=gemini-x\n"
        'ESTUDIO_DADOS="G:/Meu Drive/Estudio"\n\nSEM_IGUAL\n',
        encoding="utf-8",
    )
    valores = ler_dotenv(arquivo)
    assert valores == {"GEMINI_MODELO": "gemini-x", "ESTUDIO_DADOS": "G:/Meu Drive/Estudio"}


def test_carregar_config_aceita_virgula_e_caminho_relativo(tmp_path):
    cfg = carregar_config(
        {"TETO_MES_BRL": "200,5", "ESTUDIO_DB": "dados/x.db", "GEMINI_API_KEY": "abc"},
        raiz=tmp_path,
    )
    assert cfg.teto_mes_brl == 200.5
    assert cfg.db == tmp_path / "dados" / "x.db"
    assert cfg.chaves_configuradas()["gemini"] is True
    assert "abc" not in repr(cfg)


def test_numero_invalido_explica_o_erro(tmp_path):
    with pytest.raises(ValueError, match="TETO_MES_BRL"):
        carregar_config({"TETO_MES_BRL": "cem"}, raiz=tmp_path)


def test_canais_do_repositorio_carregam(canais):
    assert set(canais) == {"biblico-manhwa", "curiosidades"}
    biblico = canais["biblico-manhwa"]
    assert biblico.producao.quadros == "manual"
    assert biblico.producao.gancho == "manual"
    assert biblico.regras_sistema.exige_referencia is True
    assert canais["curiosidades"].producao.quadros == "banco"
    assert biblico.horarios == sorted(biblico.horarios)


@pytest.mark.parametrize("pasta", ["../fora", "C:/Windows", "/etc", "a/../../b", " "])
def test_pasta_do_canal_precisa_ser_relativa(pasta):
    with pytest.raises(ValidationError):
        Canal(slug="x", nome="X", pasta=pasta)


def test_cor_e_horario_validados():
    with pytest.raises(ValidationError):
        Canal(slug="x", nome="X", pasta="X", cor="azul")
    with pytest.raises(ValidationError):
        Canal(slug="x", nome="X", pasta="X", horarios=["25:00"])
