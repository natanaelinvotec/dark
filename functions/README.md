# functions/ — produção automática (ainda não instalada)

O painel já funciona sem esta pasta: você adiciona vídeos prontos (link do Drive), aprova e
publica nas plataformas. Aqui entram as **Cloud Functions** que vão fazer o vídeo sozinhas.
Exigem o plano **Blaze** do Firebase (cobra por uso; pede cartão).

## Como elas conversam com o painel

O painel grava pautas em `estudios/{uid}/videos/{id}` (um estúdio por conta) com `status: "pauta"` e `etapas.{nome}.status: "espera"`.
Cada função escuta mudanças nesse documento, faz uma etapa e atualiza:

| Etapa | O que faz | Grava em `estudios/{uid}/videos/{id}` |
|---|---|---|
| roteiro | Gemini API escreve o roteiro (JSON validado: cenas, janelas, fontes) | `roteiro`, `etapas.roteiro` |
| checagem | Gemini revisa números, datas e citações | `aviso`, `etapas.checagem` |
| quadros | prompts para o dono (bíblico) ou banco de imagens (curiosidades) | `etapas.quadros` (`voce` quando espera o dono) |
| voz | Text-to-Speech | `etapas.voz`, `duracao` |
| montagem | FFmpeg em **Cloud Run** (função comum não tem FFmpeg nem memória) | `driveId`, `etapas.montagem` |
| testes | formato 9:16, áudio, tela preta, duração 60–90 s, similaridade | `testes`, `status: "fila" | "reprovado"` |

Cada etapa também cria um documento em `eventos/` (o console da tela Produção).

## Regras que a versão Python já tinha (estão no histórico do Git)

- teto de gasto com IA por mês (`estudios/{uid}/config/geral.teto_mes_brl`, por estúdio), checado antes de cada chamada;
- até 3 tentativas de roteiro, com os problemas da tentativa anterior no novo pedido;
- a pauta entra delimitada no prompt e é tratada como dado, nunca como instrução;
- vídeos de 61–80 s (o TikTok só paga a partir de 1 min).

Para consultar o código antigo: `git log --oneline` e `git show 299ab08:src/estudio/roteiro.py`.

## Segredos

As chaves (Gemini, voz, bancos de imagem) vão no **Secret Manager**:
`firebase functions:secrets:set GEMINI_API_KEY`. Nunca no código nem no `web/config.js`.
