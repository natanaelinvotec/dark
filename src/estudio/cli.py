"""Linha de comando: `estudio <comando>`."""

from __future__ import annotations

import argparse
import getpass
import logging
import re
import secrets
import shutil
import sys
from datetime import date
from pathlib import Path

from estudio import db
from estudio.config import RAIZ, carregar_canais, carregar_config, ler_dotenv
from estudio.tempo import agora

PASTAS_DO_CANAL = (
    "Personagens", "Paineis", "Ganchos", "Audio", "Visuais", "Musicas", "Renders", "Trabalho",
)


def _abrir():
    cfg = carregar_config()
    canais = carregar_canais(cfg.canais_dir)
    con = db.conectar(cfg.db)
    db.inicializar(con)
    db.sincronizar_canais(con, canais.values())
    return cfg, canais, con


def cmd_init(_: argparse.Namespace) -> int:
    cfg, canais, con = _abrir()
    for canal in canais.values():
        for nome in PASTAS_DO_CANAL:
            canal.pasta_em(cfg.dados).joinpath(nome).mkdir(parents=True, exist_ok=True)
    (cfg.dados / "Pacotes").mkdir(parents=True, exist_ok=True)
    con.close()
    print(f"Banco em {cfg.db}")
    print(f"Pastas criadas em {cfg.dados} para: {', '.join(canais)}")
    return 0


def cmd_exemplo(_: argparse.Namespace) -> int:
    from estudio.exemplo import carregar_exemplo

    cfg, _, con = _abrir()
    if con.execute("SELECT COUNT(*) FROM videos").fetchone()[0]:
        con.close()
        print(
            f"Recusado: o banco {cfg.db} já tem vídeos. Os dados de exemplo misturariam "
            "custos e métricas de mentira com os reais. Use um banco separado, ex.:\n"
            '  $env:ESTUDIO_DB="dados/exemplo.db"; uv run estudio seed-exemplo',
            file=sys.stderr,
        )
        return 1
    carregar_exemplo(con)
    con.close()
    print(f"Dados de exemplo carregados em {cfg.db}. Abra o painel: estudio painel")
    return 0


def _pedir_senha() -> str | None:
    senha = getpass.getpass("Nova senha do painel (mín. 12 caracteres): ")
    if len(senha) < 12:
        print("Senha curta demais.", file=sys.stderr)
        return None
    if getpass.getpass("Repita: ") != senha:
        print("As senhas não conferem.", file=sys.stderr)
        return None
    return senha


def cmd_senha(_: argparse.Namespace) -> int:
    from painel.seguranca import gerar_hash

    senha = _pedir_senha()
    if senha is None:
        return 1
    # aspas simples: o hash tem '$', que o docker compose e alguns shells tentariam expandir
    print("Cole no .env (com as aspas), ou rode 'estudio configurar --trocar-senha':")
    print(f"ESTUDIO_SENHA_HASH='{gerar_hash(senha)}'")
    return 0


_LINHA_ENV = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*=")
_ENDERECO = re.compile(r"^https://[a-z0-9-]+(\.[a-z0-9-]+)+$")
CHAVES_OPCIONAIS = (
    ("GEMINI_API_KEY", "Chave da Gemini API (aistudio.google.com)"),
    ("AZURE_TTS_CHAVE", "Chave da voz Azure"),
    ("PEXELS_CHAVE", "Chave do Pexels"),
    ("PIXABAY_CHAVE", "Chave do Pixabay"),
)


def gravar_no_env(arquivo: Path, valores: dict[str, str]) -> None:
    """Troca (ou acrescenta) CHAVE=valor no .env, mantendo comentários e a ordem."""
    linhas = arquivo.read_text(encoding="utf-8").splitlines() if arquivo.exists() else []
    faltando = dict(valores)
    for i, linha in enumerate(linhas):
        achado = _LINHA_ENV.match(linha)
        if achado and achado.group(1) in faltando:
            chave = achado.group(1)
            linhas[i] = f"{chave}={faltando.pop(chave)}"
    linhas += [f"{k}={v}" for k, v in faltando.items()]
    arquivo.write_text("\n".join(linhas) + "\n", encoding="utf-8")


