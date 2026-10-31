"""Formatos que a LLM devolve. Sem valores padrão: o schema vai direto para a Gemini API."""

from __future__ import annotations

from pydantic import BaseModel


class Cena(BaseModel):
    narracao: str
    visual: str


class Janela(BaseModel):
    tipo: str
    titulo: str
    detalhe: str
    referencia: str
    cena: int


class Roteiro(BaseModel):
    titulo: str
    gancho: str
    cenas: list[Cena]
    janelas: list[Janela]
    titulos_alternativos: list[str]
    descricao: str
    hashtags: list[str]
    fontes: list[str]

    @property
    def narracao(self) -> str:
        return " ".join(c.narracao.strip() for c in self.cenas if c.narracao.strip())


class AvisoChecagem(BaseModel):
    afirmacao: str
    certeza: str
    sugestao: str


class Checagem(BaseModel):
    avisos: list[AvisoChecagem]
