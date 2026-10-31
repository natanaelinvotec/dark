"""Configuração: variáveis de ambiente (.env) e canais (YAML)."""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Literal
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

RAIZ = Path(__file__).resolve().parents[2]
FUSO = "America/Sao_Paulo"
TIPOS_JANELA_PADRAO = ["MISSAO", "MISSAO_OCULTA", "ITEM", "STATUS"]
PLATAFORMAS_PADRAO = ["youtube", "tiktok"]


# --------------------------------------------------------------------------- ambiente


def ler_dotenv(caminho: Path) -> dict[str, str]:
    """Lê um .env simples (CHAVE=valor, comentários com #). Não interpreta variáveis."""
    valores: dict[str, str] = {}
    if not caminho.is_file():
        return valores
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        valores[chave.strip()] = valor
    return valores


@dataclass(frozen=True)
class Config:
    dados: Path
    db: Path
    canais_dir: Path
    fontes_dir: Path
    senha_hash: str = field(default="", repr=False)
    segredo_sessao: str = field(default="", repr=False)
    cookie_seguro: bool = False
    gemini_chave: str = field(default="", repr=False)
    gemini_modelo: str = "gemini-2.5-flash"
    azure_chave: str = field(default="", repr=False)
    azure_regiao: str = "brazilsouth"
    azure_voz: str = "pt-BR-AntonioNeural"
    pexels_chave: str = field(default="", repr=False)
    pixabay_chave: str = field(default="", repr=False)
    teto_mes_brl: float = 150.0
    cambio_usd_brl: float = 5.2
    plataformas_arquivo: Path = RAIZ / "plataformas.yaml"

    def chaves_configuradas(self) -> dict[str, bool]:
        """Só diz se cada chave existe. Nunca devolve o valor."""
        return {
            "gemini": bool(self.gemini_chave),
            "azure": bool(self.azure_chave),
            "pexels": bool(self.pexels_chave),
            "pixabay": bool(self.pixabay_chave),
            "senha": bool(self.senha_hash),
            "sessao": len(self.segredo_sessao) >= 32,
        }


def _numero(env: Mapping[str, str], nome: str, padrao: float) -> float:
    bruto = env.get(nome, "")
    if bruto == "":
        return padrao
    try:
        return float(bruto.replace(",", "."))
    except ValueError as erro:
        raise ValueError(f"{nome} precisa ser um número (veio {bruto!r})") from erro


def _caminho(bruto: str, raiz: Path) -> Path:
    p = Path(bruto).expanduser()
    return p if p.is_absolute() else (raiz / p)


def carregar_config(env: Mapping[str, str] | None = None, raiz: Path = RAIZ) -> Config:
    """Junta .env + variáveis de ambiente (o ambiente vence)."""
    if env is None:
        env = {**ler_dotenv(raiz / ".env"), **os.environ}
    return Config(
        dados=_caminho(env.get("ESTUDIO_DADOS", "dados/drive"), raiz),
        db=_caminho(env.get("ESTUDIO_DB", "dados/estudio.db"), raiz),
        canais_dir=_caminho(env.get("ESTUDIO_CANAIS", "channels"), raiz),
        fontes_dir=_caminho(env.get("ESTUDIO_FONTES", "assets/fonts"), raiz),
        senha_hash=env.get("ESTUDIO_SENHA_HASH", ""),
        segredo_sessao=env.get("ESTUDIO_SEGREDO_SESSAO", ""),
        cookie_seguro=env.get("ESTUDIO_COOKIE_SEGURO", "0") == "1",
        gemini_chave=env.get("GEMINI_API_KEY", ""),
        gemini_modelo=env.get("GEMINI_MODELO", "") or "gemini-2.5-flash",
        azure_chave=env.get("AZURE_TTS_CHAVE", ""),
        azure_regiao=env.get("AZURE_TTS_REGIAO", "") or "brazilsouth",
        azure_voz=env.get("AZURE_TTS_VOZ", "") or "pt-BR-AntonioNeural",
        pexels_chave=env.get("PEXELS_CHAVE", ""),
        pixabay_chave=env.get("PIXABAY_CHAVE", ""),
        teto_mes_brl=_numero(env, "TETO_MES_BRL", 150.0),
        cambio_usd_brl=_numero(env, "CAMBIO_USD_BRL", 5.2),
        plataformas_arquivo=_caminho(
            env.get("ESTUDIO_PLATAFORMAS", "plataformas.yaml"), raiz
        ),
    )


