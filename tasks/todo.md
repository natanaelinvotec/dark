# Tarefas — Estúdio de Canais

> Spec: `SPEC.md` · Plano: `tasks/plan.md`
> Legenda: [x] feito e verificado · [~] código escrito, **ainda não executado** (rodar `uv run pytest -q`) · [ ] a fazer

## Estado da verificação (31/10/2026)
- Revisão independente rodou 62/62 testes (sem o painel, que pede FastAPI) e um filtro real do FFmpeg 4.4; os problemas achados foram corrigidos:
  teto só com gasto de IA, `seed-exemplo` só em banco vazio, worker recusa banco de exemplo, SQLite entre threads,
  `ebur128=framelog=verbose` + código de saída, worker sem loop de 1 s nem console poluído, `revisao_s` sem teto 422,
  hash da senha entre aspas, `HF_HOME` no Docker, aba da fila sem itens "recentes" de outra aba, Pixabay com URL vazia.
- Depois das correções, verificado aqui: compilação de todos os `.py`, `node --check` no front, 7 testes de legendas/similaridade
  e o comando de análise do FFmpeg. **Falta rodar no seu PC:** `uv run pytest -q` e `uv run ruff check .` (o CI do GitHub também roda).

## Fase 3b — Plataformas e instalação (31/10/2026)
- [~] **P1 Cadastro de plataformas** (`plataformas.yaml`, `config.py`): 6 redes com programa, requisitos, Brasil, links oficiais e domínios; canal lista onde publica.
- [~] **P2 Publicação assistida** (`publicacao.py`, tela Plataformas): baixar MP4, copiar legenda por rede, abrir envio oficial, colar link, marcar publicado/pulado.
- [~] **P3 Contas por canal**: @, situação, 2FA, números e progresso até a meta de cada programa.
- [~] **P4 Duração 61–80 s** + teste "Duração p/ monetizar".
- [~] **P5 Instalação** (`instalar.bat`, `iniciar.bat`, `parar.bat`, `estudio configurar`), Tailscale opcional.
- [ ] **P6 Contas reais** (manual): criar perfis no TikTok (pessoal), Facebook (página/modo profissional), Instagram (profissional), Kwai e Snapchat com passkey/2FA; preencher a aba Contas.
- [ ] **P7 Metricool** (opcional): agendar YouTube/TikTok/Facebook/Instagram pelo conector, depois de testar 1 vídeo manual em cada rede.
- [ ] **P8 Revisar `plataformas.yaml`** a cada 90 dias (o painel avisa).
- [~] **P9 Acesso online** (`online.bat`, `estudio configurar --online`): Cloudflare Tunnel como serviço + cookie Secure/Lax.
- [ ] **P10 Cloudflare** (manual): domínio na Cloudflare, Access com One-time PIN só para o seu e-mail, túnel e rota Published application → http://127.0.0.1:8787.

## Fase 1 — Fundação
- [ ] **T1 Contas** (manual): 2 canais + conta de clipping, passkey/chave física, canais criados em dias diferentes.
- [~] **T2 Repositório e ambiente**: `pyproject.toml`, `Dockerfile`, `docker-compose.yml`, CI, `.env.example`, `SECURITY.md`.
  - Verificar: `uv sync --all-extras` · `uv run pytest -q` · `docker compose build`.

## Fase 2 — Pipeline
- [~] **T3 Roteiro + checagem** (`roteiro.py`, `esquemas.py`) — schema, até 3 tentativas, teto de gasto, pauta delimitada.
- [~] **T4 Voz + legendas** (`voz.py`, `legendas.py`) — Azure REST, ASS palavra a palavra, voz própria aceita.
- [~] **T5 Visuais** (`visuais.py`) — Pexels/Pixabay, hosts permitidos, limite de tamanho, licença registrada.
- [~] **T6 Montagem** (`montagem.py`, `janela.py`) — FFmpeg 9:16, zoom alternado, janelas de missão, música só com `Musicas/LICENCAS.txt`.
- [~] **Testes automáticos** (`qualidade.py`) — formato, áudio, tela preta, silêncio, legenda, licenças, similaridade, checagem.
- [~] **Worker** (`pipeline.py`) — uma etapa por ciclo, espera de 30 min após erro, "esperando você" sem poluir o console.
- [ ] **Checkpoint B**: 5 Shorts de curiosidades de ponta a ponta com chaves reais; medir custo por vídeo.

## Fase 3 — Painel e publicação
- [~] **T7 Painel** (`src/painel/`) — login scrypt, `X-Estudio`, CSP, telas: visão geral, aprovação, produção + console, canais, séries, dinheiro, configurações, saúde, mais.
- [~] **T8 Pacote de agendamento** (`pacote.py`) — pasta do dia + CSV protegido contra fórmula.
- [ ] **T8b Pedido de auditoria da YouTube Data API** (manual).
- [ ] **T9 Canal bíblico**: preencher o bloco `sistema:` do YAML (decisão do dono) e escolher a tradução com licença.

## Fase 4 — Formatos, clipping e métricas
- [ ] **T10 Variações**: versão TikTok de 61–90 s e vídeo longo da temporada.
- [ ] **T11 Clipping**: cadastro de campanhas pelo painel (hoje só pelo banco/exemplo).
- [ ] **T12 Métricas**: coletor da YouTube Analytics API → `metricas_dia` e `config metrica:*`.
- [ ] **T12b Gatilho**: implementar `deve_abrir_proximo_canal()` em `src/estudio/gatilho.py` (**regra do dono**).

## Próximas telas (sugeridas)
- [ ] Calendário de publicação · [ ] Ativos e licenças · [ ] Banco de pautas · [ ] Comentários com resposta aprovada · [ ] Alertas no celular

## Fase 5 — Depois da auditoria
- [ ] **T13** Publicação via YouTube Data API (escopo só `youtube.upload`, processo separado).
- [ ] **T14** Faixas de áudio em outros idiomas no mesmo canal.
