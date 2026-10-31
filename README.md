# Estúdio de Canais

Linha de produção de vídeos curtos com IA + painel de aprovação "um toque".
A máquina escreve, narra, monta e testa; você assiste e aprova (≈8 min por vídeo).

- **Especificação:** [`SPEC.md`](SPEC.md) · **Estratégia e riscos:** [`tasks/plan.md`](tasks/plan.md) · **Tarefas:** [`tasks/todo.md`](tasks/todo.md) · **Segurança:** [`SECURITY.md`](SECURITY.md)

## Como funciona

```
lote → roteiro (Gemini) → checagem → quadros (você no Gemini, ou Pexels/Pixabay) → gancho (Flow, opcional)
     → voz (Azure ou sua) → montagem (FFmpeg + legendas + janela de missão) → testes → painel (você aprova)
     → pacote de agendamento (pasta do dia + CSV) → YouTube Studio / Metricool
```

Cada canal é um arquivo em `channels/`. Os arquivos de trabalho ficam na pasta do Google Drive sincronizada.

## Primeiros passos (Windows, PowerShell)

```powershell
winget install astral-sh.uv
winget install Gyan.FFmpeg
cd C:\Users\kungamble\Documents\Projetos\dark

uv sync --all-extras          # instala tudo e cria o uv.lock
Copy-Item .env.example .env   # depois edite o .env
uv run estudio senha          # cole a linha inteira no .env (com as aspas)
uv run python -c "import secrets; print(secrets.token_urlsafe(48))"   # ESTUDIO_SEGREDO_SESSAO
uv run estudio init           # cria o banco e as pastas no Drive
uv run estudio painel         # http://127.0.0.1:8787
```

Quer conhecer o painel com os dados do mockup antes de gastar API? Use um banco separado
(o real nunca recebe dados de mentira, e o worker se recusa a rodar no de exemplo):

```powershell
$env:ESTUDIO_DB = "dados/exemplo.db"
uv run estudio seed-exemplo
uv run estudio painel
Remove-Item Env:ESTUDIO_DB    # volta para o banco real
```

Fontes da janela de missão e das legendas: veja [`assets/fonts/LEIA-ME.md`](assets/fonts/LEIA-ME.md).

## Primeiro vídeo de verdade

```powershell
uv run estudio gerar --canal curiosidades --tema "Os relâmpagos do Catatumbo" --qtd 1
uv run estudio worker          # deixe rodando; Ctrl+C para parar
```

No canal bíblico, o worker para em **Quadros** e escreve `Paineis/<id>/prompts.txt` na pasta do canal.
Gere os quadros no Gemini (anexando as fichas de `Personagens/`), salve como `01.png`, `02.png`… e o worker segue sozinho.
O gancho animado é igual: `Ganchos/<id>.txt` → salve `Ganchos/<id>.mp4`, ou clique em **Seguir sem gancho** no painel.

Aprovados viram pacote com:

```powershell
uv run estudio pacote --data 2026-11-01
```

## Acesso pelo celular

Instale a Tailscale no PC e no celular e publique o painel só na sua rede:

```powershell
tailscale serve --bg https / http://127.0.0.1:8787
```

Com HTTPS da Tailscale, ponha `ESTUDIO_COOKIE_SEGURO=1` no `.env`.
Pelo `tailscale serve` todo acesso chega como 127.0.0.1, então o limite de 10 tentativas de login
vale para todos os aparelhos juntos (se errar muito no celular, espere 15 min no PC também).

## Testes e qualidade

```powershell
uv run pytest -q              # sem rede; o teste com FFmpeg real roda se o FFmpeg estiver instalado
uv run ruff check .
uv run pip-audit
```

## GitHub

Repositório: <https://github.com/natanaelinvotec/dark> (recomendado: **privado**, em Settings → General → Danger Zone).

Mandar alterações:

```powershell
git status                    # o .env e a pasta dados/ NUNCA podem aparecer aqui
git add .
git commit -m "fix: o que mudou"
git push
```

Cada `push` roda o CI (ruff, pytest, pip-audit) na aba **Actions**.

## Estrutura

```
channels/            um YAML por canal (enabled liga/desliga)
src/estudio/         núcleo, pipeline e linha de comando
src/painel/          API (FastAPI), segurança, consultas e front (static/)
tests/               pytest
assets/fonts/        fontes OFL
tasks/               plano e tarefas
```

## O que este projeto não faz (de propósito)

Não cria contas nem canais, não aprova em lote, não publica sem você assistir e não repete o mesmo vídeo em canais diferentes. Esses são exatamente os padrões que derrubam canais.
