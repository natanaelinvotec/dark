# Estúdio de Canais

Painel para tocar canais de vídeos curtos (bíblico em manhwa e curiosidades) em **YouTube,
TikTok, Facebook, Instagram, Kwai e Snapchat**: fila de aprovação, publicação em cada rede,
contas e metas dos programas, séries, dinheiro. Roda inteiro no **Firebase** (Hosting + login
Google + Firestore), como o provador. Nada de servidor nem de PC ligado.

- **Especificação:** [`SPEC.md`](SPEC.md) · **Estratégia:** [`tasks/plan.md`](tasks/plan.md) · **Tarefas:** [`tasks/todo.md`](tasks/todo.md) · **Segurança:** [`SECURITY.md`](SECURITY.md)

## Estrutura

```
web/                 site publicado no Firebase Hosting
  index.html         o painel (mesma identidade do mockup)
  config.js          firebaseConfig + e-mail do dono (não é segredo)
  css/app.css
  js/app.js          telas, rotas por hash e formulários
  js/motor.js        as regras: fila, horários, publicação, contas, números de cada tela
  js/dados.js        Firestore (com login Google) ou demonstração no navegador
  js/semente.js      dados de exemplo da demonstração
  dados/canais.json      canais: horários, formato 61–80 s, plataformas, personagens
  dados/plataformas.json programas, requisitos e links oficiais de cada rede (conferido em 31/10/2026)
firestore.rules      só o e-mail do dono lê e grava
firebase.json        Hosting + cabeçalhos de segurança + regras
functions/           reservado para a produção automática (Cloud Functions; ver README de lá)
tests/               testes do motor (node --test)
```

## Ver agora, sem configurar nada

Abra `web/index.html` por um servidor qualquer (ex.: `npx serve web`) ou publique (abaixo). Sem a
`apiKey` em `web/config.js`, o painel abre em **modo demonstração**: dados de exemplo que ficam só
no navegador, com aprovar, publicar e salvar contas funcionando.

## Colocar no ar no Firebase (uma vez, uns 10 minutos)

1. **Projeto:** https://console.firebase.google.com → *Adicionar projeto* → `estudio-canais` →
   sem Google Analytics. Anote o **ID do projeto**.
2. **Login:** *Authentication* → *Vamos começar* → **Google** → Ativar → Salvar.
3. **Banco:** *Firestore Database* → *Criar banco de dados* → local `southamerica-east1`
   (São Paulo) → **modo de produção**.
4. **Site:** *Configurações do projeto* (engrenagem) → *Seus apps* → ícone **Web** `</>` →
   apelido `painel` → copie os valores do `firebaseConfig` para `web/config.js`.
5. **No PC** (precisa do Node.js: `winget install OpenJS.NodeJS.LTS`):

   ```powershell
   cd C:\Users\kungamble\Documents\Projetos\dark
   npm install -g firebase-tools
   firebase login
   firebase use --add          # escolha o projeto do passo 1, apelido "default"
   firebase deploy             # publica o site e as regras do Firestore
   ```

O endereço aparece no fim do `deploy`: `https://SEU-PROJETO.web.app`. Entre com a conta Google
`natanael.invotec@gmail.com` (para trocar, mude em `web/config.js` **e** em `firestore.rules`).
Com o Firebase ligado, o banco começa vazio: adicione vídeos em **Produção › Adicionar vídeo pronto**.

## Como usar

- **Produção › Adicionar vídeo pronto:** faça o vídeo onde quiser (61–80 s), suba no Google Drive,
  compartilhe como "qualquer pessoa com o link" e cole o link. Ele entra na **Aprovação** com a
  prévia tocando do Drive e um teste de duração.
- **Aprovação:** aprovar agenda no próximo horário livre do canal; tudo tem **Desfazer**.
- **Plataformas › Para publicar:** para cada rede, copie a legenda pronta, abra a página oficial de
  envio, publique e cole o link do post. **Contas e programas:** o @ de cada canal, a situação, a
  verificação em 2 etapas e o progresso até a meta de cada programa.
- **Gerar lote** registra pautas para a produção automática, que chega com `functions/`.

## Mudar canais e plataformas

Edite `web/dados/canais.json` (horários, plataformas, formato) ou `web/dados/plataformas.json`
(requisitos e links; o painel avisa quando os dados passarem de 90 dias) e rode `firebase deploy`.

## Testes

```powershell
node --test tests/*.test.js
```

O GitHub roda os mesmos testes a cada envio (aba **Actions**).

## O que este projeto não faz (de propósito)

Não cria contas nem canais, não aprova em lote, não publica sem você assistir, não repete o mesmo
vídeo em canais diferentes e não pede nem guarda senha de nenhuma plataforma.
