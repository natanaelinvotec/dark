"""Ponte entre o PC e o painel online (GitHub Pages + Firebase).

O painel online não fala com o PC. Os dois conversam pelo Firestore:
  - o PC publica cada tela do painel em `telas/{nome}` (o mesmo JSON que a API local devolve);
  - o painel online grava pedidos em `comandos/{id}`; o PC executa com as MESMAS rotas e
    validações da API local e responde no próprio documento;
  - os vídeos vão para uma pasta do Google Drive (escopo drive.file: o app só enxerga o que ele
    mesmo criou) e o painel toca a prévia de lá.

As partes puras (chaves, permissões, telas, comandos) são testadas sem rede; as classes
Firestore e Drive só importam as bibliotecas do Google quando usadas (extra `nuvem`).
"""

from __future__ import annotations

import hashlib
import json
import logging
import queue
import re
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Any

from estudio import db
from estudio.config import RAIZ, Canal, Config
from estudio.tempo import agora, iso

log = logging.getLogger("estudio.nuvem")

TELAS: tuple[tuple[str, str], ...] = (
    ("resumo", "/api/resumo"),
    ("fila-fila", "/api/fila?aba=fila"),
    ("fila-prontos", "/api/fila?aba=prontos"),
    ("fila-reprovados", "/api/fila?aba=reprovados"),
    ("fila-agendados", "/api/fila?aba=agendados"),
    ("producao", "/api/producao"),
    ("canais", "/api/canais"),
    ("series", "/api/series"),
    ("dinheiro", "/api/dinheiro"),
    ("config", "/api/config"),
    ("saude", "/api/saude"),
    ("plataformas", "/api/plataformas"),
    ("publicar-pendentes", "/api/publicar?aba=pendentes"),
    ("publicar-feitos", "/api/publicar?aba=feitos"),
)

# Só estas escritas podem vir da nuvem (nada de login, arquivos ou rotas novas por engano).
_PERMITIDOS = tuple(
    re.compile(p)
    for p in (
        r"^/api/videos/[a-f0-9]{6,40}/acao$",
        r"^/api/videos/[a-f0-9]{6,40}/etapas/gancho/pular$",
        r"^/api/lotes$",
        r"^/api/canais/[a-z0-9][a-z0-9-]{0,40}/ligado$",
        r"^/api/config$",
        r"^/api/contas/[a-z0-9][a-z0-9-]{0,40}/[a-z0-9][a-z0-9-]{0,40}$",
        r"^/api/publicacoes/[a-f0-9]{6,40}/[a-z0-9][a-z0-9-]{0,40}$",
    )
)
_DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{10,100}$")
PASTA_DRIVE = "Estúdio de Canais - prévias"


# --------------------------------------------------------------------------- regras puras


def chave_da_tela(caminho: str) -> str:
    """'/api/fila?aba=prontos' -> 'fila-prontos' (o fonte.js do site usa a mesma regra)."""
    rota, _, consulta = caminho.partition("?")
    nome = rota.removeprefix("/api/")
    aba = next(
        (v for k, _, v in (p.partition("=") for p in consulta.split("&")) if k == "aba"), ""
    )
    return f"{nome}-{aba}" if aba else nome


def caminho_permitido(caminho: str) -> bool:
    return isinstance(caminho, str) and any(p.match(caminho) for p in _PERMITIDOS)


def cliente_local(cfg: Config, canais: dict[str, Canal]) -> Any:
    """O app do painel dentro deste processo, sem rede: as rotas validam tudo como sempre."""
    from fastapi.testclient import TestClient

    from painel.app import criar_app

    app = criar_app(cfg, canais, exigir_segredos=False, autenticar=False)
    return TestClient(app, headers={"X-Estudio": "1"})


def gerar_telas(cliente: Any) -> dict[str, Any]:
    telas: dict[str, Any] = {}
    for chave, caminho in TELAS:
        resposta = cliente.get(caminho)
        resposta.raise_for_status()
        telas[chave] = resposta.json()
    return telas


def anexar_drive(telas: dict[str, Any], mapa: dict[str, str]) -> None:
    """Põe o id do arquivo no Drive em cada vídeo das telas que mostram prévia ou download."""
    for chave, tela in telas.items():
        if chave.startswith(("fila-", "publicar-")):
            for item in tela.get("itens", []):
                drive_id = mapa.get(item.get("id", ""))
                item["drive_id"] = drive_id if drive_id and _DRIVE_ID.match(drive_id) else None


