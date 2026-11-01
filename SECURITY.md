# Segurança

## O que proteger
1. **Os canais** (contas nas plataformas): passkey ou verificação em 2 etapas em todas; códigos de
   backup impressos. O painel nunca pede, guarda ou digita senha de plataforma.
2. **Os dados de cada estúdio** (Firestore): fila, canais, contas, números, dinheiro.
3. **A cota grátis do projeto** (plano Spark): quem tem estúdio grava no mesmo projeto.
4. **Chaves de API** da produção automática (quando `functions/` existir).

## Como a plataforma se protege
- **Um estúdio por conta Google** (`firestore.rules`): tudo fica em `estudios/{uid}/...` e só a
  conta dona daquele `uid`, com e-mail verificado pelo Google, lê e grava ali. Coleções fora da
  lista são recusadas. `acoes` e `eventos` (auditoria) só aceitam criar: ninguém edita nem apaga.
- **Cadastro fechado por padrão:** um estúdio novo só nasce se o dono da plataforma estiver entrando,
  se o cadastro estiver aberto ou se o e-mail estiver na lista de convidados (`plataforma/acesso`).
  A regra confere isso no banco; esconder o botão no site não bastaria.
- **Pausar estúdio:** o dono da plataforma muda só o campo `ativo`; com `ativo == false` as regras
  recusam leitura e gravação daquele estúdio. O usuário não consegue se reativar (as regras não
  deixam ele mexer em `ativo`, `email` nem `criadoEm`).
- **O dono da plataforma não lê os estúdios dos outros:** vê só e-mail, nome, data e situação.
- **Cota:** com o cadastro aberto, qualquer conta Google pode criar estúdio e gastar a cota grátis
  (leituras e gravações por dia). Abra só quando quiser divulgar, e pause estúdios abusivos.
- O `firebaseConfig` em `web/config.js` **não é segredo** (é público em todo site Firebase); quem
  protege os dados são o login e as regras. O e-mail do dono está no `config.js` (só para mostrar a
  tela de administração) e em `firestore.rules` (onde vale de verdade); um teste confere que são iguais.
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
Anote em `tasks/todo.md` com a etiqueta `[segurança]`.