# --------------------------------------------------------------------------- canais


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Formato(_Base):
    short_segundos: tuple[int, int] = (61, 80)
    tiktok_segundos: tuple[int, int] = (61, 80)
    palavras_min: int = 150
    palavras_max: int = 195
    cenas_min: int = 6
    cenas_max: int = 14
    janelas_min: int = 0
    janelas_max: int = 2


class Producao(_Base):
    quadros: Literal["manual", "banco"] = "banco"
    gancho: Literal["manual", "nenhum"] = "nenhum"
    voz: Literal["tts", "propria"] = "tts"


class InstrucoesRoteiro(_Base):
    instrucoes: str = ""


class EstiloVisual(_Base):
    prompt_base: str = ""
    evitar: list[str] = []


class Personagem(_Base):
    id: str
    ficha: str = ""
    descricao: str = ""


class CoresJanela(_Base):
    fundo: str = "#1A1408"
    borda: str = "#E9C46A"
    titulo: str = "#FFE8A3"
    texto: str = "#F5ECD7"
    destaque: str = "#7FD1AE"


class EstiloJanela(_Base):
    tema: str = ""
    cores: CoresJanela = CoresJanela()
    fonte_titulo: str = "Cinzel.ttf"
    fonte_texto: str = "Nunito.ttf"


class Sistema(_Base):
    tipos: list[str] = TIPOS_JANELA_PADRAO
    exige_referencia: bool = True
    proibido: list[str] = []
    recompensas_permitidas: list[str] = []


_COR = re.compile(r"^#[0-9A-Fa-f]{6}$")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Canal(_Base):
    slug: str
    nome: str
    cor: str = "#2563C9"
    enabled: bool = True
    idioma: str = "pt-BR"
    descricao: str = ""
    pasta: str
    horarios: list[str] = ["12:00", "19:00"]
    formato: Formato = Formato()
    producao: Producao = Producao()
    roteiro: InstrucoesRoteiro = InstrucoesRoteiro()
    estilo_visual: EstiloVisual = EstiloVisual()
    personagens: list[Personagem] = []
    janela_de_missao: EstiloJanela = EstiloJanela()
    sistema: Sistema | None = None
    busca_visual_padrao: str = "abstract background"
    plataformas: list[str] = PLATAFORMAS_PADRAO

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not _SLUG.match(v):
            raise ValueError("slug só com letras minúsculas, números e hífen")
        return v

    @field_validator("plataformas")
    @classmethod
    def _plataformas(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v) or not all(_SLUG.match(p) for p in v):
            raise ValueError("plataformas: ids únicos em minúsculas (ex.: youtube, tiktok)")
        return v

    @field_validator("cor")
    @classmethod
    def _cor(cls, v: str) -> str:
        if not _COR.match(v):
            raise ValueError("cor no formato #RRGGBB")
        return v

    @field_validator("pasta")
    @classmethod
    def _pasta(cls, v: str) -> str:
        p = PurePosixPath(v.replace("\\", "/"))
        if p.is_absolute() or ".." in p.parts or not v.strip() or ":" in v:
            raise ValueError("pasta precisa ser relativa a ESTUDIO_DADOS, sem '..'")
        return str(p)

    @field_validator("horarios")
    @classmethod
    def _horarios(cls, v: list[str]) -> list[str]:
        for h in v:
            if not _HORA.match(h):
                raise ValueError(f"horário inválido: {h}")
        return sorted(v)

    @property
    def regras_sistema(self) -> Sistema:
        return self.sistema or Sistema()

    def pasta_em(self, dados: Path) -> Path:
        return dados / self.pasta


def carregar_canais(pasta: Path) -> dict[str, Canal]:
    canais: dict[str, Canal] = {}
    for arquivo in sorted(pasta.glob("*.yaml")):
        bruto = yaml.safe_load(arquivo.read_text(encoding="utf-8")) or {}
        canal = Canal.model_validate(bruto)
        if canal.slug in canais:
            raise ValueError(f"slug repetido: {canal.slug} ({arquivo.name})")
        canais[canal.slug] = canal
    return canais


# --------------------------------------------------------------------------- plataformas


_CHAVE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")
_DOMINIO = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


