"""API do painel + arquivos estáticos. Uma pessoa só; acesso por Tailscale + senha."""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from estudio import db, publicacao
from estudio.acoes import AcaoInvalida, executar_acao, pular_gancho
from estudio.config import (
    Canal,
    Config,
    Registro,
    carregar_canais,
    carregar_config,
    carregar_plataformas,
    conferir_plataformas,
)
from painel import consultas
from painel.seguranca import LimitadorTentativas, dentro_de, verificar_senha

ESTATICOS = Path(__file__).parent / "static"
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


class Login(BaseModel):
    senha: str = Field(min_length=1, max_length=200)


class AcaoVideo(BaseModel):
    acao: str = Field(pattern="^(aprovar|refazer|rejeitar|desfazer)$")
    nota: str = Field(default="", max_length=500)
    # sem teto aqui: uma aba esquecida aberta não pode travar a aprovação (acoes.py descarta > 6 h)
    revisao_s: float | None = Field(default=None, ge=0)


class Lote(BaseModel):
    canal: str = Field(min_length=1, max_length=60)
    tema: str = Field(min_length=3, max_length=300)
    qtd: int = Field(ge=1, le=10)
    serie: str = Field(default="", max_length=120)
    referencia: str = Field(default="", max_length=120)


class Ligado(BaseModel):
    ligado: bool


Numero = Annotated[int, Field(ge=0, le=publicacao.NUMERO_MAX)]


class ContaDados(BaseModel):
    usuario: str = Field(default="", max_length=60)
    url: str = Field(default="", max_length=300)
    situacao: str = Field(pattern="^(planejada|criada|crescendo|monetizando|pausada)$")
    seguranca: bool = False
    numeros: dict[str, Numero] = Field(default_factory=dict)  # chaves conferidas em salvar_conta


class PublicacaoDados(BaseModel):
    situacao: str = Field(pattern="^(pendente|publicado|pulado)$")
    url: str = Field(default="", max_length=300)


def nome_de_arquivo(canal: str, titulo: str, video_id: str) -> str:
    """Nome ASCII seguro para o download (sem acento, espaço ou barra)."""
    base = unicodedata.normalize("NFKD", titulo).encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-").lower()[:50] or "video"
    return f"{canal}-{base}-{video_id}.mp4"