def configurar(
    raiz: Path,
    *,
    dados: str | None = None,
    senha: str | None = None,
    chaves: dict[str, str] | None = None,
    online: bool | None = None,
    endereco: str | None = None,
) -> list[str]:
    """Cria o .env (se faltar) e grava só o que foi pedido. Devolve o que mudou (sem valores)."""
    from painel.seguranca import gerar_hash

    env = raiz / ".env"
    if not env.exists():
        shutil.copyfile(raiz / ".env.example", env)
    atuais = ler_dotenv(env)
    novos: dict[str, str] = {}
    if len(atuais.get("ESTUDIO_SEGREDO_SESSAO", "")) < 32:
        novos["ESTUDIO_SEGREDO_SESSAO"] = secrets.token_urlsafe(48)
    if dados:
        # barras normais: o .env é lido também pelo docker compose, que interpreta '\'
        novos["ESTUDIO_DADOS"] = dados.strip().strip('"').replace("\\", "/")
    if senha:
        novos["ESTUDIO_SENHA_HASH"] = f"'{gerar_hash(senha)}'"
    for chave, valor in (chaves or {}).items():
        if valor.strip():
            novos[chave] = valor.strip()
    if online is not None:
        # online = endereço https (Cloudflare): o cookie da sessão só viaja cifrado
        valor = "1" if online else "0"
        if atuais.get("ESTUDIO_COOKIE_SEGURO", "0") != valor:
            novos["ESTUDIO_COOKIE_SEGURO"] = valor
    if endereco:
        endereco = endereco.strip().rstrip("/")
        if not _ENDERECO.match(endereco):
            raise ValueError("endereço precisa ser https://algo.seudominio (sem caminho)")
        if atuais.get("ESTUDIO_ENDERECO") != endereco:
            novos["ESTUDIO_ENDERECO"] = endereco
    if novos:
        gravar_no_env(env, novos)
    return sorted(novos)


def cmd_configurar(args: argparse.Namespace) -> int:
    env = RAIZ / ".env"
    atuais = ler_dotenv(env) if env.exists() else ler_dotenv(RAIZ / ".env.example")
    interativo = sys.stdin.isatty()
    # --online/--so-local/--endereco mexem só no acesso: não repete as outras perguntas
    so_acesso = args.online or args.so_local or bool(args.endereco)

    dados = args.dados
    if dados is None and interativo and not so_acesso:
        padrao = atuais.get("ESTUDIO_DADOS", "")
        resposta = input(f"Pasta do Google Drive para os vídeos [{padrao}]: ").strip()
        dados = resposta or None

    senha = None
    if args.trocar_senha or not atuais.get("ESTUDIO_SENHA_HASH"):
        if interativo:
            senha = _pedir_senha()
            if senha is None:
                return 1
        else:
            # ex.: preparo automático do Codespaces; o resto do .env é gravado mesmo assim
            print("Senha do painel ainda não definida: rode 'uv run estudio configurar' "
                  "num terminal.", file=sys.stderr)

    chaves: dict[str, str] = {}
    if interativo and not so_acesso:
        for chave, rotulo in CHAVES_OPCIONAIS:
            if not atuais.get(chave):
                chaves[chave] = getpass.getpass(f"{rotulo} (Enter para pular; não aparece): ")

    online = True if args.online else (False if args.so_local else None)
    endereco = args.endereco
    if args.online and not endereco and not atuais.get("ESTUDIO_ENDERECO") and interativo:
        endereco = input("Endereço online do painel (ex.: https://painel.seudominio.com.br): ")
    try:
        mudou = configurar(RAIZ, dados=dados, senha=senha, chaves=chaves, online=online,
                           endereco=(endereco or "").lower() or None)
    except ValueError as erro:
        print(f"Não salvei: {erro}", file=sys.stderr)
        return 1
    print("Nada mudou no .env." if not mudou else "Atualizado no .env: " + ", ".join(mudou))
    if online:
        print("No PC, abra também pelo endereço online: o cookie seguro só viaja por https.")
    return 0


def cmd_painel(args: argparse.Namespace) -> int:
    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.permitir_rede:
        print(
            "Recusado: o painel só escuta em 127.0.0.1. Use a Tailscale para acesso remoto "
            "ou passe --permitir-rede (ex.: dentro do Docker).",
            file=sys.stderr,
        )
        return 2
    import uvicorn

    uvicorn.run(
        "painel.app:criar_app", factory=True, host=args.host, port=args.port, proxy_headers=False
    )
    return 0


def cmd_worker(args: argparse.Namespace) -> int:
    from estudio.pipeline import Contexto, rodar_worker, servicos_reais

    cfg, canais, con = _abrir()
    if db.obter_config(con, "dados_exemplo") == "1":
        con.close()
        print(
            f"Recusado: {cfg.db} é o banco de exemplo. O worker gastaria API com vídeos de "
            "mentira. Aponte ESTUDIO_DB para o banco real.",
            file=sys.stderr,
        )
        return 1
    ctx = Contexto(con=con, cfg=cfg, canais=canais, servicos=servicos_reais(cfg))
    rodar_worker(ctx, intervalo=args.intervalo, uma_vez=args.uma_vez)
    return 0


