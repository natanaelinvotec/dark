# Spec: Estúdio de Canais

> Versão 1 · 31/10/2026 · Estratégia e riscos em `tasks/plan.md`; tarefas em `tasks/todo.md`; desenho das telas no mockup "Painel do Estúdio de Canais".

## Premissas (já combinadas)
1. Um único usuário (o dono). Acesso ao painel só pela rede Tailscale **e** com senha.
2. Arquivos de trabalho na pasta do **Google Drive sincronizada** no PC/VPS ("Drive para computador"); o programa lê e grava como pasta local.
3. Sem Firebase. Estado em **SQLite**.
4. Publicação v1 = **pacote de agendamento** (pasta do dia + CSV). API do YouTube só depois da auditoria.
5. Quadros do canal bíblico e ganchos animados são **feitos à mão** (assinatura Google AI Pro, sem API); o pipeline prepara os prompts e espera os arquivos.

## Mapa de módulos

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `nucleo` | Configuração, canais (YAML), banco SQLite, eventos, custos, ações da fila | — |
| `pipeline` | Etapas: roteiro, checagem, quadros, gancho, voz, montagem, testes; worker; CLI | `nucleo` |
| `painel` | API JSON + login + front HTML/CSS/JS do mockup | `nucleo` (lê o que o pipeline grava) |

Ordem: `nucleo` → `pipeline` e `painel` (independentes entre si; conversam só pelo banco).

## Objetivo

Reduzir o trabalho humano a **≈8 min por vídeo**: a máquina pesquisa, escreve, narra, monta e testa; o dono só assiste e aprova com um toque.

**Histórias de uso**
- Como dono, gero um lote ("Temporada Davi, eps. 7 a 9, 3 vídeos") e o pipeline avança sozinho até onde depender de mim.
- Como dono, vejo na fila cada vídeo com prévia, testes automáticos e avisos da checagem, e aprovo, peço para refazer (com nota) ou rejeito — sempre com **Desfazer**.
- Como dono, sei quanto gastei de IA, quanto entrou e se o gatilho do próximo canal abriu.

## Tech stack
- Python 3.12 · FastAPI · Uvicorn · Pydantic 2 · PyYAML · httpx · google-genai · Pillow · tzdata · itsdangerous · faster-whisper (extra `voz`)
- FFmpeg 6+ (binário do sistema) · SQLite (stdlib)
- Front: HTML + CSS + JavaScript sem framework (identidade do MEGA-PAINEL-MASTER: trilho 56px `#0A1630`, Sora/Manrope, rotas por hash)
- Ferramentas: uv (dependências e lock), pytest, ruff, pip-audit, GitHub Actions

## Comandos
```
Instalar ............ uv sync --all-extras
Criar banco/pastas .. uv run estudio init
Dados de exemplo .... ESTUDIO_DB=dados/exemplo.db uv run estudio seed-exemplo  (recusa banco com vídeos)
Gerar hash da senha . uv run estudio senha
Painel .............. uv run estudio painel --host 127.0.0.1 --port 8787
Worker .............. uv run estudio worker            (ou --uma-vez)
Gerar lote .......... uv run estudio gerar --canal curiosidades --tema "Relâmpagos do Catatumbo" --qtd 1
Pacote do dia ....... uv run estudio pacote --data 2026-11-01
Testes .............. uv run pytest -q          (make test)
Lint ................ uv run ruff check .        (make lint)
Auditoria deps ...... uv run pip-audit          (make audit)
Docker .............. docker compose up -d
```

## Estrutura
```
channels/            um YAML por canal (enabled liga/desliga)
tasks/               plan.md e todo.md
assets/fonts/        fontes OFL da janela de missão e das legendas
src/estudio/         núcleo + pipeline + CLI
src/painel/          API FastAPI, segurança, consultas e front (static/)
tests/               pytest (sem rede; ffmpeg real só nos testes marcados)
.github/workflows/   CI: lint, testes, pip-audit
```

## Modelo de dados (SQLite)
| Tabela | Campos principais |
|---|---|
| `canais` | id, nome, cor, ligado |
| `videos` | id, canal_id, titulo, serie, referencia, tema, status, roteiro_json, duracao_s, arquivo, horario, aviso, nota_refazer, revisao_s, criado_em, atualizado_em |
| `etapas` | (video_id, etapa) → status, nota, atualizado_em |
| `testes` | (video_id, nome) → status `ok/at/cr`, detalhe, ordem |
| `eventos` | ts, etapa, alvo, msg, nivel — alimenta o console |
| `acoes` | ts, video_id, acao, nota, status_anterior — auditoria das aprovações |
| `custos` | ts, fornecedor, valor_brl, tokens_in, tokens_out, detalhe |
| `ativos` | video_id, fonte, url_origem, autor, licenca, caminho, sha256 |
| `metricas_dia` | data, canal_id, views |
| `receitas` | mes, fonte, valor_brl, situacao `prevista/aprovada/paga` |
| `campanhas` | nome, tipo, valor_mil_usd, teto_views, views_aprovadas, horas, situacao |
| `config` | chave, valor (teto, câmbio, preços, batimento do worker) |

