from __future__ import annotations

import shutil

from estudio.cli import configurar, gravar_no_env, main
from estudio.config import RAIZ, ler_dotenv
from painel.seguranca import verificar_senha


def test_gravar_no_env_troca_e_acrescenta_sem_perder_comentarios(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# comentário\nGEMINI_API_KEY=\nTETO_MES_BRL=150\n", encoding="utf-8")
    gravar_no_env(env, {"GEMINI_API_KEY": "abc", "NOVA": "1"})
    assert env.read_text(encoding="utf-8") == (
        "# comentário\nGEMINI_API_KEY=abc\nTETO_MES_BRL=150\nNOVA=1\n"
    )


def test_configurar_cria_env_com_segredo_senha_e_drive(tmp_path):
    shutil.copyfile(RAIZ / ".env.example", tmp_path / ".env.example")
    mudou = configurar(tmp_path, dados="G:\\Meu Drive\\Estudio", senha="senha-bem-longa-1",
                       chaves={"GEMINI_API_KEY": "chave", "PEXELS_CHAVE": "  "})
    assert mudou == ["ESTUDIO_DADOS", "ESTUDIO_SEGREDO_SESSAO", "ESTUDIO_SENHA_HASH",
                     "GEMINI_API_KEY"]
    valores = ler_dotenv(tmp_path / ".env")
    assert valores["ESTUDIO_DADOS"] == "G:/Meu Drive/Estudio"
    assert len(valores["ESTUDIO_SEGREDO_SESSAO"]) >= 32
    assert verificar_senha("senha-bem-longa-1", valores["ESTUDIO_SENHA_HASH"])
    assert valores["PEXELS_CHAVE"] == ""
    assert configurar(tmp_path) == []  # rodar de novo não troca o segredo


def test_exemplo_so_em_banco_vazio_e_worker_recusa_banco_de_exemplo(tmp_path, monkeypatch):
    monkeypatch.setenv("ESTUDIO_DB", str(tmp_path / "exemplo.db"))
    monkeypatch.setenv("ESTUDIO_DADOS", str(tmp_path / "drive"))
    assert main(["seed-exemplo"]) == 0
    assert main(["seed-exemplo"]) == 1  # já tem vídeos: não mistura de novo
    assert main(["worker", "--uma-vez"]) == 1  # não gasta API com vídeo de mentira


def test_painel_recusa_host_publico_sem_flag():
    assert main(["painel", "--host", "0.0.0.0"]) == 2  # noqa: S104 - é exatamente o que se testa


def test_gerar_limita_o_lote(tmp_path, monkeypatch):
    monkeypatch.setenv("ESTUDIO_DB", str(tmp_path / "real.db"))
    monkeypatch.setenv("ESTUDIO_DADOS", str(tmp_path / "drive"))
    assert main(["gerar", "--canal", "curiosidades", "--tema", "x", "--qtd", "11"]) == 1
    assert main(["gerar", "--canal", "nao-existe", "--tema", "x"]) == 1
    assert main(["gerar", "--canal", "curiosidades", "--tema", "Relâmpagos", "--qtd", "2"]) == 0
