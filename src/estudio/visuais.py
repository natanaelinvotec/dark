"""Busca de imagens/vídeos com licença comercial (Pexels, Pixabay) e download seguro."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

HOSTS_PERMITIDOS = frozenset(
    {"images.pexels.com", "videos.pexels.com", "cdn.pixabay.com", "pixabay.com"}
)
TAMANHO_MAX = 150 * 1024 * 1024
LICENCA_PEXELS = "Licença Pexels (uso comercial, atribuição opcional)"
LICENCA_PIXABAY = "Licença de conteúdo Pixabay (uso comercial)"


class ErroDownload(RuntimeError):
    pass


@dataclass(frozen=True)
class Resultado:
    url: str
    fonte: str
    autor: str
    licenca: str
    eh_video: bool
    pagina: str = ""

    @property
    def extensao(self) -> str:
        return ".mp4" if self.eh_video else ".jpg"


def host_permitido(url: str) -> bool:
    partes = urlparse(url)
    return partes.scheme == "https" and (partes.hostname or "") in HOSTS_PERMITIDOS


# --------------------------------------------------------------------------- Pexels


def _pexels_videos(dados: dict) -> list[Resultado]:
    resultados: list[Resultado] = []
    for v in dados.get("videos", []):
        arquivos = [
            a
            for a in v.get("video_files", [])
            if (a.get("height") or 0) >= 1280 and (a.get("width") or 1) < (a.get("height") or 0)
        ]
        arquivos.sort(key=lambda a: abs((a.get("height") or 0) - 1920))
        if arquivos and host_permitido(arquivos[0].get("link", "")):
            resultados.append(
                Resultado(
                    url=arquivos[0]["link"],
                    fonte="pexels",
                    autor=(v.get("user") or {}).get("name", ""),
                    licenca=LICENCA_PEXELS,
                    eh_video=True,
                    pagina=v.get("url", ""),
                )
            )
    return resultados


def _pexels_fotos(dados: dict) -> list[Resultado]:
    resultados: list[Resultado] = []
    for f in dados.get("photos", []):
        src = f.get("src") or {}
        url = src.get("portrait") or src.get("large2x") or ""
        if host_permitido(url):
            resultados.append(
                Resultado(url, "pexels", f.get("photographer", ""), LICENCA_PEXELS, False,
                          f.get("url", ""))
            )
    return resultados


def _pixabay_videos(dados: dict) -> list[Resultado]:
    resultados: list[Resultado] = []
    for h in dados.get("hits", []):
        videos = h.get("videos") or {}
        # a Pixabay devolve 'large' com url vazia quando o vídeo não tem essa resolução
        url = next(
            (
                (videos.get(t) or {}).get("url", "")
                for t in ("large", "medium", "small")
                if (videos.get(t) or {}).get("url")
            ),
            "",
        )
        if url and host_permitido(url):
            resultados.append(
                Resultado(url, "pixabay", h.get("user", ""), LICENCA_PIXABAY, True,
                          h.get("pageURL", ""))
            )
    return resultados


def _pixabay_fotos(dados: dict) -> list[Resultado]:
    resultados: list[Resultado] = []
    for h in dados.get("hits", []):
        url = h.get("largeImageURL", "")
        if url and host_permitido(url):
            resultados.append(
                Resultado(url, "pixabay", h.get("user", ""), LICENCA_PIXABAY, False,
                          h.get("pageURL", ""))
            )
    return resultados


def buscar(
    termo: str,
    *,
    pexels_chave: str,
    pixabay_chave: str,
    usados: set[str],
    cliente: httpx.Client,
) -> Resultado | None:
    """Tenta, nesta ordem: vídeo Pexels, vídeo Pixabay, foto Pexels, foto Pixabay."""
    consultas = []
    if pexels_chave:
        cab = {"Authorization": pexels_chave}
        consultas += [
            ("https://api.pexels.com/videos/search",
             {"query": termo, "orientation": "portrait", "per_page": 10}, cab, _pexels_videos),
        ]
    if pixabay_chave:
        consultas += [
            ("https://pixabay.com/api/videos/",
             {"key": pixabay_chave, "q": termo, "per_page": 10, "safesearch": "true"}, {},
             _pixabay_videos),
        ]
    if pexels_chave:
        consultas += [
            ("https://api.pexels.com/v1/search",
             {"query": termo, "orientation": "portrait", "per_page": 10},
             {"Authorization": pexels_chave}, _pexels_fotos),
        ]
    if pixabay_chave:
        consultas += [
            ("https://pixabay.com/api/",
             {"key": pixabay_chave, "q": termo, "orientation": "vertical", "image_type": "photo",
              "per_page": 10, "safesearch": "true"}, {}, _pixabay_fotos),
        ]
    for url, params, cabecalhos, interpretar in consultas:
        resposta = cliente.get(url, params=params, headers=cabecalhos)
        if resposta.status_code != 200:
            continue
        for r in interpretar(resposta.json()):
            if r.url not in usados:
                return r
    return None


def baixar(resultado: Resultado, destino: Path, cliente: httpx.Client) -> str:
    """Baixa só de host permitido, sem seguir redirecionamento, com limite de tamanho.
    Devolve o SHA-256 do arquivo."""
    if not host_permitido(resultado.url):
        raise ErroDownload(f"host não permitido: {urlparse(resultado.url).hostname}")
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporario = destino.with_suffix(destino.suffix + ".parcial")
    hash_ = hashlib.sha256()
    total = 0
    with cliente.stream("GET", resultado.url, follow_redirects=False) as resposta:
        if resposta.status_code != 200:
            raise ErroDownload(f"download respondeu {resposta.status_code}")
        tamanho = int(resposta.headers.get("content-length") or 0)
        if tamanho > TAMANHO_MAX:
            raise ErroDownload("arquivo maior que o limite")
        with temporario.open("wb") as f:
            for pedaco in resposta.iter_bytes():
                total += len(pedaco)
                if total > TAMANHO_MAX:
                    f.close()
                    temporario.unlink(missing_ok=True)
                    raise ErroDownload("arquivo maior que o limite")
                hash_.update(pedaco)
                f.write(pedaco)
    temporario.replace(destino)
    return hash_.hexdigest()
