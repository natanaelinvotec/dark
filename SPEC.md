# Spec: Estúdio de Canais

> Versão 3 · 01/11/2026 · plataforma multi-estúdio no Firebase. A versão 2 (um único dono) está no
> histórico do Git (`git show 101b023`); a 1 (Python + PC) em `git show 299ab08`.
> Estratégia em `tasks/plan.md`; tarefas em `tasks/todo.md`.

## Premissas
1. **Cada conta Google tem o próprio estúdio**, criado vazio no primeiro acesso. Ninguém vê o estúdio de outro.
2. Existe um **dono da plataforma** (`web/config.js > admin`, repetido em `firestore.rules`): abre/fecha o cadastro, mantém a lista de convidados e pausa estúdios. Ele não lê os dados de dentro dos estúdios.
3. **Um site, um código:** `firebase deploy` atualiza todos os estúdios de uma vez. O formato dos dados tem versão (`versaoDados` no documento do estúdio) para migrar no primeiro acesso, se um dia mudar.
4. Canais são **criados no painel**, a partir de um modelo (`web/dados/modelos.json`) ou em branco. Até 10 por estúdio.
5. Tudo no **Firebase**: Hosting, Authentication (Google), Firestore. Sem servidor próprio, sem PC ligado.
6. Vídeos ficam no **Google Drive** de cada usuário (link "qualquer pessoa com o link"); o painel toca a prévia de lá.
7. Duração-alvo **61–80 s** (TikTok só paga a partir de 1 min; Reels pela API vai até 90 s), ajustável por canal (15–180 s).
8. Publicação **assistida**: o painel copia a legenda de cada rede e abre a página oficial de envio; o usuário publica e cola o link.
9. Produção automática (roteiro, voz, montagem, testes) fica para **Cloud Functions** em `functions/` (plano Blaze).

## Objetivo
Reduzir o trabalho de cada dono de estúdio a assistir, aprovar e publicar (≈8 min por vídeo), com os
números que importam (metas dos programas, dinheiro, gatilho do próximo canal) num lugar só.

## Módulos (web/)

| Arquivo | Responsabilidade |
|---|---|
| `js/motor.js` | Regras puras: telas (`get`), ações (`post` → `{resposta, mudancas}`), canais, horários, publicação, contas, cadastro, validações. Roda no navegador e no Node. |
| `js/dados.js` | `window.FONTE`: login Google, cria o estúdio no primeiro acesso (se o cadastro deixar), carrega o estado de `estudios/{uid}`, grava as mudanças em lote. Ou demonstração no navegador. |
| `js/app.js` | Telas, rotas por hash (`#canais/novo/<modelo>`, `#canais/editar/<canal>`), formulários. Só fala com `FONTE`. |
| `js/semente.js` | Dados de exemplo e estúdio vazio da demonstração. |
| `dados/*.json` | Modelos de canal e plataformas (publicados com `firebase deploy`). |

## Modelo de dados (Firestore)

| Caminho | Documento |
|---|---|
| `plataforma/acesso` | aberto (bool), convidados [e-mails em minúsculas], atualizadoEm — só o dono da plataforma grava |
| `estudios/{uid}` | email, nome, ativo, criadoEm, versaoDados — o usuário cria; só o dono da plataforma muda `ativo` |
| `estudios/{uid}/canais/{slug}` | nome, cor, descricao, ligado, horarios[], plataformas[], formato{short_segundos, ...}, modelo, roteiro, estilo_visual, personagens[], criadoEm, atualizadoEm |
| `estudios/{uid}/videos/{id}` | canal, titulo, tema, serie, referencia, status, roteiro{...}, duracao, horario, driveId, etapas{}, testes[], publicacoes{plataforma: {situacao, url, publicadoEm}}, criadoEm, atualizadoEm |
| `estudios/{uid}/contas/{canal}:{plataforma}` | usuario, url, situacao, seguranca, numeros{}, atualizadoEm |
| `estudios/{uid}/acoes/{auto}` · `eventos/{auto}` | auditoria e console (só criar) |
| `estudios/{uid}/custos` · `receitas` · `campanhas` · `metricas` | dinheiro e números |
| `estudios/{uid}/config/geral` | teto_mes_brl, preços, câmbio, créditos do Flow, metricas{} |

O `slug` do canal sai do nome ("Histórias da Bíblia!" → `historias-da-biblia`), ganha sufixo se repetir
e não muda depois. Canal com vídeos não pode ser apagado (o painel confere no banco); pausa-se.

`videos.status`: `pauta → produzindo ⇄ voce → fila | reprovado → aprovado | rejeitado | refazer`;
`aprovado → publicado` quando sai em ao menos uma rede. Datas em ISO com fuso de Brasília (`-03:00`).

## Comandos
```
Testes ............. node --test tests/*.test.js
Publicar ........... firebase.cmd deploy                         (site + regras, para todos)
Só as regras ....... firebase.cmd deploy --only firestore:rules
```

## Limites
- **Sempre:** testes do motor antes de publicar; todo texto do banco por `esc()`; links validados por domínio; o e-mail do dono igual em `config.js` e nas regras.
- **Perguntar antes:** mudar o modelo de dados (subir `versaoDados` + migração); abrir o cadastro para todos; ligar Cloud Functions (custo).
- **Nunca:** um estúdio ler outro; criar contas nas redes; aprovar em lote; publicar sem aprovação; repostar o mesmo vídeo em canais diferentes; pedir ou guardar senha de plataforma; chave de API no `web/`.

## Critérios de sucesso
1. `node --test` verde; CI verde.
2. Conta nova (convidada): entra, vê "Seu estúdio está pronto", cria um canal a partir de um modelo e adiciona o primeiro vídeo.
3. Conta não convidada com cadastro fechado: vê "Cadastro fechado" e as regras recusam criar o estúdio.
4. Estúdio pausado: vê "Estúdio pausado" e as regras recusam ler e gravar.
5. Um `firebase deploy` muda o painel de todos os estúdios sem tocar nos dados.

## Perguntas em aberto
- Regras do "Sistema" do modelo bíblico (`sistema` em `dados/modelos.json`, hoje `null`).
- Regra para abrir o 3º canal (o gatilho mostra as 4 condições; a decisão é do dono do estúdio).
- Quando ligar a produção automática (Cloud Functions, plano Blaze) e como dividir o custo entre estúdios.
