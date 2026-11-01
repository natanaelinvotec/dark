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
const MODELOS = ler("web/dados/modelos.json");
const PLATAFORMAS = ler("web/dados/plataformas.json");
const AGORA = new Date("2026-11-02T13:00:00-03:00"); // segunda, 13h em Brasília
const CONEXAO = { modo: "demo", uid: "demo", admin: false };
// os canais de exemplo nascem dos modelos, como na demonstração
const CANAIS = Semente.criar(M, AGORA, MODELOS).canais;

function estadoVazio(canais = CANAIS) {
  return {
    exemplo: false, canais: JSON.parse(JSON.stringify(canais)), modelos: MODELOS, plataformas: PLATAFORMAS, videos: {}, contas: {},
    acoes: [], eventos: [], custos: [], metricas: [], receitas: [], campanhas: [], config: {}, conexao: { ...CONEXAO },
  };
}
function comExemplo() {
  return { ...Semente.criar(M, AGORA, MODELOS), modelos: MODELOS, plataformas: PLATAFORMAS, conexao: { ...CONEXAO } };
}
const FORM_CANAL = {
  nome: "Histórias da Bíblia!", cor: "#2563c9", descricao: "Teste", horarios: ["19:00", "12:00", "12:00"],
  plataformas: ["tiktok", "youtube"], duracao_min: 61, duracao_max: 80,
};
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

test("criar canal: id pelo nome, modelo, ordem das redes e validação", () => {
  const e = estadoVazio({});
  const r = postar(e, "/api/canais", { ...FORM_CANAL, modelo: "biblico-manhwa" });
  assert.equal(r.slug, "historias-da-biblia");
  const c = e.canais[r.slug];
  assert.deepEqual(c.horarios, ["12:00", "19:00"]); // sem repetição, em ordem
  assert.deepEqual(c.plataformas, ["youtube", "tiktok"]); // na ordem de plataformas.json
  assert.equal(c.cor, "#2563C9");
  assert.equal(c.ligado, true);
  assert.equal(c.modelo, "biblico-manhwa");
  assert.ok(c.personagens.length >= 3, "herda os personagens do modelo");
  assert.deepEqual(c.formato.short_segundos, [61, 80]);
  assert.equal(c.formato.palavras_min, 150, "herda o formato do modelo");
  // mesmo nome de novo: ganha sufixo em vez de sobrescrever
  assert.equal(postar(e, "/api/canais", FORM_CANAL).slug, "historias-da-biblia-2");
  assert.deepEqual(e.canais["historias-da-biblia-2"].personagens, []);
  assert.equal(M.slugDe("  ¡Ciência & Espaço!  "), "ciencia-espaco");
  assert.equal(M.slugDe("***"), "canal");

  const erro = (corpo) => {
    try {
      M.post(e, "/api/canais", { ...FORM_CANAL, ...corpo }, AGORA);
    } catch (err) {
      assert.equal(err.status, 422);
      return err.dados.erros;
    }
    assert.fail("devia recusar");
  };
  assert.ok(erro({ nome: "x" }).nome);
  assert.ok(erro({ cor: "azul" }).cor);
  assert.ok(erro({ horarios: [] }).horarios);
  assert.ok(erro({ horarios: ["25:00"] }).horarios);
  assert.ok(erro({ horarios: ["08:00", "10:00", "12:00", "14:00", "16:00"] }).horarios);
  assert.ok(erro({ plataformas: [] }).plataformas);
  assert.ok(erro({ plataformas: ["orkut"] }).plataformas);
  assert.ok(erro({ duracao_min: 90, duracao_max: 60 }).duracao_min);
  assert.ok(erro({ duracao_max: 600 }).duracao_min);
  assert.throws(() => M.post(e, "/api/canais", { ...FORM_CANAL, modelo: "nao-existe" }, AGORA), (err) => err.status === 422);
});

test("criar canal: limite por estúdio", () => {
  const e = estadoVazio({});
  for (let i = 0; i < M.LIMITE_CANAIS; i += 1) postar(e, "/api/canais", { ...FORM_CANAL, nome: `Canal ${i}` });
  assert.throws(() => M.post(e, "/api/canais", FORM_CANAL, AGORA), (err) => err.status === 409);
});

test("editar canal: mantém o id e o que veio do modelo", () => {
  const e = estadoVazio();
  postar(e, "/api/canais/curiosidades", { ...FORM_CANAL, nome: "Curiosidades BR", horarios: ["09:00"], duracao_min: 62, duracao_max: 75 });
  const c = e.canais.curiosidades;
  assert.equal(c.nome, "Curiosidades BR");
  assert.deepEqual(c.horarios, ["09:00"]);
  assert.deepEqual(c.formato.short_segundos, [62, 75]);
  assert.equal(c.formato.palavras_max, 195, "o resto do formato continua");
  assert.equal(M.proximoHorario(e, c, AGORA), "2026-11-03T09:00:00-03:00");
  assert.throws(() => M.post(e, "/api/canais/nao-existe", FORM_CANAL, AGORA), (err) => err.status === 404);
});

