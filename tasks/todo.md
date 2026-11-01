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
- [x] 01/11 · `firestore.rules` no ar e testadas com pedidos reais: visitante sem login é negado em tudo; logado, não lê estúdio alheio, não cria estúdio em nome de outro, não troca o próprio e-mail, não grava fora do estúdio, não apaga auditoria; grava no próprio estúdio e o dono lê os convidados.
- [x] 01/11 · Gemini ativado no projeto (Firebase AI Logic, Gemini Developer API) e App Check com reCAPTCHA Enterprise registrado para o app "painel" (aplicado só ao AI Logic).
- [x] 01/11 · **Roteiro com IA** (Produção › Roteiro com IA): história num box, prompts de imagem por quadro no outro, que se refazem quando a história muda; bíblia da série com fichas fixas; arco de 50 capítulos; capítulo → "Adicionar vídeo pronto". 23 testes; fluxo completo testado no navegador (demonstração).
- [x] 01/11 · Gemini de verdade no site publicado: App Check emitiu token e o `gemini-3.8-flash` respondeu no esquema JSON (arco de 3 capítulos, ~37 s).

## Canal no ar
- [x] 01/11 · YouTube: o canal "Kungamble" virou **Selah Studios** (@selahstudiosoficial): nome, @, descrição, foto e banner (fermata dourada), país Brasil, palavras-chave, "não é para crianças". Arte em `outputs/selah/` (marca.html gera os PNG).
- [x] 01/11 · Painel: canal "Selah Studios" criado a partir do modelo Bíblico e conta do YouTube registrada em Plataformas › Contas.
- [ ] Você: apagar as 11 playlists antigas no Studio (exclusão definitiva fica com você).
- [ ] Produção › Roteiro com IA › Nova série (canal Selah Studios), planejar o arco e escrever o capítulo 1.
- [ ] Para testar com outra pessoa: Mais › Plataforma › convidados → o e-mail dela.

## Próximas
- [ ] **Produção automática** em `functions/` (plano Blaze): roteiro (Gemini), checagem, voz, montagem (Cloud Run + FFmpeg), testes. Ver `functions/README.md`. Decidir como cobrar/limitar por estúdio.
- [ ] Coletor de métricas (YouTube Analytics) → `estudios/{uid}/metricas`.
- [ ] Roteiro: trajes por fase (ex.: Davi pastor → guerreiro → rei) sem reescrever a ficha; apagar série/capítulo; gerar a imagem direto (Nano Banana pelo AI Logic).
- [ ] Regras do "Sistema" do modelo bíblico em `dados/modelos.json`.
- [ ] Revisar `dados/plataformas.json` a cada 90 dias (o painel avisa).
- [ ] Telas sugeridas: calendário, banco de pautas, comentários com resposta aprovada.
