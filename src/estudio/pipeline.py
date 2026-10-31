"""Linha de produção: cada ciclo do worker avança uma etapa de cada vídeo.

Etapas que dependem do dono (quadros feitos no Gemini, gancho do Flow, voz própria) ficam
em 'voce' até o arquivo aparecer na pasta do Drive; o painel mostra o que falta.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from estudio import db
from estudio.config import Canal, Config
from estudio.esquemas import Roteiro
from estudio.janela import salvar_janela
from estudio.legendas import EstiloLegenda, Palavra, agrupar, cobertura, gerar_ass
from estudio.montagem import Clipe, Sobreposicao, distribuir_duracoes, montar_comando
from estudio.qualidade import Analise, InfoMidia, avaliar, reprovado
from estudio.roteiro import ClienteLLM, Precos, TetoAtingido, checar_fatos, gerar_roteiro
from estudio.similaridade import mais_parecido
from estudio.tempo import agora, de_iso, iso
from estudio.visuais import Resultado

log = logging.getLogger(__name__)

EXT_IMAGEM = {".png", ".jpg", ".jpeg", ".webp"}
ESPERA_APOS_ERRO = timedelta(minutes=30)
GANCHO_MAX_S = 8.0
JANELA_S = 4.0


@dataclass
class Servicos:
    """Tudo que fala com o mundo lá fora. Os testes trocam por versões falsas."""

    llm: ClienteLLM | None
    sintetizar: Callable[[str, Path], int]
    transcrever: Callable[[Path], list[Palavra]]
    buscar_visual: Callable[[str, set[str]], Resultado | None]
    baixar: Callable[[Resultado, Path], str]
    executar_ffmpeg: Callable[[list[str], Path], None]
    ffprobe: Callable[[Path], InfoMidia]
    analisar: Callable[[Path], Analise]


@dataclass
class Contexto:
    con: sqlite3.Connection
    cfg: Config
    canais: dict[str, Canal]
    servicos: Servicos

    def precos_llm(self) -> Precos:
        def ler(chave: str) -> float | None:
            bruto = db.obter_config(self.con, chave)
            return float(bruto) if bruto else None

        return Precos(ler("preco_entrada_milhao_brl"), ler("preco_saida_milhao_brl"))


Resultado_ = tuple[str, str]  # (status da etapa, nota)


# --------------------------------------------------------------------------- utilidades


def _pasta(ctx: Contexto, canal: Canal, *partes: str) -> Path:
    return canal.pasta_em(ctx.cfg.dados).joinpath(*partes)


def _roteiro(video: sqlite3.Row) -> Roteiro:
    if not video["roteiro_json"]:
        raise RuntimeError("vídeo sem roteiro")
    return Roteiro.model_validate_json(video["roteiro_json"])


def _imagens(pasta: Path) -> list[Path]:
    if not pasta.is_dir():
        return []
    return sorted(p for p in pasta.iterdir() if p.suffix.lower() in EXT_IMAGEM and p.is_file())


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _relativo(ctx: Contexto, caminho: Path) -> str:
    return caminho.resolve().relative_to(ctx.cfg.dados.resolve()).as_posix()


# --------------------------------------------------------------------------- etapas


def etapa_roteiro(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    if ctx.servicos.llm is None:
        raise RuntimeError("GEMINI_API_KEY não configurada")
    r = gerar_roteiro(
        ctx.con,
        ctx.servicos.llm,
        canal,
        video["tema"],
        teto_brl=ctx.cfg.teto_mes_brl,
        precos=ctx.precos_llm(),
        serie=video["serie"],
        referencia=video["referencia"],
        nota=video["nota_refazer"],
    )
    db.atualizar_video(
        ctx.con, video["id"], roteiro_json=r.model_dump_json(), titulo=r.titulo[:120]
    )
    return "feito", f"{len(r.narracao.split())} palavras, {len(r.cenas)} cenas"


def etapa_checagem(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    if ctx.servicos.llm is None:
        raise RuntimeError("GEMINI_API_KEY não configurada")
    chk = checar_fatos(
        ctx.con,
        ctx.servicos.llm,
        _roteiro(video),
        teto_brl=ctx.cfg.teto_mes_brl,
        precos=ctx.precos_llm(),
    )
    avisos = [f"{a.afirmacao.strip()} → {a.sugestao.strip()}" for a in chk.avisos]
    db.atualizar_video(ctx.con, video["id"], aviso=" | ".join(avisos)[:800])
    return "feito", f"{len(avisos)} aviso(s)"


def _prompts_de_quadros(canal: Canal, roteiro: Roteiro) -> str:
    fichas = "; ".join(f"{p.id}: {p.descricao} (ficha: {p.ficha})" for p in canal.personagens)
    linhas = [
        "Gere cada quadro no Gemini anexando as fichas dos personagens que aparecem.",
        "Salve na mesma pasta como 01.png, 02.png ... na ordem abaixo.",
        f"Personagens: {fichas}" if fichas else "",
        f"Evitar: {', '.join(canal.estilo_visual.evitar)}" if canal.estilo_visual.evitar else "",
        "",
    ]
    for i, cena in enumerate(roteiro.cenas, start=1):
        linhas.append(f"Quadro {i:02d}: {canal.estilo_visual.prompt_base.strip()} {cena.visual}")
    return "\n".join(linha for linha in linhas if linha is not None)


def etapa_quadros(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    roteiro = _roteiro(video)
    vid = video["id"]
    if canal.producao.quadros == "manual":
        pasta = _pasta(ctx, canal, "Paineis", vid)
        pasta.mkdir(parents=True, exist_ok=True)
        prompts = pasta / "prompts.txt"
        if not prompts.exists():
            prompts.write_text(_prompts_de_quadros(canal, roteiro), encoding="utf-8")
        imagens = _imagens(pasta)
        if len(imagens) < len(roteiro.cenas):
            return "voce", f"{len(imagens)}/{len(roteiro.cenas)} quadros em Paineis/{vid}"
        ctx.con.execute("DELETE FROM ativos WHERE video_id = ? AND fonte = 'gemini'", (vid,))
        for img in imagens[: len(roteiro.cenas)]:
            db.registrar_ativo(
                ctx.con, vid, fonte="gemini", caminho=_relativo(ctx, img), sha256=_sha256(img),
                licenca="gerado por IA na conta Google AI Pro do dono",
            )
        return "feito", f"{len(roteiro.cenas)} quadros"

    pasta = _pasta(ctx, canal, "Visuais", vid)
    if pasta.exists():
        shutil.rmtree(pasta)  # recomeço limpo: só a pasta deste vídeo
    usados: set[str] = set()
    ctx.con.execute("DELETE FROM ativos WHERE video_id = ? AND fonte IN ('pexels', 'pixabay')",
                    (vid,))
    for i, cena in enumerate(roteiro.cenas):
        resultado = ctx.servicos.buscar_visual(cena.visual, usados) or ctx.servicos.buscar_visual(
            canal.busca_visual_padrao, usados
        )
        if resultado is None:
            raise RuntimeError(f"nenhum visual para a cena {i + 1}: {cena.visual!r}")
        destino = pasta / f"{i:02d}{resultado.extensao}"
        sha = ctx.servicos.baixar(resultado, destino)
        usados.add(resultado.url)
        db.registrar_ativo(
            ctx.con, vid, fonte=resultado.fonte, caminho=_relativo(ctx, destino), sha256=sha,
            licenca=resultado.licenca, url_origem=resultado.pagina or resultado.url,
            autor=resultado.autor,
        )
    return "feito", f"{len(roteiro.cenas)} visuais baixados"


def etapa_gancho(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    if canal.producao.gancho == "nenhum":
        return "pulado", "canal sem gancho animado"
    vid = video["id"]
    arquivo = _pasta(ctx, canal, "Ganchos", f"{vid}.mp4")
    if arquivo.is_file():
        ctx.con.execute("DELETE FROM ativos WHERE video_id = ? AND fonte = 'flow'", (vid,))
        db.registrar_ativo(
            ctx.con, vid, fonte="flow", caminho=_relativo(ctx, arquivo), sha256=_sha256(arquivo),
            licenca="gerado por IA no Flow (Google AI Pro) do dono",
        )
        return "feito", "gancho encontrado"
    roteiro = _roteiro(video)
    prompt = arquivo.with_suffix(".txt")
    if not prompt.exists():
        prompt.parent.mkdir(parents=True, exist_ok=True)
        prompt.write_text(
            "Gere no Flow (Veo, 6 a 8 s, vertical 9:16) a partir do quadro 01:\n"
            f"{canal.estilo_visual.prompt_base.strip()} {roteiro.cenas[0].visual}\n"
            f"Salve como Ganchos/{vid}.mp4",
            encoding="utf-8",
        )
    return "voce", f"gere o gancho no Flow e salve como Ganchos/{vid}.mp4, ou siga sem gancho"


def etapa_voz(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    vid = video["id"]
    audio = _pasta(ctx, canal, "Audio", f"{vid}.wav")
    if canal.producao.voz == "propria":
        if not audio.is_file():
            return "voce", f"grave a narração e salve como Audio/{vid}.wav"
    else:
        caracteres = ctx.servicos.sintetizar(_roteiro(video).narracao, audio)
        preco = db.obter_config(ctx.con, "preco_tts_milhao_chars_brl")
        if preco:
            db.registrar_custo(
                ctx.con, "azure", caracteres / 1e6 * float(preco), detalhe=f"{caracteres} chars"
            )
    duracao = ctx.servicos.ffprobe(audio).duracao
    db.atualizar_video(ctx.con, vid, duracao_s=round(duracao, 2))
    return "feito", f"narração de {duracao:.1f} s"


def _copiar(origem: Path, destino: Path) -> str:
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origem, destino)
    return destino.name


def etapa_montagem(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    vid = video["id"]
    roteiro = _roteiro(video)
    trabalho = _pasta(ctx, canal, "Trabalho", vid)
    if trabalho.exists():
        shutil.rmtree(trabalho)  # só a pasta deste vídeo, dentro da pasta do canal
    trabalho.mkdir(parents=True)

    audio = _pasta(ctx, canal, "Audio", f"{vid}.wav")
    _copiar(audio, trabalho / "narracao.wav")
    total = video["duracao_s"] or ctx.servicos.ffprobe(audio).duracao

    palavras = ctx.servicos.transcrever(audio)
    blocos = agrupar(palavras)
    (trabalho / "legendas.ass").write_text(gerar_ass(blocos, EstiloLegenda()), encoding="utf-8")
    (trabalho / "meta.json").write_text(
        json.dumps({"cobertura": cobertura(blocos, total)}), encoding="utf-8"
    )
    pasta_fontes = None
    if ctx.cfg.fontes_dir.is_dir() and any(ctx.cfg.fontes_dir.glob("*.ttf")):
        for fonte in ctx.cfg.fontes_dir.glob("*.ttf"):
            _copiar(fonte, trabalho / "fontes" / fonte.name)
        pasta_fontes = "fontes"

    if canal.producao.quadros == "manual":
        visuais = _imagens(_pasta(ctx, canal, "Paineis", vid))
    else:
        pasta_vis = _pasta(ctx, canal, "Visuais", vid)
        aceitos = EXT_IMAGEM | {".mp4"}
        visuais = (
            sorted(p for p in pasta_vis.iterdir() if p.is_file() and p.suffix.lower() in aceitos)
            if pasta_vis.is_dir()
            else []
        )
    visuais = visuais[: len(roteiro.cenas)]
    if not visuais:
        raise RuntimeError("nenhum quadro/visual para montar")

    clipes: list[Clipe] = []
    inicio_cenas = 0.0
    gancho = _pasta(ctx, canal, "Ganchos", f"{vid}.mp4")
    etapas = db.etapas_do_video(ctx.con, vid)
    if gancho.is_file() and etapas["gancho"]["status"] == "feito":
        dur_gancho = min(GANCHO_MAX_S, ctx.servicos.ffprobe(gancho).duracao, total / 3)
        clipes.append(Clipe(_copiar(gancho, trabalho / "gancho.mp4"), dur_gancho, eh_video=True))
        inicio_cenas = dur_gancho

    pesos = [len(c.narracao.split()) for c in roteiro.cenas[: len(visuais)]]
    duracoes = distribuir_duracoes(pesos, max(total - inicio_cenas, 1.0))
    comecos: list[float] = []
    t = inicio_cenas
    for i, (origem, dur) in enumerate(zip(visuais, duracoes, strict=True)):
        nome = _copiar(origem, trabalho / f"q{i:02d}{origem.suffix.lower()}")
        clipes.append(Clipe(nome, dur, eh_video=origem.suffix.lower() == ".mp4"))
        comecos.append(t)
        t += dur

    sobreposicoes: list[Sobreposicao] = []
    for k, janela in enumerate(roteiro.janelas):
        if 0 <= janela.cena < len(comecos):
            png = salvar_janela(
                janela, canal.janela_de_missao, ctx.cfg.fontes_dir, trabalho / f"janela{k}.png"
            )
            ini = comecos[janela.cena]
            sobreposicoes.append(Sobreposicao(png.name, ini, min(ini + JANELA_S, total)))

    musica = None
    pasta_musicas = _pasta(ctx, canal, "Musicas")
    if (pasta_musicas / "LICENCAS.txt").is_file():
        opcoes = sorted(pasta_musicas.glob("*.mp3"))
        if opcoes:
            escolhida = opcoes[int(vid, 16) % len(opcoes)]  # varia a trilha entre vídeos
            musica = _copiar(escolhida, trabalho / "musica.mp3")
            db.registrar_ativo(
                ctx.con, vid, fonte="musica", caminho=_relativo(ctx, escolhida),
                licenca="ver Musicas/LICENCAS.txt",
            )

    cmd = montar_comando(
        clipes, "narracao.wav", "saida.mp4", musica=musica, legendas="legendas.ass",
        pasta_fontes=pasta_fontes, sobreposicoes=sobreposicoes,
    )
    ctx.servicos.executar_ffmpeg(cmd, trabalho)
    final = _pasta(ctx, canal, "Renders", f"{vid}.mp4")
    final.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(trabalho / "saida.mp4", final)
    db.atualizar_video(ctx.con, vid, arquivo=_relativo(ctx, final))
    return "feito", f"{len(clipes)} clipes, {len(sobreposicoes)} janela(s)"


def etapa_testes(ctx: Contexto, video: sqlite3.Row, canal: Canal) -> Resultado_:
    vid = video["id"]
    final = ctx.cfg.dados / (video["arquivo"] or "")
    if not video["arquivo"] or not final.is_file():
        raise RuntimeError("vídeo montado não encontrado")
    meta_arquivo = _pasta(ctx, canal, "Trabalho", vid, "meta.json")
    meta = json.loads(meta_arquivo.read_text(encoding="utf-8")) if meta_arquivo.is_file() else {}

    anteriores = [
        (linha["id"], Roteiro.model_validate_json(linha["roteiro_json"]).narracao)
        for linha in ctx.con.execute(
            "SELECT id, roteiro_json FROM videos WHERE canal_id = ? AND id != ? "
            "AND roteiro_json IS NOT NULL AND status != 'rejeitado' "
            "ORDER BY criado_em DESC LIMIT 60",
            (canal.slug, vid),
        )
    ]
    similaridade, _ = mais_parecido(_roteiro(video).narracao, anteriores)
    sem_licenca = ctx.con.execute(
        "SELECT COUNT(*) FROM ativos WHERE video_id = ? AND licenca = ''", (vid,)
    ).fetchone()[0]
    avisos = len([a for a in (video["aviso"] or "").split(" | ") if a.strip()])

    testes = avaliar(
        ctx.servicos.ffprobe(final),
        ctx.servicos.analisar(final),
        cobertura_legenda=float(meta.get("cobertura", 0.0)),
        ativos_sem_licenca=int(sem_licenca),
        similaridade=similaridade,
        avisos_checagem=avisos,
    )
    db.gravar_testes(ctx.con, vid, testes)
    if reprovado(testes):
        db.atualizar_video(ctx.con, vid, status="reprovado")
        return "feito", "reprovado nos testes"
    db.atualizar_video(ctx.con, vid, status="fila")
    return "feito", "passou nos testes"


ETAPA_FUNCAO: dict[str, Callable[[Contexto, sqlite3.Row, Canal], Resultado_]] = {
    "roteiro": etapa_roteiro,
    "checagem": etapa_checagem,
    "quadros": etapa_quadros,
    "gancho": etapa_gancho,
    "voz": etapa_voz,
    "montagem": etapa_montagem,
    "testes": etapa_testes,
}


# --------------------------------------------------------------------------- orquestração


def preparar_refazer(ctx: Contexto, video: sqlite3.Row) -> str:
    """Decide de onde recomeçar a partir da nota do dono e dos testes reprovados."""
    nota = (video["nota_refazer"] or "").lower()
    reprovados = {
        linha["nome"].split()[0]
        for linha in ctx.con.execute(
            "SELECT nome FROM testes WHERE video_id = ? AND status = 'cr'", (video["id"],)
        )
    }
    if "Similaridade" in reprovados:
        inicio = "roteiro"
    elif any(p in nota for p in ("quadro", "imagem", "visual", "cena")):
        inicio = "quadros"
    elif "voz" in nota or "narra" in nota:
        inicio = "voz"
    elif nota:
        inicio = "roteiro"
    else:
        inicio = "montagem"
    db.reabrir_etapas(ctx.con, video["id"], inicio)
    ctx.con.execute("DELETE FROM testes WHERE video_id = ?", (video["id"],))
    canal = ctx.canais.get(video["canal_id"])
    if inicio == "roteiro" and canal is not None:
        # roteiro novo pede prompts novos; os quadros antigos ficam para o dono decidir
        _pasta(ctx, canal, "Paineis", video["id"], "prompts.txt").unlink(missing_ok=True)
        _pasta(ctx, canal, "Ganchos", f"{video['id']}.txt").unlink(missing_ok=True)
    db.atualizar_video(ctx.con, video["id"], status="produzindo")
    db.registrar_evento(ctx.con, "refazer", video["id"], f"recomeçando em {inicio}", "info")
    return inicio


def processar_video(ctx: Contexto, video_id: str) -> str | None:
    video = db.obter_video(ctx.con, video_id)
    if video is None:
        return None
    if video["status"] == "refazer":
        preparar_refazer(ctx, video)
        video = db.obter_video(ctx.con, video_id)
    etapa = db.proxima_etapa(ctx.con, video_id)
    if etapa is None or video is None:
        return None
    canal = ctx.canais.get(video["canal_id"])
    if canal is None:
        db.registrar_evento(ctx.con, etapa, video_id, "canal sem configuração", "cr")
        return None

    linha = db.etapas_do_video(ctx.con, video_id)[etapa]
    estado_anterior = linha["status"]
    if estado_anterior == "erro" and agora() - de_iso(linha["atualizado_em"]) < ESPERA_APOS_ERRO:
        return None  # espera antes de tentar de novo, para não martelar a API

    alvo = f"{canal.slug}/{video_id}"
    db.definir_etapa(ctx.con, video_id, etapa, "rodando")
    try:
        status, nota = ETAPA_FUNCAO[etapa](ctx, video, canal)
    except TetoAtingido as erro:
        if linha["nota"] != str(erro):  # avisa uma vez, não a cada ciclo
            db.registrar_evento(ctx.con, etapa, alvo, f"pausado: {erro}", "at")
        db.definir_etapa(ctx.con, video_id, etapa, "espera", str(erro))
        return None
    except Exception as erro:  # noqa: BLE001 - toda falha vira evento visível no console
        log.exception("etapa %s falhou para %s", etapa, video_id)
        db.definir_etapa(ctx.con, video_id, etapa, "erro", str(erro))
        db.atualizar_video(ctx.con, video_id, status="produzindo")
        db.registrar_evento(ctx.con, etapa, alvo, f"erro: {erro}", "cr")
        return etapa

    db.definir_etapa(ctx.con, video_id, etapa, status, nota)
    if status == "voce":
        db.atualizar_video(ctx.con, video_id, status="voce")
        if estado_anterior == "voce" and linha["nota"] == nota:
            return None  # nada mudou: não conta como trabalho nem enche o console
        db.registrar_evento(ctx.con, etapa, alvo, f"esperando você: {nota}", "at")
        return etapa
    if etapa == "testes":
        final = db.obter_video(ctx.con, video_id)
        nivel = "cr" if final is not None and final["status"] == "reprovado" else "ok"
        db.registrar_evento(ctx.con, etapa, alvo, nota, nivel)
    else:
        db.atualizar_video(ctx.con, video_id, status="produzindo")
        db.registrar_evento(ctx.con, etapa, alvo, nota, "ok")
    return etapa


def ciclo(ctx: Contexto, limite: int = 5) -> int:
    db.definir_config(ctx.con, "worker_batimento", iso())
    linhas = ctx.con.execute(
        "SELECT v.id FROM videos v JOIN canais c ON c.id = v.canal_id "
        "WHERE c.ligado = 1 AND v.status IN ('pauta', 'produzindo', 'voce', 'refazer') "
        "ORDER BY v.atualizado_em LIMIT ?",
        (limite,),
    ).fetchall()
    feitos = 0
    for linha in linhas:
        if processar_video(ctx, linha["id"]) is not None:
            feitos += 1
    return feitos


def rodar_worker(ctx: Contexto, intervalo: float = 30, uma_vez: bool = False) -> None:
    while True:
        feitos = ciclo(ctx)
        if uma_vez:
            return
        time.sleep(1 if feitos else intervalo)


def servicos_reais(cfg: Config) -> Servicos:
    """Monta os serviços de verdade (rede, Azure, FFmpeg)."""
    import httpx

    from estudio import montagem, qualidade, visuais, voz
    from estudio.legendas import transcrever
    from estudio.roteiro import ClienteGemini

    cliente_http = httpx.Client(timeout=60, headers={"User-Agent": "estudio-canais"})
    llm = ClienteGemini(cfg.gemini_chave, cfg.gemini_modelo) if cfg.gemini_chave else None
    return Servicos(
        llm=llm,
        sintetizar=lambda texto, destino: voz.sintetizar(
            texto, destino, chave=cfg.azure_chave, regiao=cfg.azure_regiao, voz=cfg.azure_voz,
            cliente=cliente_http,
        ),
        transcrever=transcrever,
        buscar_visual=lambda termo, usados: visuais.buscar(
            termo, pexels_chave=cfg.pexels_chave, pixabay_chave=cfg.pixabay_chave,
            usados=usados, cliente=cliente_http,
        ),
        baixar=lambda resultado, destino: visuais.baixar(resultado, destino, cliente_http),
        executar_ffmpeg=montagem.executar_ffmpeg,
        ffprobe=qualidade.rodar_ffprobe,
        analisar=qualidade.rodar_analise,
    )
