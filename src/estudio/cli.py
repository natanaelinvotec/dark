"""Linha de comando: `estudio <comando>`."""

from __future__ import annotations

import argparse
import getpass
import logging
import sys
from datetime import date
from pathlib import Path

from estudio import db
from estudio.config import carregar_canais, carregar_config
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


def cmd_senha(_: argparse.Namespace) -> int:
    from painel.seguranca import gerar_hash

    senha = getpass.getpass("Nova senha do painel (mín. 12 caracteres): ")
    if len(senha) < 12:
        print("Senha curta demais.", file=sys.stderr)
        return 1
    if getpass.getpass("Repita: ") != senha:
        print("As senhas não conferem.", file=sys.stderr)
        return 1
    # aspas simples: o hash tem '$', que o docker compose e alguns shells tentariam expandir
    print("Cole no .env (com as aspas):")
    print(f"ESTUDIO_SENHA_HASH='{gerar_hash(senha)}'")
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


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="estudio", description="Estúdio de Canais")
    sub = parser.add_subparsers(dest="comando", required=True)

    sub.add_parser("init", help="cria banco e pastas").set_defaults(func=cmd_init)
    sub.add_parser("seed-exemplo", help="carrega dados de exemplo").set_defaults(func=cmd_exemplo)
    sub.add_parser("senha", help="gera o hash da senha do painel").set_defaults(func=cmd_senha)

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

    k = sub.add_parser("pacote", help="monta o pacote de agendamento de um dia")
    k.add_argument("--data", help="AAAA-MM-DD (padrão: hoje)")
    k.add_argument("--destino")
    k.set_defaults(func=cmd_pacote)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