def criar_app(
    cfg: Config | None = None,
    canais: dict[str, Canal] | None = None,
    exigir_segredos: bool = True,
    registro: Registro | None = None,
) -> FastAPI:
    cfg = cfg or carregar_config()
    canais = canais if canais is not None else carregar_canais(cfg.canais_dir)
    registro = registro or carregar_plataformas(cfg.plataformas_arquivo)
    conferir_plataformas(canais, registro)
    if exigir_segredos and (not cfg.senha_hash or len(cfg.segredo_sessao) < 32):
        raise RuntimeError(
            "Defina ESTUDIO_SENHA_HASH (uv run estudio senha) e ESTUDIO_SEGREDO_SESSAO "
            "(32+ caracteres) no .env antes de subir o painel."
        )

    inicial = db.conectar(cfg.db)
    db.inicializar(inicial)
    db.sincronizar_canais(inicial, canais.values())
    inicial.close()

    app = FastAPI(title="Estúdio de Canais", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.cfg = cfg
    app.state.canais = canais
    app.state.limitador = LimitadorTentativas()

    app.add_middleware(
        SessionMiddleware,
        secret_key=cfg.segredo_sessao or "teste-" + "x" * 40,
        session_cookie="estudio_sessao",
        max_age=12 * 3600,
        same_site="strict",
        https_only=cfg.cookie_seguro,
    )

    @app.middleware("http")
    async def cabecalhos_de_seguranca(request: Request, call_next):  # type: ignore[no-untyped-def]
        resposta: Response = await call_next(request)
        resposta.headers["Content-Security-Policy"] = CSP
        resposta.headers["X-Content-Type-Options"] = "nosniff"
        resposta.headers["Referrer-Policy"] = "no-referrer"
        resposta.headers["X-Frame-Options"] = "DENY"
        resposta.headers["Cache-Control"] = "no-store"
        return resposta

    # ------------------------------------------------------------------ dependências

    def conexao() -> Iterator[sqlite3.Connection]:
        con = db.conectar(cfg.db)
        try:
            yield con
        finally:
            con.close()

    def sessao(request: Request) -> None:
        if not request.session.get("ok"):
            raise HTTPException(status_code=401, detail="faça login")

    def anti_csrf(request: Request) -> None:
        if request.headers.get("x-estudio") != "1":
            raise HTTPException(status_code=403, detail="cabeçalho X-Estudio ausente")

    escrita = [Depends(sessao), Depends(anti_csrf)]
    leitura = [Depends(sessao)]

    # ------------------------------------------------------------------ páginas e login

    @app.get("/", include_in_schema=False)
    def inicio(request: Request) -> Response:
        if not request.session.get("ok"):
            return RedirectResponse("/login", status_code=303)
        return FileResponse(ESTATICOS / "index.html")

    @app.get("/login", include_in_schema=False)
    def pagina_login() -> FileResponse:
        return FileResponse(ESTATICOS / "login.html")

    @app.post("/login", dependencies=[Depends(anti_csrf)])
    def login(dados: Login, request: Request) -> JSONResponse:
        ip = request.client.host if request.client else "?"
        limitador: LimitadorTentativas = app.state.limitador
        if limitador.bloqueado(ip):
            raise HTTPException(status_code=429, detail="muitas tentativas; espere 15 minutos")
        if not verificar_senha(dados.senha, cfg.senha_hash):
            limitador.registrar_falha(ip)
            raise HTTPException(status_code=401, detail="senha incorreta")
        limitador.zerar(ip)
        request.session.clear()
        request.session["ok"] = True
        return JSONResponse({"ok": True})

    @app.post("/logout", dependencies=[Depends(anti_csrf)])
    def logout(request: Request) -> JSONResponse:
        request.session.clear()
        return JSONResponse({"ok": True})

    # ------------------------------------------------------------------ leitura

    @app.get("/api/resumo", dependencies=leitura)
    def api_resumo(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.resumo(con, cfg, canais)

    @app.get("/api/fila", dependencies=leitura)
    def api_fila(aba: str = "fila", con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.fila(con, cfg, canais, aba)

    @app.get("/api/producao", dependencies=leitura)
    def api_producao(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.producao(con, canais)

    @app.get("/api/canais", dependencies=leitura)
    def api_canais(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.lista_canais(con, canais)

    @app.get("/api/series", dependencies=leitura)
    def api_series(con: sqlite3.Connection = Depends(conexao)) -> list[dict[str, Any]]:
        return consultas.series(con, canais)

    @app.get("/api/dinheiro", dependencies=leitura)
    def api_dinheiro(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.dinheiro(con, cfg)

    @app.get("/api/config", dependencies=leitura)
    def api_config(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.config_publica(con, cfg)

    @app.get("/api/saude", dependencies=leitura)
    def api_saude(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.saude(con, cfg)

    def _mp4_do_video(con: sqlite3.Connection, video_id: str) -> tuple[sqlite3.Row, Path]:
        video = db.obter_video(con, video_id)
        caminho = dentro_de(cfg.dados, video["arquivo"] or "") if video else None
        if video is None or caminho is None or caminho.suffix.lower() != ".mp4":
            raise HTTPException(status_code=404, detail="vídeo não encontrado neste computador")
        return video, caminho

    @app.get("/api/videos/{video_id}/previa", dependencies=leitura)
    def api_previa(video_id: str, con: sqlite3.Connection = Depends(conexao)) -> FileResponse:
        _, caminho = _mp4_do_video(con, video_id)
        return FileResponse(caminho, media_type="video/mp4")

    @app.get("/api/videos/{video_id}/arquivo", dependencies=leitura)
    def api_baixar(video_id: str, con: sqlite3.Connection = Depends(conexao)) -> FileResponse:
        video, caminho = _mp4_do_video(con, video_id)
        if video["status"] not in ("aprovado", "publicado"):
            raise HTTPException(status_code=409, detail="só vídeos aprovados podem ser baixados")
        nome = nome_de_arquivo(video["canal_id"], video["titulo"] or video["tema"], video["id"])
        return FileResponse(caminho, media_type="video/mp4", filename=nome)

    @app.get("/api/plataformas", dependencies=leitura)
    def api_plataformas(con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        return consultas.plataformas(con, canais, registro)

    @app.get("/api/publicar", dependencies=leitura)
    def api_publicar(
        aba: str = "pendentes", con: sqlite3.Connection = Depends(conexao)
    ) -> dict[str, Any]:
        return consultas.publicar(con, cfg, canais, registro, aba)

    # ------------------------------------------------------------------ escrita

    @app.post("/api/videos/{video_id}/acao", dependencies=escrita)
    def api_acao(
        video_id: str, dados: AcaoVideo, con: sqlite3.Connection = Depends(conexao)
    ) -> dict[str, Any]:
        try:
            video = executar_acao(
                con, video_id, dados.acao, canais, nota=dados.nota, revisao_s=dados.revisao_s
            )
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro)) from erro
        except AcaoInvalida as erro:
            raise HTTPException(status_code=409, detail=str(erro)) from erro
        return {"id": video["id"], "status": video["status"], "horario": video["horario"]}

    @app.post("/api/videos/{video_id}/etapas/gancho/pular", dependencies=escrita)
    def api_pular_gancho(
        video_id: str, con: sqlite3.Connection = Depends(conexao)
    ) -> dict[str, bool]:
        try:
            pular_gancho(con, video_id)
        except AcaoInvalida as erro:
            raise HTTPException(status_code=409, detail=str(erro)) from erro
        return {"ok": True}

    @app.post("/api/lotes", dependencies=escrita)
    def api_lote(dados: Lote, con: sqlite3.Connection = Depends(conexao)) -> dict[str, Any]:
        if dados.canal not in canais:
            raise HTTPException(status_code=422, detail="canal desconhecido")
        ids = [
            db.criar_video(con, dados.canal, dados.tema, serie=dados.serie,
                           referencia=dados.referencia)
            for _ in range(dados.qtd)
        ]
        db.registrar_evento(con, "pauta", dados.canal, f"lote de {len(ids)}: {dados.tema}", "info")
        return {"ids": ids}

    @app.post("/api/canais/{canal_id}/ligado", dependencies=escrita)
    def api_ligado(
        canal_id: str, dados: Ligado, con: sqlite3.Connection = Depends(conexao)
    ) -> dict[str, bool]:
        canal = canais.get(canal_id)
        if canal is None:
            raise HTTPException(status_code=404, detail="canal não encontrado")
        if dados.ligado and not canal.enabled:
            raise HTTPException(status_code=409, detail="canal desligado no YAML (enabled: false)")
        con.execute("UPDATE canais SET ligado = ? WHERE id = ?", (int(dados.ligado), canal_id))
        con.commit()
        db.registrar_evento(con, "canal", canal_id, "ligado" if dados.ligado else "pausado", "info")
        return {"ligado": dados.ligado}

    @app.post("/api/contas/{canal_id}/{plataforma_id}", dependencies=escrita)
    def api_conta(
        canal_id: str,
        plataforma_id: str,
        dados: ContaDados,
        con: sqlite3.Connection = Depends(conexao),
    ) -> dict[str, Any]:
        canal = canais.get(canal_id)
        plataforma = registro.plataformas.get(plataforma_id)
        if canal is None or plataforma is None:
            raise HTTPException(status_code=404, detail="canal ou plataforma não encontrado")
        try:
            return publicacao.salvar_conta(con, canal, plataforma, **dados.model_dump())
        except publicacao.PublicacaoInvalida as erro:
            raise HTTPException(status_code=422, detail=str(erro)) from erro

    @app.post("/api/publicacoes/{video_id}/{plataforma_id}", dependencies=escrita)
    def api_publicacao(
        video_id: str,
        plataforma_id: str,
        dados: PublicacaoDados,
        con: sqlite3.Connection = Depends(conexao),
    ) -> dict[str, Any]:
        try:
            return publicacao.marcar(
                con, registro, canais, video_id, plataforma_id, dados.situacao, dados.url
            )
        except LookupError as erro:
            raise HTTPException(status_code=404, detail=str(erro)) from erro
        except publicacao.PublicacaoInvalida as erro:
            raise HTTPException(status_code=422, detail=str(erro)) from erro

    @app.post("/api/config", dependencies=escrita)
    def api_salvar_config(
        dados: dict[str, Any], con: sqlite3.Connection = Depends(conexao)
    ) -> JSONResponse:
        erros = consultas.salvar_config(con, dados)
        if erros:
            return JSONResponse({"erros": erros}, status_code=422)
        return JSONResponse({"ok": True})

    app.mount("/static", StaticFiles(directory=ESTATICOS), name="static")
    return app
