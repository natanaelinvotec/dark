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
| `online.bat` | põe o painel num endereço seu, protegido pelo login da Cloudflare (veja "Acesso online") |
| `enviar-github.bat` | manda o código para o GitHub (na 1ª vez troca o upload feito pelo site) |

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

## Painel online: https://natanaelinvotec.github.io/dark/

Igual ao provador: um site no GitHub Pages que abre em qualquer navegador. Os dados ficam no
**Firebase** (projeto só dos canais, plano grátis) e as prévias dos vídeos no seu **Google Drive**.
A fábrica continua no PC: o `iniciar.bat` liga também a **ponte** (`estudio nuvem rodar`), que
publica as telas no Firebase, executa em segundos o que você aprovar online e sobe cada vídeo
pronto para a pasta "Estúdio de Canais - prévias" do Drive. Com o PC desligado, o painel abre
com os últimos dados e guarda as suas decisões até ele ligar.

Antes de ligar o Firebase o link abre em **modo demonstração** (dados de exemplo, nada é salvo).
O site é montado e publicado sozinho pelo GitHub Actions a cada `enviar-github.bat`.

**Ligar com os seus dados (uma vez, uns 15 minutos):**

1. **Projeto:** console.firebase.google.com → *Adicionar projeto* → `estudio-canais` → sem Analytics.
2. **Login:** *Authentication* → *Vamos começar* → **Google** → Ativar. Em *Configurações › Domínios
   autorizados* → adicione `natanaelinvotec.github.io`.
3. **Banco:** *Firestore Database* → *Criar banco* → `southamerica-east1` (São Paulo) → modo de
   produção. Na aba **Regras**, cole o que este comando mostrar e clique em *Publicar*:
   `uv run estudio nuvem regras --email seu-email@gmail.com`
4. **Site:** *Configurações do projeto* → *Seus apps* → **Web** (`</>`) → apelido `painel`. Copie
   `apiKey`, `authDomain`, `projectId` e `appId` para `site/config.js` e ponha o seu e-mail em `dono`.
5. **Chave do PC:** *Configurações do projeto* → *Contas de serviço* → *Gerar nova chave privada* →
   salve como `dados\firebase-servico.json`. É segredo: fica só no PC (o `.gitignore` bloqueia).
6. **Drive:** em console.cloud.google.com, no mesmo projeto: *APIs e serviços › Biblioteca* →
   **Google Drive API** → Ativar. *Tela de permissão OAuth* → Externo → nome `Estúdio` → seu e-mail
   → *Publicar app*. *Credenciais* → *Criar credenciais* → *ID do cliente OAuth* → **App para
   computador** → baixe o JSON e salve como `dados\google-oauth.json`.
7. **No PC:** ponha `DONO_EMAIL=seu-email@gmail.com` no `.env` e rode
   `uv run estudio nuvem drive-login` (autoriza no navegador; o app só enxerga os arquivos que ele
   mesmo cria). Depois `enviar-github.bat` e `iniciar.bat`.

Pronto: entre no link com a sua conta Google. As prévias tocam do Drive (link não listado: só quem
tem o link acha). O plano grátis do Firestore sobra: a ponte só regrava uma tela quando ela muda.

## Abrir o painel pelo GitHub (Codespaces) — alternativa sem Firebase

O GitHub guarda o código; quem **roda** o painel é o **Codespaces**, um computador na nuvem do
próprio GitHub. O painel abre num link `https://…-8787.app.github.dev`, só para você (pede o seu
login do GitHub). Não precisa de domínio, Cloudflare nem PC ligado.

1. No PC, dê dois cliques em **`enviar-github.bat`** (manda o código, incluindo a pasta oculta
   `.devcontainer`, que o upload pelo site não leva).
2. Em https://github.com/natanaelinvotec/dark → botão verde **Code** → aba **Codespaces** →
   **Create codespace on main**. A primeira vez leva alguns minutos (instala tudo sozinho).
3. No terminal que aparece embaixo, rode `uv run estudio configurar` (senha do painel e chaves;
   na pergunta da pasta, só Enter) e depois `bash scripts/codespace-iniciar.sh`.
4. O painel abre numa aba. Guarde esse link nos favoritos (no celular também).

Para voltar depois: https://github.com/codespaces → clique no codespace → o painel sobe sozinho
(aba **Portas**, porta 8787).

| Limite (conta grátis) | O que fazer |
|---|---|
| 120 horas-núcleo/mês ≈ 60 h na máquina de 2 núcleos | Feche quando terminar; veja o uso em github.com/settings/billing |
| Adormece após 30 min parado (painel e worker param) | Aumente para até 240 min em github.com/settings/codespaces |
| Login do link vale 3 h | Depois disso o GitHub pede o login de novo; é normal |
| Codespace parado por muito tempo é apagado (com o banco e os vídeos) | Abra ao menos 1 vez por mês e baixe os vídeos aprovados; nos três pontinhos do codespace use **Keep codespace** |

Os arquivos ficam em `dados/drive` dentro do Codespace (o Drive do PC não existe lá). Os quadros
do canal bíblico você arrasta para a pasta `dados/drive/Canal-Biblico/Paineis/<id>/` no
explorador de arquivos à esquerda; os vídeos prontos você baixa pelo botão **Baixar vídeo**.

## Acesso online (qualquer navegador, sem instalar app)

Um endereço seu (ex.: `https://painel.seudominio.com.br`) que abre em qualquer navegador, com
**duas trancas**: primeiro o login da Cloudflare (código de 6 dígitos no seu e-mail; só o seu
e-mail passa), depois a senha do painel. O PC liga para a Cloudflare; nenhuma porta é aberta no
roteador e o painel continua escutando só em `127.0.0.1`. O PC precisa estar ligado.

Você vai precisar de: conta grátis na Cloudflare e um domínio (ex.: um `.com.br` no registro.br).

1. **Domínio na Cloudflare:** em cloudflare.com, *Add a domain* → plano **Free** → troque os
   "servidores DNS" do domínio no registro.br pelos dois que a Cloudflare mostrar (pode levar
   algumas horas).
2. **Tranca 1 primeiro (Access):** no painel Zero Trust → *Integrations › Identity providers* →
   adicione **One-time PIN**. Depois *Access controls › Applications › Create new application* →
   **Self-hosted** → endereço `painel.seudominio.com.br` → regra **Allow** → *Emails* = o seu e-mail.
   (A Cloudflare recomenda criar a tranca antes do caminho, para o painel nunca ficar aberto.)
3. **Túnel:** *Networking › Tunnels › Create a tunnel* → **Cloudflared** → nome `estudio` →
   Windows. A tela mostra um comando com um token longo: **não rode**; dê dois cliques em
   **`online.bat`** e cole só o token quando ele pedir. Ele instala o túnel como serviço (liga
   sozinho com o PC) e põe o painel em modo online (`ESTUDIO_COOKIE_SEGURO=1`).
4. **Caminho:** de volta ao túnel → aba *Routes* → *Add route* → **Published application** →
   subdomínio `painel`, seu domínio, *Service URL* `http://127.0.0.1:8787`. Ligue **Protect with
   Access** se aparecer.
5. Rode `parar.bat` e `iniciar.bat`. Abra o endereço no celular, no PC, onde quiser.

No modo online, use o endereço online também no PC. Se o login da Cloudflare expirar com o painel
aberto, o painel avisa e é só recarregar a página.

## Acesso pelo celular (Tailscale, alternativa sem domínio)

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