def executar_comando(cliente: Any, caminho: Any, corpo: Any) -> dict[str, Any]:
    """Roda um pedido do painel online. Devolve {status, codigo, resposta, erro}."""
    if not caminho_permitido(caminho):
        return {"status": "erro", "codigo": 403, "resposta": None,
                "erro": "pedido não permitido pela ponte"}
    if not isinstance(corpo, dict):
        corpo = {}
    resposta = cliente.post(caminho, json=corpo)
    try:
        dados = resposta.json()
    except ValueError:
        dados = None
    if resposta.status_code < 300:
        return {"status": "ok", "codigo": resposta.status_code, "resposta": dados, "erro": ""}
    detalhe = dados.get("detail") if isinstance(dados, dict) else None
    if not isinstance(detalhe, str):
        detalhe = "dados inválidos" if resposta.status_code == 422 else "falhou no PC"
    return {"status": "erro", "codigo": resposta.status_code, "resposta": dados, "erro": detalhe}


def resumo_hash(valor: Any) -> str:
    texto = json.dumps(valor, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def regras_firestore(email: str) -> str:
    """Regras do Firestore: só o dono (e-mail verificado) lê as telas e cria comandos."""
    email = email.strip().lower()
    if not re.fullmatch(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", email):
        raise ValueError("e-mail do dono inválido")
    return f"""rules_version = '2';
service cloud.firestore {{
  match /databases/{{database}}/documents {{
    function dono() {{
      return request.auth != null
        && request.auth.token.email == '{email}'
        && request.auth.token.email_verified == true;
    }}
    // telas: só o PC escreve (conta de serviço, que ignora estas regras)
    match /telas/{{id}} {{
      allow read: if dono();
      allow write: if false;
    }}
    // comandos: o painel cria; só o PC conclui
    match /comandos/{{id}} {{
      allow read: if dono();
      allow create: if dono()
        && request.resource.data.keys().hasOnly(
             ['caminho', 'corpo', 'status', 'criadoEm', 'porEmail'])
        && request.resource.data.status == 'pendente'
        && request.resource.data.caminho is string
        && request.resource.data.caminho.size() <= 200
        && request.resource.data.corpo is map
        && request.resource.data.porEmail == request.auth.token.email
        && request.resource.data.criadoEm == request.time;
      allow update, delete: if false;
    }}
    match /{{outro=**}} {{
      allow read, write: if false;
    }}
  }}
}}
"""


# --------------------------------------------------------------------------- site (Pages)

# GitHub Pages não manda cabeçalhos de segurança: a política vai numa meta tag
CSP_SITE = (
    "default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com; "
    "style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; "
    "img-src 'self' data: https://*.googleusercontent.com; "
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com; "
    "frame-src https://drive.google.com https://*.firebaseapp.com https://accounts.google.com; "
    "base-uri 'none'; form-action 'self'; object-src 'none'"
)


def html_do_site(original: str) -> str:
    """O index.html do painel local vira o do Pages: caminhos relativos + fonte da nuvem."""
    trocas = (
        ('<meta charset="utf-8">',
         '<meta charset="utf-8">\n'
         f'<meta http-equiv="Content-Security-Policy" content="{CSP_SITE}">\n'
         '<meta name="robots" content="noindex, nofollow">\n'
         '<meta name="referrer" content="no-referrer">'),
        ('href="/static/app.css"', 'href="app.css"'),
        ('<script src="/static/app.js" defer></script>',
         '<script src="config.js" defer></script>\n<script src="fonte.js" defer></script>\n'
         '<script src="app.js" defer></script>'),
    )
    for antes, depois in trocas:
        if antes not in original:
            raise ValueError(f"index.html do painel mudou: não achei {antes!r}")
        original = original.replace(antes, depois)
    return original


def construir_site(saida: Path) -> Path:
    """Monta o site do GitHub Pages: telas do painel + fonte da nuvem + dados de exemplo."""
    import shutil

    from estudio.config import carregar_canais
    from estudio.exemplo import carregar_exemplo

    saida.mkdir(parents=True, exist_ok=True)
    estaticos = RAIZ / "src" / "painel" / "static"
    for nome in ("app.css", "app.js"):
        shutil.copyfile(estaticos / nome, saida / nome)
    for arquivo in (RAIZ / "site").iterdir():
        if arquivo.is_file():
            shutil.copyfile(arquivo, saida / arquivo.name)
    (saida / "index.html").write_text(
        html_do_site((estaticos / "index.html").read_text(encoding="utf-8")), encoding="utf-8"
    )
    (saida / ".nojekyll").write_text("", encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        cfg = Config(
            dados=Path(tmp) / "drive",
            db=Path(tmp) / "exemplo.db",
            canais_dir=RAIZ / "channels",
            fontes_dir=RAIZ / "assets" / "fonts",
        )
        canais = carregar_canais(cfg.canais_dir)
        con = db.conectar(cfg.db)
        db.inicializar(con)
        db.sincronizar_canais(con, canais.values())
        carregar_exemplo(con)
        con.close()
        with cliente_local(cfg, canais) as cliente:
            telas = gerar_telas(cliente)
    (saida / "exemplo").mkdir(exist_ok=True)
    (saida / "exemplo" / "telas.json").write_text(
        json.dumps(telas, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return saida


# --------------------------------------------------------------------------- Firestore


class Nuvem:
    """Firestore pela conta de serviço do projeto (arquivo JSON só no PC, nunca no Git)."""

    def __init__(self, credenciais: Path):
        if not credenciais.is_file():
            raise RuntimeError(
                f"Falta a chave da conta de serviço do Firebase em {credenciais} (README)."
            )
        from google.cloud import firestore
        from google.oauth2 import service_account

        creds = service_account.Credentials.from_service_account_file(str(credenciais))
        self._fs = firestore
        self.db = firestore.Client(project=creds.project_id, credentials=creds)

    def publicar(self, telas: dict[str, Any]) -> None:
        lote = self.db.batch()
        for chave, tela in telas.items():
            lote.set(
                self.db.collection("telas").document(chave),
                {"json": json.dumps(tela, ensure_ascii=False), "em": self._fs.SERVER_TIMESTAMP},
            )
        lote.commit()

    def ouvir_comandos(self, fila: queue.Queue) -> Any:
        """Escuta os pedidos pendentes em tempo real (só gasta leitura quando algo muda)."""
        from google.cloud.firestore_v1.base_query import FieldFilter

        consulta = self.db.collection("comandos").where(
            filter=FieldFilter("status", "==", "pendente")
        )

        def ao_mudar(_docs: Any, mudancas: Any, _momento: Any) -> None:
            for m in mudancas:
                if m.type.name == "ADDED":
                    fila.put((m.document.id, m.document.to_dict() or {}))

        return consulta.on_snapshot(ao_mudar)

    def concluir(self, doc_id: str, resultado: dict[str, Any]) -> None:
        self.db.collection("comandos").document(doc_id).update({
            "status": resultado["status"],
            "codigo": resultado["codigo"],
            "resposta": json.dumps(resultado["resposta"], ensure_ascii=False),
            "erro": resultado["erro"],
            "concluidoEm": self._fs.SERVER_TIMESTAMP,
        })


# --------------------------------------------------------------------------- Google Drive

ESCOPOS_DRIVE = ["https://www.googleapis.com/auth/drive.file"]


def login_drive(cliente_oauth: Path, token: Path) -> None:
    """Abre o navegador uma vez para você autorizar o app a criar arquivos no seu Drive."""
    if not cliente_oauth.is_file():
        raise RuntimeError(f"Falta o arquivo do cliente OAuth em {cliente_oauth} (README).")
    from google_auth_oauthlib.flow import InstalledAppFlow

    fluxo = InstalledAppFlow.from_client_secrets_file(str(cliente_oauth), ESCOPOS_DRIVE)
    credenciais = fluxo.run_local_server(port=0, open_browser=True)
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(credenciais.to_json(), encoding="utf-8")


class Drive:
    def __init__(self, token: Path):
        if not token.is_file():
            raise RuntimeError("Drive não autorizado: rode 'uv run estudio nuvem drive-login'.")
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file(str(token), ESCOPOS_DRIVE)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            token.write_text(creds.to_json(), encoding="utf-8")
        self.servico = build("drive", "v3", credentials=creds, cache_discovery=False)
        self._pasta: str | None = None

    def pasta(self) -> str:
        if self._pasta:
            return self._pasta
        nome = PASTA_DRIVE.replace("'", "")
        achados = self.servico.files().list(
            q=f"name = '{nome}' and mimeType = 'application/vnd.google-apps.folder' "
              "and trashed = false",
            fields="files(id)", pageSize=1,
        ).execute().get("files", [])
        if achados:
            self._pasta = achados[0]["id"]
        else:
            self._pasta = self.servico.files().create(
                body={"name": nome, "mimeType": "application/vnd.google-apps.folder"},
                fields="id",
            ).execute()["id"]
        return self._pasta

    def subir(self, arquivo: Path, nome: str) -> str:
        from googleapiclient.http import MediaFileUpload

        midia = MediaFileUpload(str(arquivo), mimetype="video/mp4", resumable=True)
        novo = self.servico.files().create(
            body={"name": nome, "parents": [self.pasta()]}, media_body=midia, fields="id"
        ).execute()["id"]
        # link não listado: quem não tem o link não acha; o painel online precisa dele
        self.servico.permissions().create(
            fileId=novo, body={"type": "anyone", "role": "reader"}
        ).execute()
        return novo

    def apagar(self, drive_id: str) -> None:
        self.servico.files().delete(fileId=drive_id).execute()


# --------------------------------------------------------------------------- vídeos no Drive


def mapa_drive(con: sqlite3.Connection) -> dict[str, str]:
    return {r["video_id"]: r["drive_id"] for r in con.execute("SELECT * FROM nuvem_arquivos")}


def proximo_para_subir(con: sqlite3.Connection, cfg: Config) -> tuple[str, Path, str] | None:
    """O próximo vídeo (fila, reprovado, aprovado ou publicado) sem cópia atual no Drive."""
    enviados = {
        r["video_id"]: r["assinatura"] for r in con.execute("SELECT * FROM nuvem_arquivos")
    }
    for v in con.execute(
        "SELECT id, arquivo FROM videos WHERE arquivo IS NOT NULL AND status IN "
        "('fila', 'reprovado', 'aprovado', 'publicado') ORDER BY atualizado_em DESC LIMIT 50"
    ):
        caminho = (cfg.dados / v["arquivo"]).resolve()
        if not caminho.is_file() or not caminho.is_relative_to(cfg.dados.resolve()):
            continue
        info = caminho.stat()
        assinatura = f"{info.st_size}-{int(info.st_mtime)}"
        if enviados.get(v["id"]) != assinatura:
            return v["id"], caminho, assinatura
    return None


def registrar_envio(
    con: sqlite3.Connection, video_id: str, drive_id: str, assinatura: str
) -> str | None:
    """Grava o novo id e devolve o antigo (para apagar a versão anterior no Drive)."""
    antigo = con.execute(
        "SELECT drive_id FROM nuvem_arquivos WHERE video_id = ?", (video_id,)
    ).fetchone()
    con.execute(
        "INSERT INTO nuvem_arquivos (video_id, drive_id, assinatura, enviado_em) "
        "VALUES (?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET drive_id = excluded.drive_id, "
        "assinatura = excluded.assinatura, enviado_em = excluded.enviado_em",
        (video_id, drive_id, assinatura, iso(agora())),
    )
    con.commit()
    return antigo["drive_id"] if antigo and antigo["drive_id"] != drive_id else None


# --------------------------------------------------------------------------- laço da ponte


def rodar_ponte(cfg: Config, canais: dict[str, Canal], intervalo: float = 60) -> None:
    nuvem = Nuvem(cfg.firebase_credenciais)
    try:
        drive: Drive | None = Drive(cfg.google_token)
    except RuntimeError as erro:
        log.warning("%s Sem prévias no painel online por enquanto.", erro)
        drive = None

    con = db.conectar(cfg.db)
    db.inicializar(con)
    pedidos: queue.Queue = queue.Queue()
    escuta = nuvem.ouvir_comandos(pedidos)
    feitos: set[str] = set()
    publicados: dict[str, str] = {}
    ultima = 0.0
    log.info("Ponte com a nuvem ligada.")

    with cliente_local(cfg, canais) as cliente:
        try:
            while True:
                mudou = False
                while not pedidos.empty():
                    doc_id, dados = pedidos.get()
                    if doc_id in feitos:
                        continue
                    feitos.add(doc_id)
                    resultado = executar_comando(cliente, dados.get("caminho"), dados.get("corpo"))
                    nuvem.concluir(doc_id, resultado)
                    log.info("comando %s %s: %s", dados.get("caminho"), resultado["status"],
                             resultado["erro"])
                    mudou = True

                if drive is not None:
                    proximo = proximo_para_subir(con, cfg)
                    if proximo:
                        video_id, arquivo, assinatura = proximo
                        try:
                            novo = drive.subir(arquivo, f"{video_id}.mp4")
                            antigo = registrar_envio(con, video_id, novo, assinatura)
                            if antigo:
                                drive.apagar(antigo)
                            mudou = True
                        except Exception as erro:  # rede ou cota: tenta de novo no próximo ciclo
                            log.warning("Drive: %s", erro)

                if mudou or time.monotonic() - ultima >= intervalo:
                    telas = gerar_telas(cliente)
                    anexar_drive(telas, mapa_drive(con))
                    trocadas = {
                        k: v for k, v in telas.items() if publicados.get(k) != resumo_hash(v)
                    }
                    if trocadas:
                        nuvem.publicar(trocadas)
                        publicados.update({k: resumo_hash(v) for k, v in trocadas.items()})
                    ultima = time.monotonic()
                time.sleep(1)
        finally:
            escuta.unsubscribe()
            con.close()
