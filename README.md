# Estúdio de Canais

Plataforma para tocar canais de vídeos curtos em **YouTube, TikTok, Facebook, Instagram, Kwai e
Snapchat**: fila de aprovação, publicação em cada rede, contas e metas dos programas, séries e
dinheiro. **Cada conta Google tem o próprio estúdio**, zerado no primeiro acesso, com canais, fila e
contas separados. Roda inteiro no **Firebase** (Hosting + login Google + Firestore), como o provador.

- **No ar:** https://estudio-canais.web.app
- **Especificação:** [`SPEC.md`](SPEC.md) · **Estratégia:** [`tasks/plan.md`](tasks/plan.md) · **Tarefas:** [`tasks/todo.md`](tasks/todo.md) · **Segurança:** [`SECURITY.md`](SECURITY.md)

## Como funciona a plataforma

- **Um site para todos.** Todo mundo abre o mesmo endereço e o mesmo código. Cada um entra com a
  própria conta Google e só enxerga o próprio estúdio (`estudios/{uid}` no Firestore; as regras
  recusam o resto).
- **Atualizou, chegou para todos.** Um `firebase deploy` publica a nova versão para todos os
  estúdios de uma vez; cada pessoa recebe no próximo carregamento da página (o site manda o
  navegador sempre conferir a versão). Os dados de cada estúdio não são tocados pelo deploy.
- **Canais criados no painel.** Em **Canais › Novo canal**: nome, cor, horários, redes e duração.
  Os modelos (`web/dados/modelos.json`: Bíblico e Curiosidades) já trazem instruções de roteiro,
  estilo visual e personagens.
- **Cadastro controlado por você.** Em **Mais › Plataforma** (só aparece para o dono, o e-mail em
  `web/config.js > admin`): deixar o cadastro só para convidados (padrão) ou aberto para qualquer
  conta Google, e pausar um estúdio. Você vê quem tem estúdio, mas não os vídeos nem as contas dele.

## Estrutura

```
web/                 site publicado no Firebase Hosting
  index.html         o painel
  config.js          firebaseConfig + e-mail do dono da plataforma (não é segredo)
  css/app.css
  js/app.js          telas, rotas por hash e formulários
  js/motor.js        as regras: canais, fila, horários, publicação, contas, cadastro
  js/dados.js        Firestore (estudios/{uid}/...) ou demonstração no navegador
  js/semente.js      dados de exemplo da demonstração
  dados/modelos.json     modelos de canal (roteiro, estilo visual, personagens, formato 61–80 s)
  dados/plataformas.json programas, requisitos e links oficiais de cada rede (conferido em 31/10/2026)
firestore.rules      cada conta só lê e grava o próprio estúdio
firebase.json        Hosting + cabeçalhos de segurança + regras
functions/           reservado para a produção automática (Cloud Functions; ver README de lá)
tests/               testes do motor (node --test)
```

## Publicar uma atualização

No PowerShell, na pasta do projeto:

```powershell
cd C:\Users\kungamble\Documents\Projetos\dark
node --test tests/*.test.js     # tem de dar "fail 0"
git push                        # guarda no GitHub (o CI roda os mesmos testes)
firebase.cmd deploy             # publica o site e as regras para todos os estúdios
```

Use `firebase.cmd` (e `npm.cmd`) no PowerShell: a política do Windows bloqueia os scripts `.ps1`.
Para publicar só as regras: `firebase.cmd deploy --only firestore:rules`.

## Ver sem Firebase (demonstração)

Com a `apiKey` de `web/config.js` começando por `COLE`, o painel abre em **modo demonstração**:
dados de exemplo só no navegador. Em **Mais** dá para restaurar o exemplo ou começar com um
**estúdio vazio** (o que uma conta nova vê).

## Como usar

1. **Canais › Novo canal:** comece por um modelo ou em branco.
2. **Plataformas › Contas e programas:** o @ de cada canal em cada rede, a situação, a verificação
   em 2 etapas e o progresso até a meta de cada programa.
3. **Produção › Adicionar vídeo pronto:** faça o vídeo onde quiser (61–80 s), suba no Google Drive,
   compartilhe como "qualquer pessoa com o link" e cole o link. Ele entra na **Aprovação**.
4. **Aprovação:** aprovar agenda no próximo horário livre do canal; tudo tem **Desfazer**.
5. **Plataformas › Para publicar:** copie a legenda de cada rede, abra a página oficial de envio,
   publique e cole o link do post.

## Mudar modelos e plataformas

`web/dados/modelos.json` (modelos para canais novos; canais já criados não mudam) e
`web/dados/plataformas.json` (requisitos e links; o painel avisa depois de 90 dias). Depois,
`firebase.cmd deploy`.

## Testes

```powershell
node --test tests/*.test.js
```

## O que este projeto não faz (de propósito)

Não cria contas nas redes, não aprova em lote, não publica sem você assistir, não repete o mesmo
vídeo em canais diferentes e não pede nem guarda senha de nenhuma plataforma.
