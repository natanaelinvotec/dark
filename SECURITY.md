# Segurança

## O que proteger
1. **Os canais** (contas nas plataformas): passkey ou verificação em 2 etapas em todas; códigos de
   backup impressos. O painel nunca pede, guarda ou digita senha de plataforma.
2. **Os dados do painel** (Firestore): fila, contas, números, dinheiro.
3. **Chaves de API** da produção automática (quando `functions/` existir).

## Como o painel se protege
- **Login Google** + **regras do Firestore** (`firestore.rules`): só o e-mail do dono, verificado
  pelo Google, lê e grava. `acoes` e `eventos` (auditoria) só aceitam criar: ninguém edita nem
  apaga pelo navegador. Coleções fora da lista são recusadas.
- O `firebaseConfig` em `web/config.js` **não é segredo** (é público em todo site Firebase); quem
  protege os dados são o login e as regras.
- **Cabeçalhos** do Hosting (`firebase.json`): CSP sem `unsafe-inline` (estilos dinâmicos via
  CSSOM), `frame-ancestors 'none'`, `nosniff`, `no-referrer`.
- Todo texto do banco passa por `esc()` antes de virar HTML; links salvos (perfil, post, Drive) só
  valem se forem `https` no domínio certo (`hostAceito` em `js/motor.js`, com teste para os golpes
  `dominio.com.golpe.io`, `golpe.com\.dominio.com` e usuário:senha na URL).
- Prévias tocam do Google Drive por link não listado: quem não tem o link não acha.

## Segredos
- Nada de chave de API no `web/` nem no Git. Na produção automática, use o Secret Manager:
  `firebase functions:secrets:set GEMINI_API_KEY`.
- O `.env` antigo do seu PC (versão Python) continua só no PC e fora do Git; ele guarda as suas
  chaves (Gemini, voz, Pexels, Pixabay) para levar ao Secret Manager quando as funções existirem.
- **Vazou uma chave?** Revogue primeiro (Google AI Studio, Azure, Pexels, Pixabay), depois limpe.

## Cadeia de suprimentos
- O site não usa npm: só o SDK oficial do Firebase pelo `gstatic.com`, em versão fixa (10.12.2).
- `functions/` terá `package-lock.json` e `npm audit` no CI quando existir.

## Reportar um problema
Projeto pessoal: anote em `tasks/todo.md` com a etiqueta `[segurança]`.
