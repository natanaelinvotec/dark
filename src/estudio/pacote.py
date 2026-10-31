"""Pacote de agendamento: os aprovados de um dia viram uma pasta com os MP4 e um CSV."""

from __future__ import annotations

import csv
import json
import shutil
import sqlite3
from datetime import date
from pathlib import Path

_PERIGOSOS = ("=", "+", "-", "@", "\t", "\r")


def celula_segura(valor: object) -> str:
    """Evita que o Excel/Sheets execute fórmula vinda de texto gerado por IA."""
    texto = "" if valor is None else str(valor)
    return "'" + texto if texto.startswith(_PERIGOSOS) else texto


def gerar_pacote(con: sqlite3.Connection, dia: date, dados: Path, destino: Path) -> Path:
    pasta = destino / dia.isoformat()
    pasta.mkdir(parents=True, exist_ok=True)
    linhas = con.execute(
        "SELECT v.*, c.nome AS canal_nome FROM videos v JOIN canais c ON c.id = v.canal_id "
        # 'publicado' também: o vídeo muda de status quando sai na 1ª plataforma, e o pacote
        # do dia continua valendo para as outras
        "WHERE v.status IN ('aprovado', 'publicado') AND substr(v.horario, 1, 10) = ? "
        "ORDER BY v.horario",
        (dia.isoformat(),),
    ).fetchall()

    csv_caminho = pasta / "agendamento.csv"
    with csv_caminho.open("w", newline="", encoding="utf-8-sig") as f:
        escritor = csv.writer(f, delimiter=";")
        escritor.writerow(
            ["canal", "horario", "titulo", "descricao", "hashtags", "arquivo", "rotulo_ia"]
        )
        for v in linhas:
            roteiro = json.loads(v["roteiro_json"]) if v["roteiro_json"] else {}
            arquivo_destino = ""
            if v["arquivo"]:
                origem = (dados / v["arquivo"]).resolve()
                if origem.is_file() and origem.is_relative_to(dados.resolve()):
                    hora = (v["horario"] or "")[11:16].replace(":", "h")
                    nome = f"{v['canal_id']}-{hora}-{v['id']}.mp4"
                    shutil.copy2(origem, pasta / nome)
                    arquivo_destino = nome
            escritor.writerow(
                [
                    celula_segura(v["canal_nome"]),
                    celula_segura(v["horario"]),
                    celula_segura(v["titulo"]),
                    celula_segura(roteiro.get("descricao", "")),
                    celula_segura(" ".join(roteiro.get("hashtags", []))),
                    celula_segura(arquivo_destino),
                    "marcar conteúdo alterado/sintético se houver cena realista criada por IA",
                ]
            )
    return pasta