def cmd_gerar(args: argparse.Namespace) -> int:
    _, canais, con = _abrir()
    if args.canal not in canais:
        print(f"Canal desconhecido. Opções: {', '.join(canais)}", file=sys.stderr)
        return 1
    if not 1 <= args.qtd <= 10:
        print("--qtd vai de 1 a 10 (o portão humano precisa dar conta).", file=sys.stderr)
        return 1
    ids = [
        db.criar_video(con, args.canal, args.tema, serie=args.serie, referencia=args.referencia)
        for _ in range(args.qtd)
    ]
    db.registrar_evento(con, "pauta", args.canal, f"lote de {len(ids)}: {args.tema}", "info")
    con.close()
    print("Criados:", " ".join(ids))
    return 0


def cmd_pacote(args: argparse.Namespace) -> int:
    from estudio.pacote import gerar_pacote

    cfg, _, con = _abrir()
    dia = date.fromisoformat(args.data) if args.data else agora().date()
    destino = Path(args.destino) if args.destino else cfg.dados / "Pacotes"
    pasta = gerar_pacote(con, dia, cfg.dados, destino)
    con.close()
    print(f"Pacote em {pasta}")
    return 0


def cmd_nuvem(args: argparse.Namespace) -> int:
    from estudio import nuvem

    cfg = carregar_config()
    if args.acao == "regras":
        email = args.email or cfg.dono_email
        if not email:
            print("Informe o e-mail: uv run estudio nuvem regras --email voce@gmail.com",
                  file=sys.stderr)
            return 1
        print(nuvem.regras_firestore(email))
        return 0
    try:
        if args.acao == "drive-login":
            nuvem.login_drive(cfg.google_oauth_cliente, cfg.google_token)
            print("Drive autorizado. As prévias vão para a pasta "
                  f"'{nuvem.PASTA_DRIVE}' do seu Drive.")
            return 0
        _, canais, con = _abrir()
        con.close()
        nuvem.rodar_ponte(cfg, canais, intervalo=args.intervalo)
    except RuntimeError as erro:
        print(str(erro), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    return 0


def cmd_site(args: argparse.Namespace) -> int:
    from estudio.nuvem import construir_site

    pasta = construir_site(Path(args.saida))
    print(f"Site do painel em {pasta}")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="estudio", description="Estúdio de Canais")
    sub = parser.add_subparsers(dest="comando", required=True)

    sub.add_parser("init", help="cria banco e pastas").set_defaults(func=cmd_init)
    sub.add_parser("seed-exemplo", help="carrega dados de exemplo").set_defaults(func=cmd_exemplo)
    sub.add_parser("senha", help="gera o hash da senha do painel").set_defaults(func=cmd_senha)

    c = sub.add_parser("configurar", help="cria/ajusta o .env (segredo, senha, Drive, chaves)")
    c.add_argument("--dados", help="pasta do Google Drive, ex.: \"G:/Meu Drive/Estudio\"")
    c.add_argument("--trocar-senha", action="store_true")
    modo = c.add_mutually_exclusive_group()
    modo.add_argument("--online", action="store_true",
                      help="painel aberto por endereço https (Cloudflare): cookie só por https")
    modo.add_argument("--so-local", action="store_true",
                      help="painel só em http://127.0.0.1 e Tailscale")
    c.add_argument("--endereco", help="endereço online, ex.: https://painel.seudominio.com.br")
    c.set_defaults(func=cmd_configurar)

    p = sub.add_parser("painel", help="sobe o painel web")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--permitir-rede", action="store_true")
    p.set_defaults(func=cmd_painel)

    w = sub.add_parser("worker", help="roda a linha de produção")
    w.add_argument("--uma-vez", action="store_true")
    w.add_argument("--intervalo", type=float, default=30)
    w.set_defaults(func=cmd_worker)

    g = sub.add_parser("gerar", help="cria um lote de vídeos")
    g.add_argument("--canal", required=True)
    g.add_argument("--tema", required=True)
    g.add_argument("--qtd", type=int, default=1)
    g.add_argument("--serie", default="")
    g.add_argument("--referencia", default="")
    g.set_defaults(func=cmd_gerar)

    n = sub.add_parser("nuvem", help="painel online: ponte com o Firebase e o Google Drive")
    n.add_argument("acao", choices=["rodar", "drive-login", "regras"])
    n.add_argument("--email", help="e-mail do dono (para 'regras')")
    n.add_argument("--intervalo", type=float, default=60)
    n.set_defaults(func=cmd_nuvem)

    s = sub.add_parser("site", help="monta o site do painel para o GitHub Pages")
    s.add_argument("--saida", default="_site")
    s.set_defaults(func=cmd_site)

    k = sub.add_parser("pacote", help="monta o pacote de agendamento de um dia")
    k.add_argument("--data", help="AAAA-MM-DD (padrão: hoje)")
    k.add_argument("--destino")
    k.set_defaults(func=cmd_pacote)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