`videos.status`: `pauta → produzindo ⇄ voce → fila | reprovado → aprovado | rejeitado | refazer → publicado`.
Etapas: `pauta, roteiro, checagem, quadros, gancho, voz, montagem, testes`; status de etapa: `espera, rodando, voce, feito, erro, pulado`.

## API do painel (JSON, tudo exige sessão)
| Método e rota | Faz |
|---|---|
| `POST /login` · `POST /logout` | sessão (cookie httpOnly, SameSite=Strict) |
| `GET /api/resumo` | KPIs, "Precisa de você", contagem por etapa, gatilho |
| `GET /api/fila?aba=fila\|prontos\|reprovados\|agendados` | abas com contagem + cartões |
| `POST /api/videos/{id}/acao` `{acao, nota?}` | aprovar, refazer, rejeitar, desfazer (grava em `acoes`) |
| `POST /api/videos/{id}/etapas/gancho/pular` | seguir sem gancho animado |
| `GET /api/videos/{id}/previa` | MP4 — recusa caminho fora da pasta de dados |
| `GET /api/producao` · `POST /api/lotes` | vídeos em produção + console; criar lote |
| `GET /api/canais` · `POST /api/canais/{id}/ligado` | canais e liga/desliga |
| `GET /api/series` | séries com episódios |
| `GET /api/dinheiro` | cascata, custos de IA, campanhas |
| `GET /api/config` · `POST /api/config` | teto, câmbio, preços; chaves só como "configurada sim/não" |
| `GET /api/saude` | batimento do worker, último evento, disco, FFmpeg, pasta do Drive |

Todo `POST` exige o cabeçalho `X-Estudio: 1` (defesa contra CSRF junto com SameSite=Strict).

## Estilo de código
```python
def validar_roteiro(r: Roteiro, canal: Canal) -> list[str]:
    """Devolve a lista de problemas; vazia = roteiro aceito."""
    problemas: list[str] = []
    palavras = len(r.narracao.split())
    if not canal.formato.palavras_min <= palavras <= canal.formato.palavras_max:
        problemas.append(f"narração com {palavras} palavras")
    if len(r.gancho.split()) > 12:
        problemas.append("gancho com mais de 12 palavras")
    if not r.fontes:
        problemas.append("roteiro sem fontes")
    return problemas
```
- Nomes de domínio em português (canal, roteiro, etapa); type hints em tudo; funções pequenas e puras sempre que possível; I/O nas bordas.
- `subprocess` sempre com **lista de argumentos** (nunca `shell=True`); nomes de arquivo gerados por UUID.
- Saída de LLM = entrada não confiável: schema + validação antes de usar.
- Front: todo texto do banco passa por `esc()` antes de virar HTML.
- ruff: linha 100, regras `E,F,I,B,UP,S` (exceções de `subprocess` justificadas na linha).

## Estratégia de testes
- **Unidade (padrão):** validação de roteiro, similaridade, parsers da saída do FFmpeg, construtor do comando de montagem, gerador de ASS, janela de missão, hash de senha, limite de tentativas, guarda de caminho, horário sugerido, ações da fila, CSV do pacote.
- **API:** `TestClient` com banco temporário — login, 401 sem sessão, 403 sem `X-Estudio`, ações na fila e auditoria, prévia fora da pasta recusada, config sem segredos.
- **Pipeline:** ciclo do worker com serviços falsos (sem rede, sem FFmpeg).
- **Integração (marcador `ffmpeg`):** monta um vídeo de 2 s de verdade; pulado se o FFmpeg não estiver instalado.

## Limites
- **Sempre:** humano assiste e aprova cada vídeo; validar saída da LLM; registrar licença de cada ativo; segredos só no ambiente; rodar testes antes de commit.
- **Perguntar antes:** dependência nova; mudança no esquema do banco; publicar via API; subir o teto de gasto.
- **Nunca:** criar contas ou canais automaticamente; aprovar em lote; publicar sem aprovação; repostar o mesmo vídeo em canais diferentes; responder comentários sem revisão; devolver chaves pela API; expor o painel em porta pública.

## Critérios de sucesso
1. `uv run pytest -q` verde e `uv run ruff check .` limpo na máquina do dono e no CI.
2. Com `ESTUDIO_DB=dados/exemplo.db`: `estudio init && estudio seed-exemplo && estudio painel` → login funciona; as telas Visão geral, Aprovação, Produção, Canais, Séries, Dinheiro, Configurações e Saúde mostram os dados de exemplo; aprovar/refazer/rejeitar/desfazer persistem e aparecem na auditoria.
3. Com chaves e FFmpeg: `estudio gerar --canal curiosidades ... --qtd 1` + worker produz um MP4 1080×1920 com legendas, testes registrados e o vídeo na fila.
4. Segurança: POST sem `X-Estudio` → 403; sem sessão → 401; 11ª tentativa de login em 15 min → 429; `/api/config` nunca contém chave.

## Perguntas em aberto
- Nome do modelo Gemini vigente (variável `GEMINI_MODELO`).
- Voz da Azure preferida e se o bíblico terá a sua voz.
- Tradução bíblica e licença.
- Rodar na VPS ou no PC de casa.
- Regras do Sistema (bloco `sistema:` do YAML bíblico) e a função `deve_abrir_proximo_canal()` — decisões do dono.
