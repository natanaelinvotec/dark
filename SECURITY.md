# Segurança

## O que proteger
1. **Os canais** (sessões do navegador e, no futuro, refresh tokens OAuth).
2. **As chaves de API** (geram custo: Gemini, Azure, Pexels, Pixabay).
3. **O banco** (`dados/estudio.db`): fila, custos, receitas, auditoria.

## Regras do projeto
- **Painel online (GitHub Pages + Firebase):** o site é público, os dados não. Só o e-mail do dono (verificado pelo Google) lê `telas/` e cria `comandos/`; ninguém altera ou apaga comandos pelo navegador (regras em `estudio nuvem regras`). A ponte no PC usa a conta de serviço (`dados/firebase-servico.json`, nunca no Git), aceita só as rotas de escrita do painel (lista fechada em `nuvem.py`) e executa cada uma pelas mesmas validações da API local. O Drive usa o escopo `drive.file` (o app só enxerga o que ele criou); as prévias têm link não listado.
- Painel escuta em `127.0.0.1` por padrão e **nunca** abre porta no roteador. Acesso remoto por um destes caminhos:
  - **Cloudflare Tunnel + Cloudflare Access** (`online.bat`): o túnel sai do PC para a Cloudflare; o Access exige código no e-mail do dono **antes** de qualquer requisição chegar ao painel. Crie a aplicação do Access **antes** da rota do túnel e ligue "Protect with Access". Com isso, `ESTUDIO_COOKIE_SEGURO=1`.
  - **Tailscale** (`tailscale serve --bg http://127.0.0.1:8787`): só aparelhos da sua conta.
  - Nunca `tailscale funnel`, Quick Tunnel (`trycloudflare.com`) ou rota publicada sem Access: deixariam só a senha do painel entre a internet e o painel.
- Cookie da sessão: `httpOnly`, `SameSite=Lax` (o Strict escondia a sessão na volta do login da Cloudflare) e `Secure` no modo online. A defesa contra CSRF é o cabeçalho `X-Estudio` exigido em todo POST, que outro site não consegue enviar.
- O painel **não guarda senha de nenhuma plataforma** (YouTube, TikTok, Facebook, Instagram, Kwai, Snapchat): os botões só abrem a página oficial. Links salvos (perfil, post) precisam ser `https` num domínio da plataforma, conferido no servidor. O comando recusa `--host 0.0.0.0` sem `--permitir-rede`.
- Login por senha com hash **scrypt** (`uv run estudio senha`), 10 tentativas por 15 min por IP (atrás do `tailscale serve` ou do túnel todo acesso vem de 127.0.0.1, então o limite é global — é o esperado para usuário único, e o Access barra estranhos antes).
- Todo `POST` exige o cabeçalho `X-Estudio: 1`; cabeçalhos CSP, `nosniff`, `frame-ancestors 'none'` em todas as respostas.
- `/api/config` nunca devolve chaves: só "configurada: sim/não".
- Saída da LLM é entrada não confiável: schema + validação; nada dela vira comando, caminho ou HTML sem escape.
- `subprocess` sempre com lista de argumentos; nomes de arquivo por UUID; FFmpeg roda com `cwd` na pasta de trabalho do vídeo.
- Downloads só de hosts permitidos (Pexels, Pixabay), sem seguir redirecionamento, com limite de tamanho.
- A prévia do vídeo só é servida se o caminho resolvido estiver dentro de `ESTUDIO_DADOS`.

## Segredos
- Desenvolvimento: `.env` local (está no `.gitignore`). O hash da senha vai entre aspas simples (tem `$`).
- Dados de exemplo só em banco separado (`ESTUDIO_DB=dados/exemplo.db`); o worker se recusa a rodar nele.
- Servidor: prefira `systemd-creds encrypt` ou `sops` + `age`; carregue no ambiente só do processo que usa.
- Antes de cada commit: `git diff --cached | grep -iE "key|secret|token|senha"` não pode achar valor real.
- **Vazou?** Revogue primeiro, depois limpe o histórico:
  - Gemini: AI Studio → API keys → excluir e criar outra.
  - Azure: portal → recurso Speech → Chaves → Regenerar.
  - Pexels/Pixabay: painel da conta → nova chave.
  - Sessões Google suspeitas: myaccount.google.com/security → "Seus dispositivos" → sair; trocar senha; revisar myaccount.google.com/permissions.

## Rotação
A cada 90 dias: chaves de API e `ESTUDIO_SEGREDO_SESSAO` (trocar o segredo derruba as sessões abertas, o que é o esperado).

## Contas dos canais
- Passkey ou chave física em todas as contas; códigos de backup impressos.
- Perfil de navegador **só** para os canais, numa máquina onde você não abre anexos.
- Nunca abra arquivos de "proposta de patrocínio" (`.zip`, `.rar`, `.exe`, `.scr`): é o golpe nº 1 de roubo de canal.

## Cadeia de suprimentos
- `uv lock` gera o lockfile com hashes; commite o `uv.lock`.
- `uv run pip-audit` no CI e antes de cada deploy.
- Toda dependência nova passa por revisão (mantenedor, idade, downloads). Nada de scripts "youtube automation" de terceiros que peçam seu token.
- Imagem Docker: fixe a base por digest depois do primeiro build.

## Backup
`restic` cifrado do `dados/estudio.db` e de `channels/` (diário). Tokens ficam fora do backup: são regeneráveis.

## Reportar um problema
Projeto pessoal: anote em `tasks/todo.md` com a etiqueta `[segurança]` e corrija antes do próximo deploy.