def host_aceito(url: str, dominios: Iterable[str]) -> bool:
    """https e host igual a um domínio da lista ou subdomínio dele (nada de 'youtube.com.x.io')."""
    url = url.strip()
    # navegadores leem '\' como '/': 'https://golpe.com\.youtube.com' abriria golpe.com
    if "\\" in url or any(ord(c) < 33 for c in url):
        return False
    partes = urlsplit(url)
    host = (partes.hostname or "").lower()
    if partes.scheme != "https" or partes.username or partes.password:
        return False
    if not _DOMINIO.match(host):
        return False
    return any(host == d or host.endswith("." + d) for d in dominios)


class Meta(_Base):
    chave: str
    rotulo: str = Field(min_length=1)
    alvo: int = Field(gt=0)

    @field_validator("chave")
    @classmethod
    def _chave(cls, v: str) -> str:
        if not _CHAVE.match(v):
            raise ValueError("chave da meta em minúsculas, ex.: views_30d")
        return v


class Urls(_Base):
    entrar: str = ""
    subir: str = ""
    painel: str = ""
    programa: str = ""


class Plataforma(_Base):
    id: str
    nome: str
    cor: str = "#56676A"
    programa: str = ""
    brasil: str = ""
    requisitos: str = ""
    conta: str = ""
    duracao_min_s: int = Field(default=0, ge=0)
    duracao_max_s: int = Field(default=0, ge=0)  # 0 = sem limite
    metas: list[Meta] = []
    dominios: list[str]
    urls: Urls = Urls()
    publicacao: Literal["web", "app"] = "web"
    api: str = ""
    metricool: bool = False
    legenda: Literal["titulo_descricao", "completa", "curta"] = "completa"
    ao_publicar: list[str] = []
    riscos: list[str] = []
    fontes: list[str] = []

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not _SLUG.match(v):
            raise ValueError("id da plataforma em minúsculas, ex.: tiktok")
        return v

    @field_validator("cor")
    @classmethod
    def _cor(cls, v: str) -> str:
        if not _COR.match(v):
            raise ValueError("cor no formato #RRGGBB")
        return v

    @field_validator("dominios")
    @classmethod
    def _dominios(cls, v: list[str]) -> list[str]:
        if not v or not all(_DOMINIO.match(d) for d in v):
            raise ValueError("dominios: lista de hosts, ex.: [tiktok.com]")
        return v

    @model_validator(mode="after")
    def _links_seguros(self) -> Plataforma:
        for nome, url in self.urls.model_dump().items():
            if url and not host_aceito(url, self.dominios):
                raise ValueError(f"{self.id}: urls.{nome} precisa ser https num dos dominios")
        if any(not f.startswith("https://") for f in self.fontes):
            raise ValueError(f"{self.id}: fontes precisam ser links https")
        if self.metas and len({m.chave for m in self.metas}) != len(self.metas):
            raise ValueError(f"{self.id}: chaves de meta repetidas")
        return self

    def aceita_link(self, url: str) -> bool:
        return host_aceito(url, self.dominios)


class _ArquivoPlataformas(_Base):
    verificado_em: date
    plataformas: list[Plataforma]


@dataclass(frozen=True)
class Registro:
    verificado_em: date
    plataformas: dict[str, Plataforma]

    def do_canal(self, canal: Canal) -> list[Plataforma]:
        return [self.plataformas[p] for p in canal.plataformas if p in self.plataformas]


def carregar_plataformas(arquivo: Path) -> Registro:
    bruto = yaml.safe_load(arquivo.read_text(encoding="utf-8")) or {}
    dados = _ArquivoPlataformas.model_validate(bruto)
    plataformas: dict[str, Plataforma] = {}
    for p in dados.plataformas:
        if p.id in plataformas:
            raise ValueError(f"plataforma repetida: {p.id}")
        plataformas[p.id] = p
    return Registro(dados.verificado_em, plataformas)


def conferir_plataformas(canais: Mapping[str, Canal], registro: Registro) -> None:
    """Falha cedo se um canal cita plataforma que não está em plataformas.yaml."""
    for canal in canais.values():
        faltando = [p for p in canal.plataformas if p not in registro.plataformas]
        if faltando:
            raise ValueError(
                f"canal {canal.slug}: plataforma desconhecida {', '.join(faltando)} "
                f"(opções: {', '.join(registro.plataformas)})"
            )
