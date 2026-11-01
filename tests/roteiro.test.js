"use strict";
/* Testes do Roteiro com IA (node --test tests/). Sem rede e sem Gemini: só as regras. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const M = require("../web/js/motor.js");
const R = require("../web/js/roteiro.js");
const Semente = require("../web/js/semente.js");

const ler = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const MODELOS = ler("web/dados/modelos.json");
const PLATAFORMAS = ler("web/dados/plataformas.json");
const AGORA = new Date("2026-11-02T13:00:00-03:00");

function estado() {
  return { ...Semente.criar(M, AGORA, MODELOS), modelos: MODELOS, plataformas: PLATAFORMAS, conexao: { modo: "demo", ia: true } };
}
function postar(e, caminho, corpo, agora = AGORA) {
  const r = M.post(e, caminho, corpo, agora);
  M.aplicar(e, r.mudancas);
  return r.resposta;
}
const tela = (e, consulta = "") => M.get(e, `/api/roteiro${consulta}`, AGORA);

test("prompt do quadro: ordem das diretrizes, token no lugar do nome e sufixo no fim", () => {
  const e = estado();
  const s = e.series["temporada-davi"];
  const davi = s.personagens.find((p) => p.id === "davi");
  const a = R.montarPrompt(s, { personagens: ["davi"], cenario: "pasto", acao_en: "the boy runs.", enquadramento_en: "wide shot" });
  const b = R.montarPrompt(s, { personagens: ["davi", "golias", "ninguem"], cenario: "nao-existe", acao_en: "the boy faces the giant" });
  for (const p of [a, b]) assert.ok(p.includes(davi.ficha_en), "mesmo token nos dois quadros");
  assert.ok(a.startsWith("wide shot, the boy runs, "), "câmera, depois ação");
  assert.ok(a.indexOf(davi.ficha_en) < a.indexOf("dry rocky hills"), "personagem antes do cenário");
  assert.ok(a.endsWith(`${s.estilo.replace(/[\s.,;]+$/, "")}.`), "sufixo de estilo sempre no fim");
  assert.ok(!/\b(Davi|Golias)\b/.test(a + b), "nome próprio não entra no prompt");
  assert.ok(!b.includes("ninguem"), "ids fora da bíblia não entram");
  assert.ok(b.includes("towering warrior"));
  assert.equal(R.montarNegativo(s), "text in the image, realistic faces of sacred figures, medieval European armor");
});

test("token em inglês escrito à mão vale como está; mudar o português sem mexer no token o deixa velho", () => {
  const e = estado();
  const id = "temporada-davi";
  const pers = e.series[id].personagens.map((p) => (p.id === "saul" ? { ...p, ficha_en: "tall bearded king, dark royal mantle, bronze crown", ficha_manual: true } : p));
  postar(e, `/api/series/${id}`, { personagens: pers });
  const t = tela(e);
  assert.equal(t.serie.personagens.find((p) => p.id === "saul").ficha_ok, true);
  assert.equal(t.serie.fichas_pendentes, 0);
  const pers2 = e.series[id].personagens.map((p) => (p.id === "saul" ? { ...p, roupas: "armadura de bronze" } : p));
  postar(e, `/api/series/${id}`, { personagens: pers2 });
  assert.equal(tela(e).serie.personagens.find((p) => p.id === "saul").ficha_ok, false);
});

test("bloco de cena: entonação, som, movimento, tempo, referência e quem está em cena", () => {
  const e = estado();
  const historia = "No princípio Deus criou os céus e a terra. A terra era sem forma e vazia, e havia trevas sobre a face do abismo.";
  postar(e, "/api/capitulos/temporada-davi/2", { titulo: "O princípio", referencia: "Gênesis 1:1-2", historia });
  postar(e, "/api/capitulos/temporada-davi/2", {
    para: historia,
    quadros: [
      { trecho: "No princípio Deus criou os céus e a terra.", direcao: "[tom grave e solene]", sfx: "coro grave", personagens: ["davi"], enquadramento_en: "wide shot", acao_en: "light breaks the void", movimento_en: "slow push-in" },
      { trecho: "A terra era sem forma e vazia, e havia trevas sobre a face do abismo.", direcao: "[pausa dramática - Selah]", sfx: "vento uivante", personagens: [], acao_en: "dark waters" },
    ],
  });
  const c = tela(e, "?cap=2").cap;
  assert.equal(c.referencia, "Gênesis 1:1-2");
  assert.deepEqual(c.em_cena, ["Davi"]);
  assert.equal(c.quadros[0].direcao, "[tom grave e solene]");
  assert.equal(c.quadros[0].sfx, "coro grave");
  assert.equal(c.quadros[0].movimento, "slow push-in");
  assert.deepEqual([c.quadros[0].inicio, c.quadros[0].fim, c.quadros[1].inicio], [0, 4, 4]);
  assert.ok(c.quadros[1].fim > c.quadros[1].inicio);
  assert.ok(c.negativo.length > 0);
});

test("série nova copia os personagens do canal e o estilo visual", () => {
  const e = estado();
  const r = postar(e, "/api/series", { nome: "Temporada Davi", canal: "biblico-manhwa", premissa: "x" });
  assert.equal(r.id, "temporada-davi-2", "não sobrescreve a série que já existe");
  const s = e.series[r.id];
  assert.deepEqual(s.personagens.map((p) => p.id), ["davi", "golias", "saul"]);
  assert.match(s.estilo, /webtoon/);
  assert.equal(s.meta, 50);
  assert.equal(tela(e, `?serie=${r.id}`).serie.fichas_pendentes, 4, "3 fichas + a lista do que evitar");
  assert.throws(() => M.post(e, "/api/series", { nome: "x", canal: "nao" }, AGORA), (err) => err.status === 422 && Boolean(err.dados.erros.canal && err.dados.erros.nome));
  assert.throws(() => M.post(e, "/api/series", { nome: "Outra", canal: "curiosidades", meta: 500 }, AGORA), (err) => Boolean(err.dados.erros.meta));
});

test("bíblia: mudar a aparência deixa a ficha velha até a IA traduzir de novo", () => {
  const e = estado();
  const id = "temporada-davi";
  assert.equal(tela(e).serie.personagens.find((p) => p.id === "davi").ficha_ok, true);
  const personagens = e.series[id].personagens.map((p) => (p.id === "davi" ? { ...p, roupas: "manto de rei, coroa de ouro" } : p));
  postar(e, `/api/series/${id}`, { personagens });
  assert.equal(tela(e).serie.personagens.find((p) => p.id === "davi").ficha_ok, false);
  const pend = R.fichasPendentes(e, id).itens.map((i) => i.id);
  assert.deepEqual(pend.sort(), ["davi", "saul"]);
  assert.match(R.pedidoFichas(e, id), /manto de rei/);
  postar(e, `/api/series/${id}`, { fichas: { davi: "adult king, golden crown", saul: "tall man, dark robe" } });
  const t = tela(e);
  assert.equal(t.serie.fichas_pendentes, 0);
  assert.ok(t.cap.n === 2 && R.montarPrompt(e.series[id], { personagens: ["davi"] }).includes("adult king, golden crown"));
});

test("capítulo: quadros só com ids da bíblia e aviso quando a história muda", () => {
  const e = estado();
  const base = "/api/capitulos/temporada-davi/2";
  postar(e, base, { titulo: "O desafio", historia: "Golias grita no vale." });
  let cap = tela(e, "?serie=temporada-davi&cap=2").cap;
  assert.equal(cap.sem_quadros, true);
  postar(e, base, {
    para: "Golias grita no vale.",
    quadros: [{ trecho: "Golias grita", personagens: ["golias", "fantasma"], cenario: "lua", acao_en: "the giant shouts" }],
  });
  cap = tela(e, "?serie=temporada-davi&cap=2").cap;
  assert.equal(cap.desatualizado, false);
  assert.deepEqual(cap.quadros[0].personagens, ["Golias"]);
  assert.equal(cap.quadros[0].cenario, "");
  assert.deepEqual(cap.quadros[0].referencias, ["Personagens/golias_ficha.png"]);
  postar(e, base, { historia: "Golias grita no vale por quarenta dias." });
  assert.equal(tela(e, "?serie=temporada-davi&cap=2").cap.desatualizado, true, "prompts avisam que a história mudou");
  assert.throws(() => M.post(e, "/api/capitulos/temporada-davi/51", { historia: "x" }, AGORA), (err) => err.status === 422);
  assert.throws(() => M.post(e, "/api/capitulos/nao-existe/1", { historia: "x" }, AGORA), (err) => err.status === 404);
});

test("pedido do capítulo leva a bíblia, o arco, o que já aconteceu e o capítulo anterior inteiro", () => {
  const e = estado();
  const p = M.get(e, "/api/roteiro/pedido?tipo=historia&serie=temporada-davi&cap=2&ideia=mais%20tens%C3%A3o", AGORA);
  assert.equal(p.tipo, "historia");
  assert.match(p.texto, /Capítulo 2 de 50/);
  assert.match(p.texto, /Davi \(id: davi\): aparência: menino de uns 15 anos/);
  assert.match(p.texto, /O desafio de Golias/, "batida do arco");
  assert.match(p.texto, /1\. O caçula ungido: Samuel unge/, "resumo do que já aconteceu");
  assert.match(p.texto, /CAPÍTULO ANTERIOR COMPLETO[\s\S]*cheiro do campo/);
  assert.match(p.texto, /150 a 190 palavras/);
  assert.match(p.texto, /DIREÇÃO DO AUTOR PARA ESTE CAPÍTULO: mais tensão/);
  assert.deepEqual(p.personagens, ["davi", "golias", "saul"]);
  const longa = Array.from({ length: 180 }, (_, i) => `palavra${i}`).join(" ");
  const q = M.get(e, `/api/roteiro/pedido?tipo=quadros&serie=temporada-davi&historia=${encodeURIComponent(longa)}`, AGORA);
  assert.match(q.texto, /em 10 a 12 blocos de 5 a 8 segundos/, "180 palavras = uns 72 s = 11 blocos");
  assert.match(q.texto, /NÃO descreva rosto/);
  assert.match(q.texto, /movimento_en/);
  assert.match(q.texto, /direcao: marcações de entonação/);
  assert.match(M.get(e, "/api/roteiro/pedido?tipo=fichas&serie=temporada-davi", AGORA).texto, /gênero e idade aparente, porte físico, tom de pele/);
  assert.match(M.get(e, "/api/roteiro/pedido?tipo=arco&serie=temporada-davi", AGORA).texto, /em 50 capítulos/);
  assert.throws(() => M.get(e, "/api/roteiro/pedido?tipo=senha&serie=temporada-davi", AGORA), (err) => err.status === 404);
});

test("tela do roteiro: exemplo, série vazia, novidades da IA e arco", () => {
  const e = estado();
  const t = tela(e);
  assert.equal(t.serie.id, "temporada-davi");
  assert.equal(t.cap.n, 2, "abre no próximo capítulo a escrever");
  const um = tela(e, "?cap=1").cap;
  assert.equal(um.quadros.length, 9);
  assert.equal(um.desatualizado, false);
  assert.ok(um.palavras >= 150 && um.palavras <= 190, `${um.palavras} palavras`);

  postar(e, "/api/series/temporada-davi/itens", { nome: "Samuel", aparencia: "profeta idoso, barba branca longa", roupas: "manto marrom" });
  assert.ok(e.series["temporada-davi"].personagens.some((p) => p.id === "samuel"));
  postar(e, "/api/series/temporada-davi/itens", { tipo: "cenario", nome: "Acampamento de Israel", descricao: "tendas no alto da colina" });
  assert.ok(e.series["temporada-davi"].cenarios.some((c) => c.id === "acampamento-de-israel"));

  postar(e, "/api/series/temporada-davi", { arco: [{ n: 3, titulo: "C" }, { n: 1, titulo: "A" }, { n: 1, titulo: "dup" }, { n: 99, titulo: "fora" }] });
  assert.deepEqual(e.series["temporada-davi"].arco.map((a) => a.n), [1, 3]);

  const vazio = { ...Semente.vazio(AGORA), modelos: MODELOS, plataformas: PLATAFORMAS, conexao: { modo: "demo" } };
  assert.equal(tela(vazio).serie, null);
  assert.equal(R.hashTexto("abc"), R.hashTexto("abc"));
  assert.notEqual(R.hashTexto("abc"), R.hashTexto("abd"));
});