test("ligar/desligar e apagar canal", () => {
  const e = estadoVazio();
  postar(e, "/api/canais/curiosidades/ligado", { ligado: false });
  assert.equal(M.get(e, "/api/canais", AGORA).canais.find((c) => c.id === "curiosidades").ligado, false);
  assert.equal(M.get(e, "/api/resumo", AGORA).kpis.planejados_7d, 14, "canal pausado não conta no planejado");

  postar(e, "/api/contas/biblico-manhwa/tiktok", { situacao: "criada", usuario: "@biblia" });
  postar(e, "/api/canais/biblico-manhwa/apagar", {});
  assert.ok(!e.canais["biblico-manhwa"]);
  assert.deepEqual(Object.keys(e.contas), [], "as contas do canal vão junto");

  naFila(e, "curiosidades");
  assert.throws(() => M.post(e, "/api/canais/curiosidades/apagar", {}, AGORA), (err) => err.status === 409);
  assert.equal(M.get(e, "/api/canais", AGORA).canais[0].n_videos, 1);
});

test("estúdio novo: tudo zerado e as telas não quebram", () => {
  const e = { ...Semente.vazio(AGORA), modelos: MODELOS, plataformas: PLATAFORMAS, conexao: { ...CONEXAO } };
  const r = M.get(e, "/api/resumo", AGORA);
  assert.equal(r.canais_total, 0);
  assert.equal(r.kpis.esperando, 0);
  assert.deepEqual(r.precisa, []);
  for (const caminho of ["/api/fila?aba=fila", "/api/producao", "/api/series", "/api/dinheiro", "/api/config", "/api/saude",
    "/api/plataformas", "/api/publicar?aba=pendentes"]) {
    assert.ok(M.get(e, caminho, AGORA), caminho);
  }
  const telaCanais = M.get(e, "/api/canais", AGORA);
  assert.deepEqual(telaCanais.canais, []);
  assert.deepEqual(telaCanais.modelos.map((m) => m.id), ["biblico-manhwa", "curiosidades"]);
  assert.throws(() => M.post(e, "/api/videos", { canal: "curiosidades", titulo: "abc" }, AGORA), (err) => err.status === 422);
  // primeiro canal a partir do modelo, e o primeiro vídeo já entra na fila
  const { slug } = postar(e, "/api/canais", { ...FORM_CANAL, nome: "Curiosidades", modelo: "curiosidades" });
  const { id } = postar(e, "/api/videos", { canal: slug, titulo: "Primeiro vídeo", duracao: 65 });
  assert.equal(M.get(e, "/api/resumo", AGORA).kpis.esperando, 1);
  assert.equal(e.videos[id].canal, "curiosidades");
});

test("dono da plataforma: cadastro e pausa de estúdio", () => {
  const e = comExemplo();
  assert.throws(() => M.get(e, "/api/plataforma", AGORA), (err) => err.status === 403);
  assert.throws(() => M.post(e, "/api/plataforma/acesso", { aberto: true }, AGORA), (err) => err.status === 403);
  e.conexao.admin = true;
  const tela = M.get(e, "/api/plataforma", AGORA);
  assert.equal(tela.aberto, false);
  assert.deepEqual(tela.estudios.map((s) => [s.uid, s.voce]), [["demo", true], ["convidada", false]]);

  const r = postar(e, "/api/plataforma/acesso", { aberto: false, convidados: "Ana@Gmail.com, bia@exemplo.com.br\nana@gmail.com" });
  assert.deepEqual(r.convidados, ["ana@gmail.com", "bia@exemplo.com.br"]);
  assert.throws(() => M.post(e, "/api/plataforma/acesso", { convidados: "sem-arroba" }, AGORA), (err) => /sem-arroba/.test(err.dados.erros.convidados));
  assert.throws(() => M.post(e, "/api/plataforma/acesso", { convidados: "<x>@a.com" }, AGORA), (err) => err.status === 422);

  postar(e, "/api/plataforma/estudios/convidada/ativo", { ativo: false });
  assert.equal(e.estudios.convidada.ativo, false);
  assert.throws(() => M.post(e, "/api/plataforma/estudios/demo/ativo", { ativo: false }, AGORA), (err) => err.status === 409);
  assert.throws(() => M.post(e, "/api/plataforma/estudios/ninguem/ativo", { ativo: false }, AGORA), (err) => err.status === 404);
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

test("arquivos fixos: modelos apontam para plataformas que existem", () => {
  const ids = new Set(PLATAFORMAS.plataformas.map((p) => p.id));
  for (const m of MODELOS) {
    assert.match(m.id, /^[a-z0-9][a-z0-9-]{0,40}$/);
    for (const p of m.plataformas) assert.ok(ids.has(p), `${m.id}: ${p}`);
    assert.deepEqual(m.formato.short_segundos, [61, 80]);
    assert.ok(m.horarios.every((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h)), m.id);
  }
  for (const p of PLATAFORMAS.plataformas) {
    for (const url of Object.values(p.urls)) assert.ok(!url || M.hostAceito(url, p.dominios), `${p.id}: ${url}`);
  }
});

test("dono da plataforma: o mesmo e-mail no config.js e nas regras do Firestore", () => {
  const config = fs.readFileSync(path.join(raiz, "web/config.js"), "utf8");
  const regras = fs.readFileSync(path.join(raiz, "firestore.rules"), "utf8");
  const admin = /admin:\s*"([^"]+)"/.exec(config);
  assert.ok(admin, "web/config.js precisa de admin");
  assert.match(regras, new RegExp(`email\\(\\) == '${admin[1].replace(/\./g, "\\.")}'`));
  assert.doesNotMatch(regras, /match \/(videos|contas|acoes)\//, "nada de coleção solta fora de estudios/{uid}");
});
