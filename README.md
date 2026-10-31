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

## Primeiros passos (Windows)

Dê dois cliques em **`instalar.bat`**. Ele instala o uv e o FFmpeg, baixa as bibliotecas, pergunta
a senha do painel, a pasta do Drive e as chaves (que ficam só no `.env` deste PC), cria as pastas
dos canais, roda os testes e, se você quiser, configura a Tailscale e liga tudo com o Windows.
Pode rodar de novo quando quiser: o que já está pronto é pulado.

Depois, no dia a dia:

| Arquivo | O que faz |
|---|---|
| `iniciar.bat` | liga o painel e o worker em segundo plano e abre http://127.0.0.1:8787 |
| `parar.bat` | desliga os dois |
| `instalar.bat` | reinstala ou muda a configuração (`uv run estudio configurar --trocar-senha` troca só a senha) |

Registros ficam em `dados\logs`. Preferir fazer à mão:

```powershell
uv sync --all-extras
uv run estudio configurar     # cria o .env: segredo, senha, pasta do Drive e chaves
uv run estudio init
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

## Publicar nas plataformas (tela Plataformas)

Os vídeos têm 61–80 s: é a faixa que rende em todas as redes (o TikTok só paga a partir de 1 min,
e o Reels pela API vai até 90 s). Cada canal lista onde publica em `plataformas:` no YAML.

- **Para publicar:** cada vídeo aprovado aparece com uma linha por plataforma. **Baixar vídeo** salva
  o MP4 (no celular também), **Copiar legenda** já vem no formato da rede, **Abrir …** vai direto
  para a página de envio oficial. Depois cole o link do post e clique em **Marcar publicado**
  (ou **Pular**). O Kwai só aceita envio pelo app.
- **Contas e programas:** o programa de cada rede, os requisitos, se vale no Brasil, os links de
  entrar/subir/painel e, por canal, o seu @, a situação, a verificação em 2 etapas e os números
  (seguidores, views…) com o progresso até a meta.
- O painel **nunca pede nem guarda senha** das plataformas. As regras ficam em `plataformas.yaml`,
  com a data em que foram conferidas; o painel avisa quando passarem de 90 dias.

## Acesso pelo celular

O `instalar.bat` configura isso se você responder "s". À mão: instale a Tailscale no PC e no
celular, entre na mesma conta e publique o painel só na sua rede:

```powershell
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status        # mostra o endereço https para abrir no celular
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
channels/            um YAML por canal (enabled liga/desliga; plataformas onde publica)
plataformas.yaml     programas, requisitos e links oficiais de cada rede (conferidos em 31/10/2026)
scripts/             instalar, iniciar e parar no Windows (chamados pelos .bat da raiz)
src/estudio/         núcleo, pipeline e linha de comando
src/painel/          API (FastAPI), segurança, consultas e front (static/)
tests/               pytest
assets/fonts/        fontes OFL
tasks/               plano e tarefas
```

## O que este projeto não faz (de propósito)

Não cria contas nem canais, não aprova em lote, não publica sem você assistir e não repete o mesmo vídeo em canais diferentes. Esses são exatamente os padrões que derrubam canais.
