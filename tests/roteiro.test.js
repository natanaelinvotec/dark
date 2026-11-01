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

test("prompt do quadro: a ficha de cada personagem entra palavra por palavra", () => {
  const e = estado();
  const s = e.series["temporada-davi"];
  const davi = s.personagens.find((p) => p.id === "davi");
  const a = R.montarPrompt(s, { personagens: ["davi"], cenario: "pasto", acao_en: "the boy runs", enquadramento_en: "wide shot" });
  const b = R.montarPrompt(s, { personagens: ["davi", "golias", "ninguem"], cenario: "nao-existe", acao_en: "the boy faces the giant" });
  for (const p of [a, b]) assert.ok(p.includes(`Davi: ${davi.ficha_en}`), "mesma ficha nos dois quadros");
  assert.ok(a.startsWith(s.estilo));
  assert.match(a, /Setting, Pasto de Belém: dry rocky hills/);
  assert.match(a, /Avoid: text in the image/);
  assert.ok(!b.includes("ninguem") && !b.includes("Setting"), "ids fora da bíblia não entram");
  assert.ok(b.includes("Golias: towering warrior"));
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
  assert.ok(t.cap.n === 2 && R.montarPrompt(e.series[id], { personagens: ["davi"] }).includes("Davi: adult king, golden crown"));
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
  const q = M.get(e, `/api/roteiro/pedido?tipo=quadros&serie=temporada-davi&historia=${encodeURIComponent("Davi corre.")}`, AGORA);
  assert.match(q.texto, /9 a 13 quadros/);
  assert.match(q.texto, /NÃO descreva rosto/);
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
