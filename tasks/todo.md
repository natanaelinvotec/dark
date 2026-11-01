# Tarefas — Estúdio de Canais (plataforma multi-estúdio)

> Spec: `SPEC.md` · Estratégia: `tasks/plan.md`
> Legenda: [x] feito e verificado · [~] feito, falta conferir no Firebase de verdade · [ ] a fazer

## Feito
- [x] 31/10 · Painel no Firebase: motor no navegador, Firestore + login Google, modo demonstração. No ar em https://estudio-canais.web.app.
- [x] 31/10 · Adicionar vídeo pronto (Drive) → aprovação → publicação assistida nas 6 redes; contas e metas; dinheiro; séries.
- [x] 01/11 · **Plataforma multi-estúdio:** cada conta Google com o próprio estúdio (`estudios/{uid}`), criado vazio no primeiro acesso.
- [x] 01/11 · **Canais criados no painel** (modelo ou em branco), editar, ligar/pausar, apagar sem vídeos; `canais.json` virou `modelos.json`.
- [x] 01/11 · **Mais › Plataforma** (só o dono): cadastro fechado/aberto, convidados, pausar estúdio.
- [x] 01/11 · 17 testes do motor; fluxo completo testado no navegador (demonstração).
- [~] 01/11 · `firestore.rules` com isolamento por estúdio, cadastro e pausa: conferir no simulador de regras depois do deploy.

## Para publicar (você)
- [ ] `git push` e `firebase.cmd deploy` (site + regras novas).
- [ ] Entrar em https://estudio-canais.web.app, criar o primeiro canal e testar o caminho até a fila.
- [ ] Para testar com outra pessoa: Mais › Plataforma › convidados → o e-mail dela.

## Próximas
- [ ] **Produção automática** em `functions/` (plano Blaze): roteiro (Gemini), checagem, voz, montagem (Cloud Run + FFmpeg), testes. Ver `functions/README.md`. Decidir como cobrar/limitar por estúdio.
- [ ] Coletor de métricas (YouTube Analytics) → `estudios/{uid}/metricas`.
- [ ] Editar instruções de roteiro e personagens do canal pelo painel (hoje vêm do modelo).
- [ ] Regras do "Sistema" do modelo bíblico em `dados/modelos.json`.
- [ ] Revisar `dados/plataformas.json` a cada 90 dias (o painel avisa).
- [ ] Telas sugeridas: calendário, banco de pautas, comentários com resposta aprovada.
