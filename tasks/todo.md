# Tarefas — Estúdio de Canais (versão Firebase)

> Spec: `SPEC.md` · Estratégia: `tasks/plan.md`
> Legenda: [x] feito e verificado · [~] feito, falta conferir no Firebase de verdade · [ ] a fazer

## Feito (31/10/2026)
- [x] Painel no Firebase: `web/` com motor no navegador, Firestore + login Google, modo demonstração.
- [x] Adicionar vídeo pronto (link do Drive) → aprovação → publicação assistida nas 6 redes.
- [x] Contas e metas dos programas; dinheiro; séries; gatilho; configurações.
- [x] 11 testes do motor (`node --test`) e todas as telas testadas num navegador em modo demonstração.
- [~] `firestore.rules` só para o dono; cabeçalhos de segurança no `firebase.json`.

## Para colocar no ar (você)
- [ ] Criar o projeto no Firebase, ligar o login Google e o Firestore (README, passos 1–3).
- [ ] Colar o `firebaseConfig` em `web/config.js` (passo 4) e rodar `firebase deploy` (passo 5).
- [ ] Criar as contas nas redes (TikTok pessoal, Facebook página/modo profissional, Instagram profissional, Kwai, Snapchat) com passkey/2FA e preencher a aba **Contas**.

## Próximas
- [ ] **Produção automática** em `functions/` (plano Blaze): roteiro (Gemini), checagem, voz, montagem (Cloud Run + FFmpeg), testes. Ver `functions/README.md`.
- [ ] Coletor de métricas (YouTube Analytics) → `metricas` e `config/geral.metricas`.
- [ ] Regras do "Sistema" do canal bíblico (decisão do dono) em `dados/canais.json`.
- [ ] Regra do dono para abrir o 3º canal (hoje o painel só mostra as 4 condições).
- [ ] Revisar `dados/plataformas.json` a cada 90 dias (o painel avisa).
- [ ] Telas sugeridas: calendário, banco de pautas, comentários com resposta aprovada.
