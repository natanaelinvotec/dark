"use strict";
/* Testes do motor do painel (node --test tests/). Sem rede e sem Firebase. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const M = require("../web/js/motor.js");
const Semente = require("../web/js/semente.js");

const raiz = path.join(__dirname, "..");
const ler = (f) => JSON.parse(fs.readFileSync(path.join(raiz, f), "utf8"));
const CANAIS = Object.fromEntries(ler("web/dados/canais.json").map((c) => [c.slug, c]));
const PLATAFORMAS = ler("web/dados/plataformas.json");
const AGORA = new Date("2026-11-02T13:00:00-03:00"); // segunda, 13h em Brasília

function estadoVazio() {
  return {
    exemplo: false, canais: CANAIS, plataformas: PLATAFORMAS, videos: {}, contas: {}, acoes: [], eventos: [],
    custos: [], metricas: [], receitas: [], campanhas: [], config: {}, conexao: { modo: "demo" },
  };
}
function comExemplo() {
  return { ...Semente.criar(M, AGORA), canais: CANAIS, plataformas: PLATAFORMAS, conexao: { modo: "demo" } };
}
function postar(e, caminho, corpo, agora = AGORA) {
  const r = M.post(e, caminho, corpo, agora);
  M.aplicar(e, r.mudancas);
  return r.resposta;
}
function naFila(e, canal = "curiosidades", duracao = 68) {
  const { id } = postar(e, "/api/videos", { canal, titulo: "Relâmpagos do Catatumbo", duracao, descricao: "Raios quase sem parar. #ciencia #raios" });
  return id;
}

test("horário: pula os ocupados e respeita 30 min de folga", () => {
  const e = estadoVazio();
  const canal = CANAIS.curiosidades; // 12:00 e 18:30
  assert.equal(M.proximoHorario(e, canal, AGORA), "2026-11-02T18:30:00-03:00");
  e.videos.x = { id: "x", canal: "curiosidades", status: "aprovado", horario: "2026-11-02T18:30:00-03:00" };
  assert.equal(M.proximoHorario(e, canal, AGORA), "2026-11-03T12:00:00-03:00");
  assert.equal(M.proximoHorario(e, canal, new Date("2026-11-02T18:05:00-03:00")), "2026-11-03T12:00:00-03:00");
});

test("aprovar, desfazer e regras de origem", () => {
  const e = estadoVazio();
  const id = naFila(e);
  const r = postar(e, `/api/videos/${id}/acao`, { acao: "aprovar", revisao_s: 300 });
  assert.equal(r.status, "aprovado");
  assert.equal(e.videos[id].horario, "2026-11-02T18:30:00-03:00");
  assert.equal(e.videos[id].revisaoS, 300);
  assert.throws(() => M.post(e, `/api/videos/${id}/acao`, { acao: "aprovar" }, AGORA), (err) => err.status === 409);
  postar(e, `/api/videos/${id}/acao`, { acao: "desfazer" }, new Date(AGORA.getTime() + 1000));
  assert.equal(e.videos[id].status, "fila");
  assert.equal(e.videos[id].horario, null);
  assert.throws(() => M.post(e, `/api/videos/${id}/acao`, { acao: "apagar" }, AGORA), (err) => err.status === 422);
  assert.throws(() => M.post(e, "/api/videos/abcdef123456/acao", { acao: "aprovar" }, AGORA), (err) => err.status === 404);
  assert.equal(e.acoes.length, 2);
});

test("adicionar vídeo pronto: link do Drive e testes", () => {
  const e = estadoVazio();
  const { id } = postar(e, "/api/videos", {
    canal: "curiosidades", titulo: "Catatumbo", duracao: 55,
    link: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_qr-st/view?usp=sharing", descricao: "Raios. #ciencia",
  });
  const v = e.videos[id];
  assert.equal(v.status, "fila");
  assert.equal(v.driveId, "1AbCdEfGhIjKlMnOp_qr-st");
  assert.deepEqual(v.roteiro.hashtags, ["#ciencia"]);
  assert.equal(v.roteiro.descricao, "Raios.");
  assert.equal(v.testes[0].status, "at"); // 55 s não rende no TikTok
  for (const link of ["https://golpe.io/file/d/123456789012", "https://drive.google.com.golpe.io/file/d/123456789012", "http://drive.google.com/file/d/123456789012"]) {
    assert.throws(() => M.post(e, "/api/videos", { canal: "curiosidades", titulo: "abc", link }, AGORA), (err) => err.status === 422, link);
  }
  assert.throws(() => M.post(e, "/api/videos", { canal: "nao-existe", titulo: "abc" }, AGORA));
});

test("lote valida e cria pautas", () => {
  const e = estadoVazio();
  const r = postar(e, "/api/lotes", { canal: "biblico-manhwa", tema: "Davi e Golias", qtd: 3, serie: "Temporada Davi" });
  assert.equal(r.ids.length, 3);
  assert.ok(r.ids.every((i) => /^[a-f0-9]{12}$/.test(i)));
  assert.equal(e.videos[r.ids[0]].status, "pauta");
  assert.throws(() => M.post(e, "/api/lotes", { canal: "curiosidades", tema: "abc", qtd: 50 }, AGORA), (err) => err.status === 422);
});

test("publicar em cada plataforma muda o status do vídeo", () => {
  const e = estadoVazio();
  const id = naFila(e, "curiosidades", 55);
  assert.throws(() => M.post(e, `/api/publicacoes/${id}/youtube`, { situacao: "publicado" }, AGORA), (err) => err.status === 422);
  postar(e, `/api/videos/${id}/acao`, { acao: "aprovar" });

  const tela = M.get(e, "/api/publicar?aba=pendentes", AGORA);
  const plats = Object.fromEntries(tela.itens[0].plataformas.map((p) => [p.id, p]));
  assert.equal(plats.tiktok.elegivel.status, "at");
  assert.equal(plats.youtube.legenda.titulo, "Relâmpagos do Catatumbo");
  assert.match(plats.tiktok.legenda.texto, /#ciencia/);

  assert.throws(() => M.post(e, `/api/publicacoes/${id}/youtube`, { situacao: "publicado", url: "https://youtube.com.golpe.io/x" }, AGORA));
  const r = postar(e, `/api/publicacoes/${id}/youtube`, { situacao: "publicado", url: "https://www.youtube.com/shorts/abc" });
  assert.equal(r.video_status, "publicado");
  assert.ok(!r.pendentes.includes("youtube"));
  const primeiro = e.videos[id].publicacoes.youtube.publicadoEm;
  postar(e, `/api/publicacoes/${id}/youtube`, { situacao: "publicado", url: "https://youtu.be/abc" }, new Date(AGORA.getTime() + 60e3));
  assert.equal(e.videos[id].publicacoes.youtube.publicadoEm, primeiro);
  assert.equal(postar(e, `/api/publicacoes/${id}/youtube`, { situacao: "pendente" }).video_status, "aprovado");

  for (const p of CANAIS.curiosidades.plataformas) postar(e, `/api/publicacoes/${id}/${p}`, { situacao: "pulado" });
  assert.deepEqual(M.get(e, "/api/publicar?aba=feitos", AGORA).itens.map((i) => i.id), [id]);
});

test("contas: link, números e progresso", () => {
  const e = estadoVazio();
  const base = "/api/contas/curiosidades/tiktok";
  assert.throws(() => M.post(e, base, { situacao: "criada", url: "https://golpe.example/x" }, AGORA));
  assert.throws(() => M.post(e, base, { situacao: "criada", numeros: { inscritos: 1 } }, AGORA));
  assert.throws(() => M.post(e, base, { situacao: "banida" }, AGORA));
  assert.throws(() => M.post(e, base, { situacao: "criada", usuario: "eu mesmo" }, AGORA));
  const r = postar(e, base, { situacao: "crescendo", usuario: "@curio", url: "https://www.tiktok.com/@curio", numeros: { seguidores: 2500, views_30d: 150000 } });
  assert.deepEqual(r.numeros, { seguidores: 2500, views_30d: 150000 });
  const tiktok = M.get(e, "/api/plataformas", AGORA).plataformas.find((p) => p.id === "tiktok");
  const conta = tiktok.contas.find((c) => c.canal.id === "curiosidades");
  assert.deepEqual(conta.progresso.map((m) => m.pct), [25, 100]);
});

test("links: só https do domínio certo", () => {
  const d = ["tiktok.com"];
  assert.ok(M.hostAceito("https://www.tiktok.com/@x", d));
  assert.ok(M.hostAceito("HTTPS://WWW.TIKTOK.COM/@x", d));
  for (const ruim of ["http://www.tiktok.com", "https://tiktok.com.golpe.io/x", "https://faketiktok.com", "https://eu:senha@tiktok.com",
    "javascript:alert(1)", "https://golpe.com\\.tiktok.com/x", "https://golpe.com%2f.tiktok.com/x", "https://tiktok.com\t.golpe.io"]) {
    assert.ok(!M.hostAceito(ruim, d), ruim);
  }
});

test("configurações: vírgula, faixas e campos desconhecidos", () => {
  const e = estadoVazio();
  postar(e, "/api/config", { cambio_usd_brl: "5,30", teto_mes_brl: "200" });
  assert.equal(e.config.cambio_usd_brl, "5.3");
  assert.throws(() => M.post(e, "/api/config", { cambio_usd_brl: "99" }, AGORA), (err) => err.dados.erros.cambio_usd_brl === "entre 1 e 20");
  assert.throws(() => M.post(e, "/api/config", { senha: "x" }, AGORA), (err) => "senha" in err.dados.erros);
});

test("canal desligado no arquivo não liga pelo painel", () => {
  const e = estadoVazio();
  e.canais = { ...CANAIS, teste: { ...CANAIS.curiosidades, slug: "teste", enabled: false } };
  assert.throws(() => M.post(e, "/api/canais/teste/ligado", { ligado: true }, AGORA), (err) => err.status === 409);
  postar(e, "/api/canais/curiosidades/ligado", { ligado: false });
  assert.equal(M.get(e, "/api/canais", AGORA).canais.find((c) => c.id === "curiosidades").ligado, false);
});

test("todas as telas respondem com os dados de exemplo", () => {
  const e = comExemplo();
  for (const caminho of ["/api/resumo", "/api/fila?aba=fila", "/api/fila?aba=agendados", "/api/producao", "/api/canais", "/api/series",
    "/api/dinheiro", "/api/config", "/api/saude", "/api/plataformas", "/api/publicar?aba=pendentes", "/api/publicar?aba=feitos"]) {
    assert.ok(M.get(e, caminho, AGORA), caminho);
  }
  const r = M.get(e, "/api/resumo", AGORA);
  assert.equal(r.exemplo, true);
  assert.equal(r.kpis.esperando, 6);
  assert.ok(r.precisa.some((p) => p.rota === "aprovacao/reprovados"));
  assert.ok(r.precisa.some((p) => p.rota === "plataformas"));
  const d = M.get(e, "/api/dinheiro", AGORA);
  assert.equal(d.receita, 1240);
  assert.equal(d.sobra, 1240 - 178);
  assert.ok(M.get(e, "/api/series", AGORA)[0].personagens.length >= 3);
  assert.throws(() => M.get(e, "/api/nada", AGORA), (err) => err.status === 404);
  assert.throws(() => M.post(e, "/login", {}, AGORA), (err) => err.status === 404);
});

test("arquivos fixos: canais apontam para plataformas que existem", () => {
  const ids = new Set(PLATAFORMAS.plataformas.map((p) => p.id));
  for (const c of Object.values(CANAIS)) {
    for (const p of c.plataformas) assert.ok(ids.has(p), `${c.slug}: ${p}`);
    assert.deepEqual(c.formato.short_segundos, [61, 80]);
  }
  for (const p of PLATAFORMAS.plataformas) {
    for (const url of Object.values(p.urls)) assert.ok(!url || M.hostAceito(url, p.dominios), `${p.id}: ${url}`);
  }
});
