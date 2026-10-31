from __future__ import annotations

from estudio.cli import main


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
