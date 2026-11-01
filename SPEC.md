# Spec: Estúdio de Canais

> Versão 2 · 31/10/2026 · Firebase. A versão 1 (Python + painel local + acesso pelo PC) está no
> histórico do Git (`git show 299ab08`). Estratégia em `tasks/plan.md`; tarefas em `tasks/todo.md`.

## Premissas
1. Um único usuário (o dono). Entra com a conta Google; as regras do Firestore só aceitam o e-mail dele.
2. Tudo no **Firebase**: Hosting (site), Authentication (Google), Firestore (dados). Sem servidor próprio, sem PC ligado.
3. Vídeos ficam no **Google Drive** do dono (link "qualquer pessoa com o link"); o painel toca a prévia de lá.
4. Duração-alvo **61–80 s** (TikTok só paga a partir de 1 min; Reels pela API vai até 90 s).
5. Publicação **assistida**: o painel copia a legenda de cada rede e abre a página oficial de envio; o dono publica e cola o link. APIs de publicação só depois de auditoria de cada plataforma.
6. Produção automática (roteiro, voz, montagem, testes) fica para **Cloud Functions** em `functions/` (plano Blaze).

## Objetivo
Reduzir o trabalho do dono a assistir, aprovar e publicar (≈8 min por vídeo), com os números que
importam (metas dos programas, dinheiro, gatilho do próximo canal) num lugar só, no PC ou no celular.

## Módulos (web/)

| Arquivo | Responsabilidade |
|---|---|
| `js/motor.js` | Regras puras: telas (`get`), ações (`post` → `{resposta, mudancas}`), horários, publicação, contas, validações. Roda no navegador e no Node. |
| `js/dados.js` | `window.FONTE`: carrega o estado (Firestore ou demonstração), grava as mudanças em lote, login Google, prévia/download do Drive. |
| `js/app.js` | Telas, rotas por hash, formulários. Só fala com `FONTE`. |
| `js/semente.js` | Dados de exemplo da demonstração. |
| `dados/*.json` | Canais e plataformas (editados no repositório e publicados com `firebase deploy`). |

## Modelo de dados (Firestore)

| Coleção | Documento |
|---|---|
| `videos/{id}` | canal, titulo, tema, serie, referencia, status, roteiro{descricao, hashtags, fontes, janelas}, duracao, horario, aviso, notaRefazer, revisaoS, driveId, etapas{nome: {status, nota}}, testes[], publicacoes{plataforma: {situacao, url, publicadoEm, atualizadoEm}}, criadoEm, atualizadoEm |
| `contas/{canal}:{plataforma}` | usuario, url, situacao, seguranca, numeros{}, atualizadoEm |
| `acoes/{auto}` | ts, n, video, acao, nota, de, para (auditoria; só cria) |
| `eventos/{auto}` | ts, n, etapa, alvo, msg, nivel (console; só cria) |
| `custos`, `receitas`, `campanhas`, `metricas` | mês/fornecedor/valor; mês/fonte/valor; clipping; data/canal/views |
| `config/geral` | teto_mes_brl, preços, câmbio, créditos do Flow, canais_ligados{}, metricas{} |

`videos.status`: `pauta → produzindo ⇄ voce → fila | reprovado → aprovado | rejeitado | refazer`;
`aprovado → publicado` quando sai em ao menos uma rede (volta se todas forem desfeitas).
Datas em ISO com fuso de Brasília (`-03:00`), comparáveis como texto.

## Comandos
```
Testes ............. node --test tests/*.test.js
Ver local .......... npx serve web            (modo demonstração)
Publicar ........... firebase deploy           (site + regras)
Só as regras ....... firebase deploy --only firestore:rules
```

## Limites
- **Sempre:** testes do motor antes de publicar; todo texto do banco por `esc()`; links validados por domínio.
- **Perguntar antes:** mudar o modelo de dados; ligar Cloud Functions (custo); trocar o e-mail do dono.
- **Nunca:** criar contas ou canais automaticamente; aprovar em lote; publicar sem aprovação; repostar o mesmo vídeo em canais diferentes; pedir ou guardar senha de plataforma; chave de API no `web/`.

## Critérios de sucesso
1. `node --test` verde; CI verde.
2. Sem `apiKey`: demonstração com todas as telas e ações funcionando no navegador.
3. Com Firebase: só o e-mail do dono entra; outra conta vê "não tem acesso" e as regras recusam leitura.
4. Adicionar vídeo pronto (link do Drive) → aprovar → publicar em cada rede → aparece em "Publicados".

## Perguntas em aberto
- Regras do "Sistema" do canal bíblico (`sistema` em `dados/canais.json`, hoje `null`).
- Regra para abrir o 3º canal (o gatilho mostra as 4 condições; a decisão é do dono).
- Quando ligar a produção automática (Cloud Functions, plano Blaze).
