"""Fábricas de dados de teste (sem rede)."""

from __future__ import annotations

from estudio.esquemas import Cena, Janela, Roteiro
from estudio.roteiro import RespostaLLM


def fazer_roteiro(
    cenas: int = 10, palavras_por_cena: int = 13, janelas: int = 1, gancho: str = "Um gigante"
) -> Roteiro:
    return Roteiro(
        titulo="Davi recebe a missão",
        gancho=gancho,
        cenas=[
            Cena(narracao=" ".join(["palavra"] * palavras_por_cena), visual="shepherd boy, hills")
            for _ in range(cenas)
        ],
        janelas=[
            Janela(
                tipo="MISSAO",
                titulo="Levar provisões aos irmãos",
                detalhe="Grão tostado e dez pães",
                referencia="1 Sm 17:17",
                cena=1,
            )
            for _ in range(janelas)
        ],
        titulos_alternativos=["a", "b", "c", "d", "e"],
        descricao="Descrição.",
        hashtags=["#biblia"],
        fontes=["1 Samuel 17"],
    )


class ClienteFalso:
    nome = "falso"

    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.prompts: list[str] = []

    def gerar(self, prompt, esquema):
        self.prompts.append(prompt)
        return RespostaLLM(self.respostas.pop(0), 1000, 500)
