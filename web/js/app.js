"use strict";
/* Painel do Estúdio de Canais — JavaScript sem framework.
   Regras: todo texto vindo do banco passa por esc(); estilos dinâmicos via aplicarEstilos()
   (a CSP bloqueia style="" inline); rotas pelo hash; nada de handlers inline. */

const TITULOS = {
  inicio: "Visão geral",
  aprovacao: "Aprovação",
  plataformas: "Plataformas",
  producao: "Produção",
  canais: "Canais",
  series: "Séries",
  dinheiro: "Dinheiro",
  mais: "Mais ferramentas",
  config: "Configurações",
  saude: "Mais › Saúde do sistema",
  admin: "Mais › Plataforma",
};
const DO_MAIS = new Set(["saude", "admin"]);
const ABAS = ["fila", "prontos", "reprovados", "agendados"];
const tela = document.getElementById("tela");
const estado = {
  rota: null,
  param: null,
  formSujo: false,
  refazendo: null,
  recentes: new Map(),
  itensFila: new Map(),
  inicioRevisao: new Map(),
  legendas: new Map(),
  mensagem: null,
  levar: null,
  modelos: [],
  prefill: null,
  roteiro: { dados: null, ocupado: null, timer: null, sugestoes: [] },
};
const ABAS_PLAT = ["publicar", "feitos", "contas"];
const SITUACAO_PUB = { pendente: ["espera", "Pendente"], publicado: ["ok", "Publicado"], pulado: ["espera", "Pulado"] };
const SITUACAO_CONTA = {
  planejada: "Ainda não criei", criada: "Criada", crescendo: "Crescendo", monetizando: "Monetizando", pausada: "Pausada",
};
const linkExterno = (url, texto, classe = "mg-btn mg-sec mg-sm") =>
  /^https:\/\//i.test(url || "")
    ? `<a class="${classe}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(texto)} <span aria-hidden="true">↗</span><span class="mg-oculto"> (abre em nova aba)</span></a>`
    : "";

/* ------------------------------------------------------------------ utilidades */

const MAPA_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAPA_ESC[c]);
const NUM = new Intl.NumberFormat("pt-BR");
const NUM1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtNum = (n) => (n == null ? "—" : NUM.format(n));
const fmtMil = (n) => {
  if (n == null) return "—";
  if (n >= 1e6) return `${NUM1.format(n / 1e6)} mi`;
  if (n >= 1000) return `${NUM1.format(n / 1000)} mil`;
  return NUM.format(n);
};
const fmtBRL = (v) => (v == null ? "—" : BRL.format(v));
const fmtData = (iso, opcoes) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", opcoes);
};
const fmtHorario = (iso) =>
  fmtData(iso, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDur = (s) => {
  if (!s) return "—";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

const SVG = (corpo, extra = "") =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${corpo}</svg>`;
const ICONE = {
  ok: SVG('<path d="m5 12 4.5 4.5L19 7"></path>'),
  feito: SVG('<path d="m5 12 4.5 4.5L19 7"></path>'),
  at: SVG('<path d="M12 5v9M12 19v.5"></path>'),
  cr: SVG('<path d="m7 7 10 10M17 7 7 17"></path>'),
  erro: SVG('<path d="m7 7 10 10M17 7 7 17"></path>'),
  in: SVG('<circle cx="12" cy="12" r="8"></circle><path d="M12 11v5M12 8v.5"></path>'),
  rodando: SVG('<path d="M20 12a8 8 0 1 1-8-8"></path>'),
  voce: SVG('<circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"></path>'),
};
const CLASSE = {
  ok: "mg-c-ok", feito: "mg-c-ok", at: "mg-c-at", voce: "mg-c-at", cr: "mg-c-cr", erro: "mg-c-cr",
  in: "mg-c-in", info: "mg-c-in", run: "mg-c-in", rodando: "mg-c-in", espera: "mg-c-ne", pulado: "mg-c-ne",
};
const STATUS_ETAPA = {
  feito: "feito", rodando: "rodando", voce: "esperando você", erro: "erro", espera: "na espera", pulado: "pulado",
};
const NOME_ETAPA = {
  roteiro: "Roteiro", checagem: "Checagem", quadros: "Quadros", gancho: "Gancho", voz: "Voz",
  montagem: "Montagem", testes: "Testes", fila: "Sua fila",
};
const STATUS_VIDEO = {
  publicado: ["Publicado", "mg-c-ok"], aprovado: ["Agendado", "mg-c-ok"], fila: ["Na fila", "mg-c-in"],
  reprovado: ["Para refazer", "mg-c-cr"], voce: ["Esperando você", "mg-c-at"],
  produzindo: ["Em produção", "mg-c-ne"], pauta: ["Em produção", "mg-c-ne"],
  refazer: ["Refazendo", "mg-c-in"], rejeitado: ["Rejeitado", "mg-c-ne"],
};
const ROTULO_JANELA = {
  MISSAO: "Missão recebida", MISSAO_OCULTA: "Missão oculta", ITEM: "Item obtido", STATUS: "Status",
};
const FORNECEDOR = { gemini: "Gemini API", azure: "Voz (Azure)", vps: "Servidor (VPS)" };

function aplicarEstilos(raiz) {
  const limitar = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  raiz.querySelectorAll("[data-h]").forEach((el) => { el.style.height = `${Number(el.dataset.h) || 0}px`; });
  raiz.querySelectorAll("[data-b]").forEach((el) => { el.style.bottom = `${Number(el.dataset.b) || 0}px`; });
  raiz.querySelectorAll("[data-w]").forEach((el) => { el.style.width = `${limitar(el.dataset.w)}%`; });
  raiz.querySelectorAll("[data-x]").forEach((el) => { el.style.left = `${limitar(el.dataset.x)}%`; });
  raiz.querySelectorAll("[data-atraso]").forEach((el) => { el.style.animationDelay = `${Number(el.dataset.atraso) || 0}ms`; });
  raiz.querySelectorAll("[data-cor]").forEach((el) => {
    if (/^#[0-9a-fA-F]{6}$/.test(el.dataset.cor)) el.style.background = el.dataset.cor;
  });
}

/* ------------------------------------------------------------------ API */

/* Os dados vêm de js/dados.js (Firestore, ou o exemplo no navegador). As telas continuam
   pedindo por "caminhos" (/api/fila?aba=...), e o motor (js/motor.js) monta cada resposta. */
function api(caminho, opcoes = {}) {
  return opcoes.metodo === "POST" ? window.FONTE.post(caminho, opcoes.corpo ?? {}) : window.FONTE.get(caminho);
}
const enviar = (caminho, corpo = {}) => api(caminho, { metodo: "POST", corpo });

/* ------------------------------------------------------------------ cabeçalho e trilho */

function atualizarCabecalho(r) {
  const quando = r.numeros_em;
  document.getElementById("selo").textContent =
    `Números de ${fmtData(quando, { day: "2-digit", month: "2-digit" })} às ${fmtData(quando, { hour: "2-digit", minute: "2-digit" })}`;
  document.getElementById("chip-exemplo").hidden = !r.exemplo;
  const n = r.kpis.esperando;
  const badge = document.getElementById("badge-fila");
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.closest("a").setAttribute("aria-label", n ? `Aprovação, ${plural(n, "vídeo esperando", "vídeos esperando")}` : "Aprovação");
  const publicar = r.precisa.find((p) => p.rota === "plataformas");
  const badgePub = document.getElementById("badge-publicar");
  badgePub.hidden = !publicar;
  badgePub.textContent = publicar ? String(Math.min(publicar.n || 1, 99)) : "";
  badgePub.closest("a").setAttribute("aria-label", publicar ? `Plataformas, ${plural(publicar.n || 1, "vídeo para publicar", "vídeos para publicar")}` : "Plataformas");
  const urgente = r.precisa.some((p) => p.rota === "dinheiro" && p.nivel !== "in");
  const badgeDinheiro = document.getElementById("badge-dinheiro");
  badgeDinheiro.hidden = !urgente;
  badgeDinheiro.closest("a").setAttribute("aria-label", urgente ? "Dinheiro, precisa de atenção" : "Dinheiro");
}

async function recarregarCabecalho() {
  try {
    atualizarCabecalho(await api("/api/resumo"));
  } catch {
    /* o cabeçalho é secundário; a tela mostra o erro */
  }
}

function lerRota() {
  let bruto = location.hash.slice(1);
  try {
    bruto = decodeURIComponent(bruto);
  } catch {
    bruto = "";
  }
  // "#canais/editar/biblico" -> rota "canais", param "editar/biblico"
  const [rota, ...resto] = bruto.split("/");
  return Object.hasOwn(TITULOS, rota) ? { rota, param: resto.join("/") } : { rota: "inicio", param: "" };
}

function marcarTrilho(rota) {
  const ativa = DO_MAIS.has(rota) ? "mais" : rota;
  document.querySelectorAll(".mg-rail [data-rota]").forEach((a) => {
    if (a.dataset.rota === ativa) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const pilula = document.querySelector(`.mg-rail [data-rota="${ativa}"] .mg-pill`);
  if (pilula) {
    pilula.classList.add("mg-mostrar");
    setTimeout(() => pilula.classList.remove("mg-mostrar"), 1400);
  }
}

const esqueleto = () =>
  `<div class="mg-g4">${'<div class="mg-esqueleto"></div>'.repeat(4)}</div><div class="mg-esqueleto mg-mt"></div>`;

const telaErro = (erro) => `
  <div class="mg-card mg-vazio" role="alert">
    <p class="mg-h2">Não deu para carregar esta tela</p>
    <p class="mg-sub">${esc(erro.message)}</p>
    <button type="button" class="mg-btn mg-pri mg-mt" data-acao="tentar">Tentar de novo</button>
  </div>`;

async function navegar(comEsqueleto = true) {
  const destino = lerRota();
  // saindo do capítulo: o que foi digitado e ainda não foi salvo vai para o banco antes
  if (destino.rota !== estado.rota || destino.param !== estado.param) await salvarPendenteRoteiro();
  const { rota, param } = lerRota();
  if (rota !== estado.rota || param !== estado.param) {
    // itens "recém-decididos" só fazem sentido na aba onde a decisão foi tomada
    estado.recentes.clear();
    estado.refazendo = null;
    estado.formSujo = false;
    estado.mensagem = estado.levar; // recado deixado pela tela anterior (ex.: "Canal criado")
    estado.levar = null;
  }
  if (rota !== estado.rota) marcarTrilho(rota);
  estado.rota = rota;
  estado.param = param;
  document.getElementById("titulo").textContent = TITULOS[rota];
  document.title = `${TITULOS[rota]} · Estúdio de Canais`;
  if (comEsqueleto) tela.innerHTML = esqueleto();
  try {
    tela.innerHTML = await TELAS[rota](param);
    aplicarEstilos(tela);
  } catch (erro) {
    if (erro.message !== "Sessão expirada.") tela.innerHTML = telaErro(erro);
  }
}

/* ------------------------------------------------------------------ peças */

const kpi = (rotulo, valor, extra, atraso) => `
  <div class="mg-card mg-in" data-atraso="${atraso}">
    <p class="mg-lbl">${rotulo}</p>
    <p class="mg-num">${valor}</p>
    ${extra}
  </div>`;

const chip = (status, texto, titulo = "") =>
  `<span class="mg-chip ${CLASSE[status] || "mg-c-ne"}"${titulo ? ` title="${esc(titulo)}"` : ""}>${ICONE[status] || ""}${esc(texto)}</span>`;

const barra = (pct, cor = "#389E92") => `<div class="mg-bar"><span data-w="${pct}" data-cor="${cor}"></span></div>`;

/* ------------------------------------------------------------------ telas */

const TELAS = {
  async inicio() {
    const r = await api("/api/resumo");
    atualizarCabecalho(r);
    if (r.canais_total === 0) return boasVindas(await api("/api/canais"));
    const k = r.kpis;
    const porCanal = k.por_canal.length
      ? k.por_canal.map((c) => `${c.n} de ${esc(c.nome)}`).join(", ")
      : "Nada esperando você";
    const pct = k.planejados_7d ? Math.round((k.publicados_7d / k.planejados_7d) * 100) : 0;
    const variacao = k.variacao_views == null
      ? '<p class="mg-sub">Sem semana anterior para comparar</p>'
      : chip(k.variacao_views >= 0 ? "ok" : "at", `${k.variacao_views >= 0 ? "+" : ""}${k.variacao_views}% sobre a semana anterior`);
    const receitas = k.receitas.length
      ? k.receitas.map((x) => `${fmtBRL(x.valor)} de ${esc(x.fonte)}`).join(" e ")
      : "Nenhuma receita lançada neste mês";
    return `
      <section class="mg-g4" aria-label="Resumo">
        ${kpi("Esperando sua aprovação", plural(k.esperando, "vídeo", "vídeos"),
          `<p class="mg-sub">${porCanal}</p><a class="mg-btn mg-pri mg-sm mg-mt" href="#aprovacao">Abrir a fila</a>`, 50)}
        ${kpi("Publicados em 7 dias", fmtNum(k.publicados_7d),
          `<p class="mg-sub">de ${fmtNum(k.planejados_7d)} planejados</p>${barra(pct)}`, 100)}
        ${kpi("Visualizações em 7 dias", fmtMil(k.views_7d), variacao, 150)}
        ${kpi("Receita prevista no mês", fmtBRL(k.receita_prevista),
          `<p class="mg-sub">${receitas}</p>${chip("in", "Prevista até o pagamento cair")}`, 200)}
      </section>
      <section class="mg-split mg-mt">${pecaGrafico(r.grafico)}${pecaPrecisa(r.precisa)}</section>
      <section class="mg-split mg-mt">${pecaLinha(r.linha)}${pecaGatilho(r.gatilho)}</section>`;
  },

  async aprovacao(param) {
    const aba = ABAS.includes(param) ? param : "fila";
    const d = await api(`/api/fila?aba=${aba}`);
    const ids = new Set(d.itens.map((i) => i.id));
    const itens = [...d.itens, ...[...estado.recentes.values()].filter((i) => !ids.has(i.id))];
    estado.itensFila = new Map(itens.map((i) => [i.id, i]));
    const VAZIO = {
      fila: ["Fila vazia", "Nada esperando você agora. Vídeos novos aparecem aqui assim que passam pelos testes."],
      prontos: ["Nenhum vídeo pronto", "Os vídeos que passarem em todos os testes aparecem aqui."],
      reprovados: ["Nada para refazer", "Todos os vídeos da fila passaram nos testes."],
      agendados: ["Nada agendado ainda", "Aprove um vídeo na fila e ele aparece aqui com o horário de publicação."],
    };
    const abas = d.abas
      .map((a) => `<button type="button" class="mg-tab" data-aba="${esc(a.id)}" aria-pressed="${a.id === aba}">${esc(a.rotulo)}<span class="mg-cnt">${a.n}</span></button>`)
      .join("");
    const vazio = itens.length
      ? ""
      : `<div class="mg-card mg-vazio mg-mt"><p class="mg-h2">${VAZIO[aba][0]}</p><p class="mg-sub">${VAZIO[aba][1]}</p>
         ${aba === "agendados" ? "" : '<a class="mg-btn mg-sec mg-mt" href="#producao">Gerar um lote</a>'}</div>`;
    return `
      <div class="mg-card mg-in mg-barra-abas">
        <div class="mg-abas" role="group" aria-label="Filtrar a fila">${abas}</div>
        <p class="mg-sub">Assista antes de aprovar. Aprovar agenda o vídeo no próximo horário livre do canal.</p>
      </div>
      ${vazio}
      <section class="mg-g2 mg-mt" aria-label="Vídeos">${itens.map(cartaoVideo).join("")}</section>`;
  },

  async producao(param) {
    if (param.startsWith("roteiro")) return abasProducao("roteiro") + await telaRoteiro(param);
    const [p, c] = await Promise.all([api("/api/producao"), api("/api/canais")]);
    // vindo do Roteiro com IA ("já fiz o vídeo deste capítulo"): o formulário já chega preenchido
    const pre = estado.prefill || {};
    estado.prefill = null;
    const opcoes = c.canais
      .filter((x) => x.ligado)
      .map((x) => `<option value="${esc(x.id)}"${x.id === pre.canal ? " selected" : ""}>${esc(x.nome)}</option>`)
      .join("");
    const videos = p.videos.length
      ? p.videos.map(linhaProducao).join("")
      : '<p class="mg-sub mg-mt">Nada em produção. Gere um lote ao lado.</p>';
    const eventos = p.eventos.length
      ? p.eventos.map((e) => `<div><span class="h">${esc(fmtData(e.ts, { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</span><span class="${esc(e.nivel)}">${esc(e.etapa)}</span><span class="alvo">${esc(e.alvo)}</span><span class="${esc(e.nivel)}">${esc(e.msg)}</span></div>`).join("")
      : "<div>Sem eventos ainda.</div>";
    const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok mg-mt" role="status">${esc(estado.mensagem)}</p>` : "";
    const semCanal = `
        <div class="mg-card mg-in mg-vazio">
          <p class="mg-h2">${c.canais.length ? "Todos os canais estão pausados" : "Crie um canal primeiro"}</p>
          <p class="mg-sub">${c.canais.length ? "Ligue um canal para adicionar vídeos e gerar lotes." : "Os vídeos entram sempre em um canal do seu estúdio."}</p>
          <a class="mg-btn mg-pri mg-mt" href="#canais${c.canais.length ? "" : "/novo"}">${c.canais.length ? "Abrir Canais" : "Criar canal"}</a>
        </div>`;
    if (!opcoes) {
      return `${abasProducao("linha")}<section class="mg-split mg-split-inv"><div>${semCanal}</div>
        <div class="mg-card mg-in"><h2 class="mg-h2">Em produção agora</h2>${videos}</div></section>`;
    }
    return `${abasProducao("linha")}
      <section class="mg-split mg-split-inv">
       <div>
        <form class="mg-card mg-in" data-form="adicionar" aria-labelledby="t-adicionar" novalidate>
          <h2 class="mg-h2" id="t-adicionar">Adicionar vídeo pronto</h2>
          <p class="mg-sub">Fez o vídeo em outra ferramenta? Cole o link do Google Drive (compartilhado como "qualquer pessoa com o link") e ele entra na fila de aprovação.</p>
          <div class="mg-campo"><label for="a-canal">Canal</label><select class="mg-input" id="a-canal" name="canal">${opcoes}</select></div>
          <div class="mg-campo"><label for="a-titulo">Título</label><input class="mg-input" id="a-titulo" name="titulo" maxlength="120" required aria-describedby="e-a-titulo" value="${esc(pre.titulo || "")}"><p class="mg-erro" id="e-a-titulo"></p></div>
          <div class="mg-campo"><label for="a-link">Link do vídeo no Drive</label><input class="mg-input" id="a-link" name="link" type="url" inputmode="url" maxlength="300" placeholder="https://drive.google.com/file/d/…" aria-describedby="e-a-link"><p class="mg-erro" id="e-a-link"></p></div>
          <div class="mg-g2">
            <div class="mg-campo"><label for="a-duracao">Duração (segundos)</label><input class="mg-input" id="a-duracao" name="duracao" type="number" min="1" max="600" inputmode="numeric" placeholder="ex.: 68"></div>
            <div class="mg-campo"><label for="a-serie">Série (opcional)</label><input class="mg-input" id="a-serie" name="serie" maxlength="120" value="${esc(pre.serie || "")}"></div>
          </div>
          <div class="mg-campo"><label for="a-descricao">Descrição e hashtags (opcional)</label><textarea class="mg-input" id="a-descricao" name="descricao" maxlength="1000" placeholder="Uma linha de descrição. #curiosidades #ciencia">${esc(pre.descricao || "")}</textarea></div>
          <button type="submit" class="mg-btn mg-pri mg-mt">Mandar para a fila</button>
        </form>
        <form class="mg-card mg-in mg-mt" data-form="lote" aria-labelledby="t-lote" novalidate>
          <h2 class="mg-h2" id="t-lote">Gerar lote</h2>
          <p class="mg-sub">Registra as pautas. A produção automática (roteiro, voz, montagem) entra quando as Cloud Functions forem ligadas.</p>
          <div class="mg-campo"><label for="f-canal">Canal</label><select class="mg-input" id="f-canal" name="canal">${opcoes}</select></div>
          <div class="mg-campo"><label for="f-tema">Tema</label><input class="mg-input" id="f-tema" name="tema" maxlength="300" required aria-describedby="e-tema"><p class="mg-erro" id="e-tema"></p></div>
          <div class="mg-campo"><label for="f-serie">Série (opcional)</label><input class="mg-input" id="f-serie" name="serie" maxlength="120"></div>
          <div class="mg-campo"><label for="f-ref">Trecho base (opcional)</label><input class="mg-input" id="f-ref" name="referencia" maxlength="120" placeholder="Ex.: 1 Samuel 17:38-39"></div>
          <div class="mg-campo"><label for="f-qtd">Quantos vídeos (1 a 10)</label><input class="mg-input" id="f-qtd" name="qtd" type="number" min="1" max="10" value="3" inputmode="numeric"></div>
          <button type="submit" class="mg-btn mg-pri mg-mt">Gerar vídeos</button>
          <div aria-live="polite">${msg}</div>
        </form>
       </div>
        <div class="mg-card mg-in" data-atraso="50">
          <h2 class="mg-h2">Em produção agora</h2>
          <p class="mg-sub">Cada linha é um vídeo; cada bloco, uma etapa</p>
          <div class="mg-legenda mg-mt">${chip("feito", "Feito")}${chip("rodando", "Rodando")}${chip("voce", "Esperando você")}${chip("erro", "Erro")}${chip("espera", "Na espera")}</div>
          ${videos}
        </div>
      </section>
      <section class="mg-console mg-mt mg-in" data-atraso="100" aria-labelledby="t-console">
        <h2 class="mg-h2" id="t-console">Console</h2>
        <div class="mg-log" role="log" aria-label="Eventos da linha de produção">${eventos}</div>
      </section>`;
  },

  async canais(param) {
    const d = await api("/api/canais");
    const [modo, alvo = ""] = param.split("/");
    const editando = modo === "editar" ? d.canais.find((c) => c.id === alvo) : null;
    const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok" role="status">${esc(estado.mensagem)}</p>` : "";
    if (modo === "novo" && d.canais.length >= d.limite) {
      return `<div class="mg-card mg-vazio"><p class="mg-h2">Limite de ${d.limite} canais</p>
        <p class="mg-sub">Apague ou reaproveite um canal antes de criar outro.</p><a class="mg-btn mg-sec mg-mt" href="#canais">Voltar</a></div>`;
    }
    if (modo === "novo" || editando) return formCanal(d, editando, modo === "novo" ? alvo : "");
    if (!d.canais.length) {
      return `
        <div class="mg-card mg-in mg-vazio"><p class="mg-h2">Nenhum canal ainda</p>
          <p class="mg-sub">Crie o primeiro canal a partir de um modelo ou em branco.</p><div aria-live="polite">${msg}</div></div>
        <section class="mg-g3 mg-mt" aria-label="Modelos de canal">${escolhaDeModelo(d)}</section>`;
    }
    const cards = d.canais.map((c, i) => {
      const ypp = c.ypp;
      const pctInscritos = ypp.inscritos ? (ypp.inscritos / ypp.inscritos_meta) * 100 : 0;
      const pctViews = (ypp.views_90d / ypp.views_meta) * 100;
      return `
        <article class="mg-card mg-in" data-id="${esc(c.id)}" data-atraso="${50 + i * 50}">
          <div class="mg-entre">
            <h2 class="mg-h2 mg-com-ponto"><span class="mg-ponto" data-cor="${esc(c.cor)}"></span>${esc(c.nome)}</h2>
            <button type="button" class="mg-switch" role="switch" aria-checked="${c.ligado}" aria-label="Publicação do canal ${esc(c.nome)}" data-acao="ligar"></button>
          </div>
          <p class="mg-sub">${esc(c.descricao)}</p>
          <p class="mg-mt">${chip(c.ligado ? "ok" : "espera", c.ligado ? "Ligado, produzindo" : "Pausado, nada será gerado")}</p>
          <p class="mg-sub mg-mt">Publica às ${esc(c.horarios.join(", ") || "—")} · ${plural(c.plataformas.length, "rede", "redes")} · ${esc(c.duracao[0])} a ${esc(c.duracao[1])} s</p>
          <dl class="mg-dados">
            <div><dt>Inscritos no YouTube</dt><dd>${fmtNum(c.inscritos)}</dd></div>
            <div><dt>Seguidores no TikTok</dt><dd>${fmtNum(c.seguidores_tiktok)}</dd></div>
            <div><dt>Views em 30 dias</dt><dd>${fmtMil(c.views_30d)}</dd></div>
            <div><dt>Média por Short</dt><dd>${fmtMil(c.media_por_short)}</dd></div>
            <div><dt>Revisão média</dt><dd>${c.revisao_min == null ? "—" : `${NUM1.format(c.revisao_min)} min`}</dd></div>
            <div><dt>Avisos de política</dt><dd>${fmtNum(c.avisos)}</dd></div>
          </dl>
          <div class="mg-bloco">
            <p class="mg-forte">Nível inicial do YouTube</p>
            <div class="mg-entre mg-sub"><span>Inscritos</span><b>${fmtNum(ypp.inscritos)} de ${fmtNum(ypp.inscritos_meta)}</b></div>
            ${barra(pctInscritos)}
            <div class="mg-entre mg-sub"><span>Views em Shorts, 90 dias</span><b>${fmtMil(ypp.views_90d)} de ${fmtMil(ypp.views_meta)}</b></div>
            ${barra(pctViews, c.cor)}
          </div>
          <p class="mg-sub mg-mt">Próxima publicação: <b>${c.proxima ? fmtHorario(c.proxima) : "nada agendado"}</b></p>
          <div class="mg-acoes mg-mt"><a class="mg-btn mg-sec mg-sm" href="#canais/editar/${encodeURIComponent(c.id)}">Editar canal</a></div>
          <p class="mg-erro" aria-live="polite"></p>
        </article>`;
    }).join("");
    const novo = d.canais.length < d.limite
      ? '<a class="mg-btn mg-pri" href="#canais/novo">Novo canal</a>'
      : `<span class="mg-sub">Limite de ${d.limite} canais</span>`;
    return `
      <div class="mg-card mg-in mg-barra-abas">
        <div class="mg-entre"><p class="mg-sub">${plural(d.canais.length, "canal", "canais")} neste estúdio. Cada um tem horários, redes e contas próprios.</p>${novo}</div>
        <div aria-live="polite">${msg}</div>
      </div>
      <section class="mg-g3 mg-mt" aria-label="Canais">${cards}</section>
      <div class="mg-mt">${pecaGatilho(d.gatilho, "Gatilho para abrir o próximo canal")}</div>`;
  },

  async series() {
    const lista = await api("/api/series");
    if (!lista.length) {
      return `<div class="mg-card mg-vazio"><p class="mg-h2">Nenhuma série ainda</p>
        <p class="mg-sub">Gere um lote com o campo Série preenchido (ex.: Temporada Davi).</p>
        <a class="mg-btn mg-pri mg-mt" href="#producao">Gerar um lote</a></div>`;
    }
    return lista.map((s, i) => {
      const eps = s.episodios.map((e, n) => {
        const [rotulo, classe] = STATUS_VIDEO[e.status] || [e.status, "mg-c-ne"];
        return `<div class="mg-ep"><span class="mg-epn" aria-label="Episódio ${n + 1}">${n + 1}</span>
          <div class="mg-flex1"><p class="mg-forte">${esc(e.titulo)}</p><p class="mg-sub">${esc(e.referencia)}</p></div>
          <span class="mg-chip ${classe}">${esc(rotulo)}</span></div>`;
      }).join("");
      const pers = s.personagens.length
        ? `<h3 class="mg-h3">Personagens</h3><ul class="mg-lista">${s.personagens.map((p) => `<li><b>${esc(p.id)}</b>: ${esc(p.descricao)} <span class="mg-sub">(${esc(p.ficha)})</span></li>`).join("")}</ul>`
        : "";
      return `
        <article class="mg-card mg-in ${i ? "mg-mt" : ""}" data-atraso="${50 + i * 50}">
          <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(s.canal.cor)}"></span>${esc(s.canal.nome)}</p>
          <h2 class="mg-h2 mg-grande">${esc(s.serie)}</h2>
          <p class="mg-sub">${plural(s.episodios.length, "episódio", "episódios")}</p>
          <div class="mg-mt">${eps}</div>
          ${pers}
        </article>`;
    }).join("");
  },

  async dinheiro() {
    const d = await api("/api/dinheiro");
    const custos = [...d.custos];
    if (d.ai_pro_brl) custos.push({ fornecedor: "Google AI Pro", valor: d.ai_pro_brl });
    const base = Math.max(d.receita, d.gasto, 1);
    let cursor = 0;
    const linhas = [];
    d.receitas.forEach((r) => {
      linhas.push({ nome: `+ ${r.fonte}`, x: (cursor / base) * 100, w: (r.valor / base) * 100, cor: "#0E9A82", valor: fmtBRL(r.valor), classe: "" });
      cursor += r.valor;
    });
    custos.forEach((c) => {
      cursor -= c.valor;
      linhas.push({ nome: `− ${FORNECEDOR[c.fornecedor] || c.fornecedor}`, x: (Math.max(cursor, 0) / base) * 100, w: (c.valor / base) * 100, cor: "#8A9A9C", valor: `− ${fmtBRL(c.valor)}`, classe: "mg-txt-cr" });
    });
    if (!d.ai_pro_brl) linhas.push({ nome: "− Google AI Pro", x: 0, w: 0, cor: "#8A9A9C", valor: "—", classe: "mg-sub" });
    const cascata = linhas.map((l) => `
      <div class="mg-wf"><span>${esc(l.nome)}</span>
        <div class="mg-wf-trilho"><i data-x="${l.x}" data-w="${l.w}" data-cor="${l.cor}"></i></div>
        <b class="${l.classe}">${esc(l.valor)}</b></div>`).join("");
    const sobra = `<div class="mg-wf mg-wf-total"><b>= Sobra para você</b>
        <div class="mg-wf-trilho"><i data-x="0" data-w="${(Math.max(d.sobra, 0) / base) * 100}" data-cor="#002D72"></i></div>
        <b class="${d.sobra < 0 ? "mg-txt-cr" : ""}">${fmtBRL(d.sobra)}</b></div>`;
    const flowUsado = d.flow.restantes == null ? null : d.flow.total - d.flow.restantes;
    const campanhas = d.campanhas.length
      ? `<div class="mg-rolar"><table class="mg-tabela"><thead><tr><th>Campanha</th><th class="r">Views aprovadas</th><th class="r">Valor por mil</th><th class="r">A receber</th><th>Situação</th><th class="r">R$ por hora sua</th></tr></thead><tbody>
          ${d.campanhas.map((c) => `<tr><td><b>${esc(c.nome)}</b> <span class="mg-sub">(${esc(c.tipo)})</span></td><td class="r">${fmtMil(c.views_aprovadas)}</td><td class="r">US$ ${NUM1.format(c.valor_mil_usd)}</td><td class="r"><b>${fmtBRL(c.a_receber_brl)}</b></td><td>${chip(c.situacao === "aprovada" ? "ok" : "at", c.situacao)}</td><td class="r">${fmtBRL(c.rs_hora)}</td></tr>`).join("")}
        </tbody></table></div>`
      : '<p class="mg-sub">Nenhuma campanha cadastrada.</p>';
    return `
      <section class="mg-g4" aria-label="Resumo do mês">
        ${kpi("Receita prevista no mês", fmtBRL(d.receita), chip("in", "Prevista até o pagamento cair"), 50)}
        ${kpi("Custos do mês", fmtBRL(d.gasto), d.ai_pro_brl ? "" : '<p class="mg-sub">Sem a assinatura do Google AI Pro: informe o valor abaixo</p>', 100)}
        ${kpi("Sobra para você", fmtBRL(d.sobra), d.receita ? `<p class="mg-sub">${Math.round((d.sobra / d.receita) * 100)}% da receita prevista</p>` : "", 150)}
        ${kpi("Créditos do Flow", d.flow.restantes == null ? "—" : `${fmtNum(d.flow.restantes)} de ${fmtNum(d.flow.total)}`, d.flow.restantes != null && d.flow.restantes / d.flow.total < 0.25 ? chip("at", "Acabando") : "", 200)}
      </section>
      <section class="mg-split mg-mt">
        <div class="mg-card mg-in" data-atraso="250">
          <h2 class="mg-h2">Caixa do mês</h2>
          <p class="mg-sub">O que entra, o que sai e o que sobra</p>
          <div class="mg-mt" role="img" aria-label="Cascata: receitas, custos e sobra de ${esc(fmtBRL(d.sobra))}">${cascata}${sobra}</div>
          <form class="mg-form-linha mg-mt" data-form="aipro" novalidate>
            <div class="mg-campo mg-flex1"><label for="f-aipro">Google AI Pro por mês (R$)</label>
              <input class="mg-input" id="f-aipro" name="preco_ai_pro_brl" inputmode="decimal" value="${esc(d.ai_pro_brl ?? "")}" aria-describedby="e-aipro">
              <p class="mg-erro" id="e-aipro"></p></div>
            <button type="submit" class="mg-btn mg-pri">Salvar</button>
          </form>
        </div>
        <div class="mg-card mg-in" data-atraso="300">
          <h2 class="mg-h2">Custos de IA</h2>
          <p class="mg-sub">API cobrada à parte; Flow vem na assinatura</p>
          <div class="mg-entre mg-mt"><b>Gemini API</b><span>${fmtBRL(d.gemini.gasto)} de ${fmtBRL(d.gemini.teto)}</span></div>
          ${barra(d.gemini.teto ? (d.gemini.gasto / d.gemini.teto) * 100 : 0, "#2563C9")}
          <div class="mg-entre mg-mt"><b>Flow (Veo)</b><span>${flowUsado == null ? "informe em Configurações" : `${fmtNum(flowUsado)} de ${fmtNum(d.flow.total)} usados`}</span></div>
          ${flowUsado == null ? "" : barra((flowUsado / d.flow.total) * 100, "#94530A")}
          <p class="mg-sub mg-mt">Câmbio usado: R$ ${NUM1.format(d.cambio)} por dólar.</p>
        </div>
      </section>
      <section class="mg-card mg-mt mg-in" data-atraso="350"><h2 class="mg-h2">Campanhas de clipping</h2>${campanhas}</section>`;
  },

  async config() {
    const d = await api("/api/config");
    const CAMPOS = [
      ["teto_mes_brl", "Teto de gasto com IA por mês (R$)"],
      ["preco_entrada_milhao_brl", "Gemini: entrada, R$ por milhão de tokens"],
      ["preco_saida_milhao_brl", "Gemini: saída, R$ por milhão de tokens"],
      ["preco_tts_milhao_chars_brl", "Azure: R$ por milhão de caracteres"],
      ["preco_ai_pro_brl", "Google AI Pro por mês (R$)"],
      ["cambio_usd_brl", "Câmbio (R$ por dólar)"],
      ["creditos_flow_restantes", "Créditos do Flow restantes"],
      ["creditos_flow_total", "Créditos do Flow por mês"],
    ];
    const campos = CAMPOS.map(([nome, rotulo]) => `
      <div class="mg-campo"><label for="c-${nome}">${rotulo}</label>
        <input class="mg-input" id="c-${nome}" name="${nome}" inputmode="decimal" value="${esc(d.valores[nome])}" placeholder="—" aria-describedby="e-${nome}">
        <p class="mg-erro" id="e-${nome}"></p></div>`).join("");
    const c = d.conexao;
    const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok mg-mt" role="status">${esc(estado.mensagem)}</p>` : "";
    return `
      <section class="mg-split">
        <form class="mg-card mg-in" data-form="config" novalidate>
          <h2 class="mg-h2">Preços e créditos</h2>
          <p class="mg-sub">Sem preço, o custo aparece como "—". Nada aqui é segredo.</p>
          <div class="mg-g2">${campos}</div>
          <button type="submit" class="mg-btn mg-pri mg-mt">Salvar</button>
          <div aria-live="polite">${msg}</div>
        </form>
        <div class="mg-card mg-in" data-atraso="50">
          <h2 class="mg-h2">Conexão</h2>
          <p class="mg-sub">${c.modo === "firebase" ? "Seu estúdio fica no Firebase, separado dos estúdios das outras contas." : "Modo demonstração: os dados ficam só neste navegador."}</p>
          <dl class="mg-dados">
            <div><dt>Modo</dt><dd class="mg-pequeno">${c.modo === "firebase" ? "Firebase" : "Demonstração"}</dd></div>
            <div><dt>Projeto</dt><dd class="mg-pequeno">${esc(c.projeto || "—")}</dd></div>
            <div><dt>Conta</dt><dd class="mg-pequeno">${esc(c.email || "—")}</dd></div>
            <div><dt>Papel</dt><dd class="mg-pequeno">${c.admin ? "Dono da plataforma" : "Dono do próprio estúdio"}</dd></div>
            <div><dt>Produção automática</dt><dd class="mg-pequeno">${c.funcoes ? "Cloud Functions ligadas" : "Ainda não (functions/)"}</dd></div>
          </dl>
          <p class="mg-sub mg-mt">Atualizações do painel chegam para todos os estúdios ao mesmo tempo, no próximo carregamento da página.</p>
        </div>
      </section>`;
  },

  async saude() {
    const s = await api("/api/saude");
    const itens = [
      ["Banco", s.modo === "firebase" ? "ok" : "at", s.modo === "firebase" ? `Firebase: ${s.projeto}` : "Demonstração: dados só neste navegador"],
      ["Login", s.email ? "ok" : "at", s.email || "sem login (demonstração)"],
      ["Canais", s.canais ? "ok" : "at", s.canais ? plural(s.canais, "canal criado", "canais criados") : "nenhum canal: crie o primeiro em Canais"],
      ["Produção automática", s.funcoes ? "ok" : "at", s.funcoes ? "Cloud Functions ligadas" : "Ainda não instalada (pasta functions/)"],
      ["Regras das plataformas", s.plataformas_dias > 90 ? "at" : "ok", `conferidas há ${s.plataformas_dias} dias`],
      ["Erros em 24 h", s.erros_24h ? "at" : "ok", plural(s.erros_24h, "erro", "erros")],
    ];
    const cards = itens.map(([nome, st, detalhe], i) => `
      <div class="mg-card mg-in" data-atraso="${50 + i * 40}">
        <p class="mg-lbl">${nome}</p>
        <p class="mg-mt">${chip(st, st === "ok" ? "Tudo certo" : st === "at" ? "Atenção" : "Problema")}</p>
        <p class="mg-sub mg-quebra">${esc(detalhe)}</p>
      </div>`).join("");
    const status = Object.entries(s.status).map(([k, n]) => `<li>${chip("espera", `${(STATUS_VIDEO[k] || [k])[0]}: ${n}`)}</li>`).join("");
    const ultimo = s.ultimo_evento
      ? `${esc(fmtData(s.ultimo_evento.ts, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}: ${esc(s.ultimo_evento.etapa)}, ${esc(s.ultimo_evento.msg)}`
      : "Nenhum evento ainda.";
    return `
      <section class="mg-g3">${cards}</section>
      <section class="mg-card mg-mt mg-in" data-atraso="300">
        <h2 class="mg-h2">Vídeos por situação</h2>
        <ul class="mg-testes mg-mt">${status || "<li class='mg-sub'>Nenhum vídeo ainda.</li>"}</ul>
        <p class="mg-sub mg-mt">Último evento: ${ultimo}</p>
        <p class="mg-sub">Versão ${esc(s.versao)}</p>
      </section>`;
  },

  async mais() {
    const ATALHOS = [
      ["#plataformas/contas", "Contas e programas", "YouTube, TikTok, Facebook, Instagram, Kwai e Snapchat"],
      ["#config", "Configurações", "Teto, preços, câmbio e créditos"],
      ["#saude", "Saúde do sistema", "Firebase, login e produção automática"],
      ["#canais", "Canais", "Criar, editar, ligar e desligar canais"],
      ["#series", "Séries", "Temporadas e personagens"],
      ["#dinheiro", "Dinheiro", "Caixa do mês e custos de IA"],
    ];
    const EM_BREVE = [
      ["Calendário", "Semana e mês de publicações"],
      ["Ativos e licenças", "Origem e licença de cada arquivo"],
      ["Pautas", "Ideias com nota e similaridade"],
      ["Comentários", "YouTube e TikTok num lugar só"],
    ];
    if (window.FONTE.admin) ATALHOS.push(["#admin", "Plataforma", "Cadastro de novas contas e estúdios (só você vê)"]);
    const grupo = (titulo, cards) => `<h2 class="mg-h2 mg-mt">${titulo}</h2><div class="mg-g3 mg-mt">${cards}</div>`;
    const demo = window.FONTE.modo === "demo"
      ? `<h2 class="mg-h2 mg-mt">Demonstração</h2>
         <div class="mg-card mg-mt"><p class="mg-sub">Os dados de exemplo ficam só neste navegador. "Estúdio vazio" mostra o que uma conta nova vê no primeiro acesso.</p>
         <div class="mg-acoes mg-mt"><button type="button" class="mg-btn mg-sec" data-acao="restaurar-exemplo">Restaurar dados de exemplo</button>
         <button type="button" class="mg-btn mg-sec" data-acao="estudio-vazio">Começar com estúdio vazio</button></div></div>`
      : "";
    return grupo("Ferramentas", ATALHOS.map(([href, nome, desc]) => `
        <a class="mg-card mg-atalho" href="${href}"><p class="mg-forte">${nome}</p><p class="mg-sub">${desc}</p></a>`).join("")) + demo
      + grupo("Em breve", EM_BREVE.map(([nome, desc]) => `
        <div class="mg-card mg-atalho mg-desabilitado" aria-disabled="true"><p class="mg-forte">${nome} ${chip("espera", "em breve")}</p><p class="mg-sub">${desc}</p></div>`).join(""));
  },

  async admin() {
    const d = await api("/api/plataforma");
    const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok mg-mt" role="status">${esc(estado.mensagem)}</p>` : "";
    const linhas = d.estudios.map((s) => `
      <tr data-id="${esc(s.uid)}">
        <td><b>${esc(s.email || "—")}</b>${s.nome ? `<br><span class="mg-sub">${esc(s.nome)}</span>` : ""}</td>
        <td>${esc(fmtData(s.criado_em, { day: "2-digit", month: "2-digit", year: "numeric" }))}</td>
        <td>${s.voce ? chip("in", "Você") : chip(s.ativo ? "ok" : "espera", s.ativo ? "Ativo" : "Pausado")}</td>
        <td class="r">${s.voce ? "" : `<button type="button" class="mg-btn mg-sec mg-sm" data-acao="estudio-ativo" data-ativo="${!s.ativo}">${s.ativo ? "Pausar" : "Reativar"}</button>`}</td>
      </tr>`).join("");
    return `
      <section class="mg-split">
        <form class="mg-card mg-in" data-form="acesso" novalidate>
          <h2 class="mg-h2">Cadastro de novas contas</h2>
          <p class="mg-sub">Quem entra com Google pela primeira vez ganha um estúdio vazio, se o cadastro deixar. Quem já tem estúdio continua entrando.</p>
          <div class="mg-campo"><label for="p-aberto">Quem pode criar estúdio</label>
            <select class="mg-input" id="p-aberto" name="aberto">
              <option value="nao"${d.aberto ? "" : " selected"}>Só os convidados abaixo (recomendado)</option>
              <option value="sim"${d.aberto ? " selected" : ""}>Qualquer conta Google</option>
            </select></div>
          <div class="mg-campo"><label for="p-convidados">Convidados (um e-mail por linha)</label>
            <textarea class="mg-input" id="p-convidados" name="convidados" maxlength="20000" aria-describedby="e-convidados" placeholder="amiga@gmail.com">${esc(d.convidados.join("\n"))}</textarea>
            <p class="mg-erro" id="e-convidados"></p></div>
          <p class="mg-sub">Aberto para todos, qualquer pessoa gasta a cota grátis do Firebase do projeto. Abra só quando quiser divulgar.</p>
          <button type="submit" class="mg-btn mg-pri mg-mt">Salvar cadastro</button>
          <div aria-live="polite">${msg}</div>
        </form>
        <div class="mg-card mg-in" data-atraso="50">
          <h2 class="mg-h2">Estúdios</h2>
          <p class="mg-sub">${plural(d.estudios.length, "estúdio", "estúdios")}. Você vê só quem é e se está ativo; vídeos, canais e contas de cada um são privados.</p>
          <div class="mg-rolar mg-mt"><table class="mg-tabela"><thead><tr><th>Conta</th><th>Desde</th><th>Situação</th><th class="r">Ação</th></tr></thead>
            <tbody>${linhas || '<tr><td colspan="4" class="mg-sub">Nenhum estúdio ainda.</td></tr>'}</tbody></table></div>
          <p class="mg-erro" aria-live="polite"></p>
        </div>
      </section>`;
  },

  async plataformas(param) {
    const aba = ABAS_PLAT.includes(param) ? param : "publicar";
    if (aba === "contas") {
      const d = await api("/api/plataformas");
      return abasPlataformas(aba, null) + telaContas(d);
    }
    const d = await api(`/api/publicar?aba=${aba === "feitos" ? "feitos" : "pendentes"}`);
    estado.legendas = new Map();
    d.itens.forEach((v) => v.plataformas.forEach((p) => estado.legendas.set(`${v.id}:${p.id}`, p.legenda)));
    const vazio = d.itens.length
      ? ""
      : `<div class="mg-card mg-vazio mg-mt"><p class="mg-h2">${aba === "feitos" ? "Nada publicado nos últimos 14 dias" : "Nada para publicar agora"}</p>
         <p class="mg-sub">${aba === "feitos" ? "Os vídeos aparecem aqui quando saem em todas as plataformas do canal." : "Aprove vídeos na fila: eles aparecem aqui com o texto pronto para cada rede."}</p>
         ${aba === "feitos" ? "" : '<a class="mg-btn mg-sec mg-mt" href="#aprovacao">Abrir a fila</a>'}</div>`;
    return abasPlataformas(aba, d.abas) + vazio
      + `<section class="mg-g2 mg-mt" aria-label="Vídeos para publicar">${d.itens.map(cartaoPublicar).join("")}</section>`;
  },
};

/* ------------------------------------------------------------------ canais */

/** Atalhos "comece por um modelo" (usados no primeiro acesso e na tela Canais sem canais). */
function escolhaDeModelo(d) {
  const cartoes = d.modelos.map((m) => `
    <a class="mg-card mg-atalho" href="#canais/novo/${encodeURIComponent(m.id)}">
      <p class="mg-forte mg-com-ponto"><span class="mg-ponto" data-cor="${esc(m.cor)}"></span>${esc(m.nome)}</p>
      <p class="mg-sub">${esc(m.descricao)}</p>
      <p class="mg-sub">Roteiro, estilo visual e horários já prontos</p>
    </a>`).join("");
  return `${cartoes}
    <a class="mg-card mg-atalho" href="#canais/novo">
      <p class="mg-forte">Em branco</p>
      <p class="mg-sub">Você escolhe nome, cor, horários e redes do zero</p>
    </a>`;
}

function boasVindas(d) {
  return `
    <section class="mg-card mg-in">
      <h2 class="mg-h2 mg-grande">Seu estúdio está pronto</h2>
      <p class="mg-sub">Ele é só seu: canais, fila, contas e números ficam separados das outras contas da plataforma.</p>
      <ol class="mg-passos mg-mt">
        <li><b>Crie o primeiro canal.</b> Comece por um modelo abaixo ou em branco.</li>
        <li><b>Cadastre as contas</b> do canal em Plataformas › Contas e programas (só usuário e link; senha nunca entra aqui).</li>
        <li><b>Adicione um vídeo</b> em Produção, aprove na fila e publique em cada rede.</li>
      </ol>
    </section>
    <h2 class="mg-h2 mg-mt">Começar por um modelo</h2>
    <section class="mg-g3 mg-mt" aria-label="Modelos de canal">${escolhaDeModelo(d)}</section>`;
}

/** Formulário de criar (canal = null) ou editar canal. */
function formCanal(d, canal, modeloId) {
  const modelo = canal ? null : d.modelos.find((m) => m.id === modeloId) || null;
  const base = canal || modelo || { nome: "", cor: "#389E92", descricao: "", horarios: ["12:00"], plataformas: d.plataformas.map((p) => p.id), duracao: [61, 80] };
  const horarios = [0, 1, 2].map((i) => `
    <input class="mg-input" type="time" name="horarios" value="${esc(base.horarios[i] || "")}" aria-label="Horário ${i + 1}"${i ? "" : ' aria-describedby="e-horarios"'}>`).join("");
  const redes = d.plataformas.map((p) => `
    <label class="mg-check"><input type="checkbox" name="plataformas" value="${esc(p.id)}"${base.plataformas.includes(p.id) ? " checked" : ""}>
      <span class="mg-ponto" data-cor="${esc(p.cor)}"></span>${esc(p.nome)}</label>`).join("");
  const opcoesModelo = [["", "Em branco"], ...d.modelos.map((m) => [m.id, m.nome])]
    .map(([id, nome]) => `<option value="${esc(id)}"${id === (modelo ? modelo.id : "") ? " selected" : ""}>${esc(nome)}</option>`).join("");
  const [faixaMin, faixaMax] = d.duracao_faixa;
  const apagar = canal
    ? `<div class="mg-bloco">
        <p class="mg-forte">Apagar canal</p>
        <p class="mg-sub">${canal.n_videos
          ? `Este canal tem ${plural(canal.n_videos, "vídeo", "vídeos")}. Para parar de produzir, use o botão liga/desliga do canal.`
          : "O canal some do painel junto com as contas cadastradas nele. Não dá para desfazer."}</p>
        <button type="button" class="mg-btn mg-sec mg-perigo mg-mt" data-acao="apagar-canal"${canal.n_videos ? " disabled" : ""}>Apagar canal</button>
      </div>`
    : "";
  return `
    <form class="mg-card mg-in" data-form="canal" data-id="${esc(canal ? canal.id : "")}" aria-labelledby="t-canal" novalidate>
      <h2 class="mg-h2" id="t-canal">${canal ? `Editar ${esc(canal.nome)}` : "Novo canal"}</h2>
      <p class="mg-sub">${canal ? "O endereço interno do canal não muda; o resto você ajusta quando quiser." : "O canal entra ligado. Depois, cadastre as contas dele em Plataformas."}</p>
      ${canal ? "" : `<div class="mg-campo"><label for="k-modelo">Começar de</label>
        <select class="mg-input" id="k-modelo" name="modelo" data-modelo>${opcoesModelo}</select>
        <p class="mg-sub">O modelo traz instruções de roteiro, estilo visual e personagens. Trocar aqui recomeça o formulário.</p></div>`}
      <div class="mg-g2">
        <div class="mg-campo"><label for="k-nome">Nome do canal</label>
          <input class="mg-input" id="k-nome" name="nome" maxlength="40" required value="${esc(base.nome)}" aria-describedby="e-nome"><p class="mg-erro" id="e-nome"></p></div>
        <div class="mg-campo"><label for="k-cor">Cor no painel</label>
          <input class="mg-input mg-cor" id="k-cor" name="cor" type="color" value="${esc(base.cor)}" aria-describedby="e-cor"><p class="mg-erro" id="e-cor"></p></div>
      </div>
      <div class="mg-campo"><label for="k-descricao">Descrição (opcional)</label>
        <input class="mg-input" id="k-descricao" name="descricao" maxlength="160" value="${esc(base.descricao)}" placeholder="Do que o canal fala, em uma linha" aria-describedby="e-descricao"><p class="mg-erro" id="e-descricao"></p></div>
      <fieldset class="mg-campo mg-grupo">
        <legend class="mg-legend">Horários de publicação (Brasília)</legend>
        <div class="mg-g3">${horarios}</div>
        <p class="mg-sub">De 1 a 3 por dia. Aprovar um vídeo agenda no próximo horário livre.</p>
        <p class="mg-erro" id="e-horarios"></p>
      </fieldset>
      <fieldset class="mg-campo mg-grupo">
        <legend class="mg-legend">Onde publicar</legend>
        <div class="mg-checks">${redes}</div>
        <p class="mg-erro" id="e-plataformas"></p>
      </fieldset>
      <div class="mg-g2">
        <div class="mg-campo"><label for="k-dmin">Duração mínima (s)</label>
          <input class="mg-input" id="k-dmin" name="duracao_min" type="number" min="${faixaMin}" max="${faixaMax}" inputmode="numeric" value="${esc(base.duracao[0])}" aria-describedby="e-duracao_min"></div>
        <div class="mg-campo"><label for="k-dmax">Duração máxima (s)</label>
          <input class="mg-input" id="k-dmax" name="duracao_max" type="number" min="${faixaMin}" max="${faixaMax}" inputmode="numeric" value="${esc(base.duracao[1])}"></div>
      </div>
      <p class="mg-erro" id="e-duracao_min"></p>
      <p class="mg-sub">61 a 80 s rende em todas as redes: o TikTok só paga vídeos com 1 min ou mais, e o Reels pela API vai até 90 s.</p>
      <div class="mg-acoes mg-mt">
        <button type="submit" class="mg-btn mg-pri">${canal ? "Salvar canal" : "Criar canal"}</button>
        <a class="mg-btn mg-ghost" href="#canais">Cancelar</a>
      </div>
      <p class="mg-erro mg-mt" id="e-geral" aria-live="polite"></p>
      ${apagar}
    </form>`;
}

/* ------------------------------------------------------------------ plataformas */

function abasPlataformas(aba, contagens) {
  const n = Object.fromEntries((contagens || []).map((a) => [a.id, a.n]));
  const botoes = [["publicar", "Para publicar", n.pendentes], ["feitos", "Publicados", n.feitos], ["contas", "Contas e programas", null]]
    .map(([id, rotulo, qtd]) => `<button type="button" class="mg-tab" data-base="plataformas" data-aba="${id}" aria-pressed="${id === aba}">${rotulo}${qtd == null ? "" : `<span class="mg-cnt">${qtd}</span>`}</button>`)
    .join("");
  return `
    <div class="mg-card mg-in mg-barra-abas">
      <div class="mg-abas" role="group" aria-label="Plataformas">${botoes}</div>
      <p class="mg-sub">O mesmo MP4 vai para cada rede. O painel nunca pede a sua senha: os botões abrem a página oficial.</p>
    </div>`;
}

function cartaoPublicar(v, i) {
  const quando = v.horario ? `Agendado para ${fmtHorario(v.horario)}` : "Sem horário";
  const urlVideo = window.FONTE.baixar(v);
  const baixar = urlVideo
    ? `<a class="mg-btn mg-pri" href="${esc(urlVideo)}" target="_blank" rel="noopener noreferrer">Baixar vídeo</a>`
    : chip("at", "Sem link do vídeo no Drive");
  const total = v.plataformas.length;
  return `
    <article class="mg-card mg-in" data-id="${esc(v.id)}" data-atraso="${60 + i * 40}">
      <div class="mg-entre">
        <div class="mg-flex1">
          <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(v.canal.cor)}"></span>${esc(v.canal.nome)}</p>
          <h2 class="mg-titulo-video">${esc(v.titulo)}</h2>
          <p class="mg-sub">${esc(quando)} · ${fmtDur(v.duracao)} · ${v.faltam ? `falta${v.faltam === 1 ? "" : "m"} ${v.faltam} de ${total}` : "tudo publicado"}</p>
        </div>
        ${baixar}
      </div>
      <ul class="mg-pubs" aria-label="Plataformas de ${esc(v.titulo)}">${v.plataformas.map((p) => linhaPublicacao(v, p)).join("")}</ul>
    </article>`;
}

function linhaPublicacao(v, p) {
  const [classe, rotulo] = SITUACAO_PUB[p.situacao] || SITUACAO_PUB.pendente;
  const eleg = p.elegivel.status === "ok" ? chip("ok", "Duração rende") : chip(p.elegivel.status === "at" ? "at" : "espera", p.elegivel.detalhe);
  const topo = `
    <div class="mg-entre">
      <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(p.cor)}"></span>${esc(p.nome)}${p.conta.usuario ? ` <span class="mg-sub">${esc(p.conta.usuario)}</span>` : ""}</p>
      <div class="mg-legenda">${chip(classe, rotulo)}${eleg}</div>
    </div>`;
  if (p.situacao !== "pendente") {
    const quando = p.publicado_em ? ` em ${fmtHorario(p.publicado_em)}` : "";
    return `
      <li class="mg-pub" data-plat="${esc(p.id)}">${topo}
        <div class="mg-acoes">
          ${p.situacao === "publicado" ? `<p class="mg-sub mg-flex1">Publicado${esc(quando)}</p>${linkExterno(p.url, "Ver post")}` : '<p class="mg-sub mg-flex1">Você pulou esta plataforma.</p>'}
          <button type="button" class="mg-btn mg-ghost mg-sm" data-acao="desfazer-pub">Desfazer</button>
        </div>
        <p class="mg-erro" aria-live="polite"></p>
      </li>`;
  }
  const campo = `u-${esc(v.id)}-${esc(p.id)}`;
  const abrir = p.publicacao === "app"
    ? `<p class="mg-sub">Só pelo app: baixe o vídeo no celular e publique por lá.</p>`
    : linkExterno(p.subir, `Abrir ${p.nome}`);
  const copiarTitulo = p.legenda.titulo
    ? '<button type="button" class="mg-btn mg-sec mg-sm" data-acao="copiar" data-campo="titulo">Copiar título</button>'
    : "";
  const dicas = p.ao_publicar.map((d) => `<li>${esc(d)}</li>`).join("");
  return `
    <li class="mg-pub" data-plat="${esc(p.id)}">${topo}
      <div class="mg-acoes">
        ${copiarTitulo}
        <button type="button" class="mg-btn mg-sec mg-sm" data-acao="copiar" data-campo="texto">Copiar ${p.legenda.titulo ? "descrição" : "legenda"}</button>
        ${abrir}
        <button type="button" class="mg-btn mg-ghost mg-sm" data-acao="pular-pub">Pular</button>
      </div>
      <form class="mg-form-linha" data-form="publicado" novalidate>
        <div class="mg-campo"><label for="${campo}">Link do post (opcional)</label>
          <input class="mg-input" id="${campo}" name="url" type="url" inputmode="url" maxlength="300" placeholder="https://" aria-describedby="e-${campo}">
          <p class="mg-erro" id="e-${campo}"></p></div>
        <button type="submit" class="mg-btn mg-pri mg-sm">Marcar publicado</button>
      </form>
      <details class="mg-detalhes">
        <summary>Ver o texto e as dicas</summary>
        ${p.legenda.titulo ? `<p class="mg-lbl mg-mt">Título</p><textarea class="mg-input mg-texto mg-texto-curto" readonly aria-label="Título para ${esc(p.nome)}">${esc(p.legenda.titulo)}</textarea>` : ""}
        <p class="mg-lbl mg-mt">${p.legenda.titulo ? "Descrição" : "Legenda"}</p>
        <textarea class="mg-input mg-texto" readonly aria-label="Texto para ${esc(p.nome)}">${esc(p.legenda.texto)}</textarea>
        ${dicas ? `<ul class="mg-lista mg-mt">${dicas}</ul>` : ""}
      </details>
    </li>`;
}

function telaContas(d) {
  const aviso = d.revisar
    ? `<p class="mg-aviso mg-c-at mg-mt">Os dados das plataformas foram conferidos há ${d.dias} dias. As regras mudam: revise o arquivo web/dados/plataformas.json.</p>`
    : `<p class="mg-sub mg-mt">Programas e requisitos conferidos nas páginas oficiais em ${esc(fmtData(`${d.verificado_em}T12:00:00`, { day: "2-digit", month: "2-digit", year: "numeric" }))}.</p>`;
  const opcoes = (atual) => d.situacoes
    .map((s) => `<option value="${esc(s)}"${s === atual ? " selected" : ""}>${esc(SITUACAO_CONTA[s] || s)}</option>`).join("");
  const cards = d.plataformas.map((p, i) => {
    const duracao = p.duracao_min_s ? `${p.duracao_min_s} s ou mais` : p.duracao_max_s ? `até ${p.duracao_max_s} s` : "qualquer";
    const links = [
      linkExterno(p.urls.entrar, "Entrar"),
      linkExterno(p.urls.subir, "Subir vídeo"),
      linkExterno(p.urls.painel, "Painel do criador"),
      linkExterno(p.urls.programa, "Regras do programa", "mg-btn mg-ghost mg-sm"),
    ].join("");
    const contas = p.contas.length
      ? p.contas.map((c) => formConta(p, c, opcoes)).join("")
      : '<p class="mg-sub mg-bloco">Nenhum canal publica aqui. Marque esta rede em Canais › Editar canal.</p>';
    const riscos = p.riscos.map((r) => `<li>${esc(r)}</li>`).join("");
    const fontes = p.fontes.map((f) => `<li>${linkExterno(f, f.replace(/^https:\/\//, ""), "mg-link")}</li>`).join("");
    return `
      <article class="mg-card mg-in" data-atraso="${50 + i * 40}">
        <div class="mg-entre">
          <h2 class="mg-h2 mg-com-ponto"><span class="mg-ponto" data-cor="${esc(p.cor)}"></span>${esc(p.nome)}</h2>
          ${chip(p.brasil.startsWith("Sim") ? "ok" : "at", `Brasil: ${p.brasil}`)}
        </div>
        <p class="mg-forte mg-mt">${esc(p.programa)}</p>
        <p class="mg-sub">${esc(p.requisitos)}</p>
        <dl class="mg-dados">
          <div><dt>Tipo de conta</dt><dd class="mg-pequeno">${esc(p.conta || "—")}</dd></div>
          <div><dt>Duração que rende</dt><dd class="mg-pequeno">${esc(duracao)}</dd></div>
          <div><dt>Como publicar</dt><dd class="mg-pequeno">${p.publicacao === "app" ? "Só pelo app" : "Navegador (PC ou celular)"}</dd></div>
          <div><dt>Metricool</dt><dd class="mg-pequeno">${p.metricool ? "Agenda esta rede" : "Não agenda"}</dd></div>
        </dl>
        <div class="mg-acoes mg-mt">${links || '<p class="mg-sub">Sem página web: use o app.</p>'}</div>
        ${contas}
        <details class="mg-detalhes mg-mt">
          <summary>Riscos, API e fontes</summary>
          ${riscos ? `<ul class="mg-lista mg-mt">${riscos}</ul>` : ""}
          <p class="mg-sub mg-mt"><b>API:</b> ${esc(p.api || "—")}</p>
          ${fontes ? `<ul class="mg-lista mg-mt">${fontes}</ul>` : ""}
        </details>
      </article>`;
  }).join("");
  return `${aviso}<section class="mg-g2 mg-mt" aria-label="Plataformas">${cards}</section>`;
}

function formConta(p, c, opcoes) {
  const id = `${esc(p.id)}-${esc(c.canal.id)}`;
  const chaves = ["seguidores", ...p.metas.map((m) => m.chave).filter((k) => k !== "seguidores")];
  const rotulo = (k) => (p.metas.find((m) => m.chave === k) || {}).rotulo || "seguidores";
  const numeros = chaves.map((k) => `
    <div class="mg-campo"><label for="n-${id}-${esc(k)}">${esc(rotulo(k)[0].toUpperCase() + rotulo(k).slice(1))}</label>
      <input class="mg-input" id="n-${id}-${esc(k)}" data-numero="${esc(k)}" type="number" min="0" step="1" inputmode="numeric" value="${Number(c.numeros[k] || 0)}"></div>`).join("");
  const metas = c.progresso.map((m) => `
    <div class="mg-mt"><p class="mg-sub">${fmtNum(m.atual)} de ${fmtNum(m.alvo)} ${esc(m.rotulo)} (${m.pct}%)</p>${barra(m.pct, m.pct >= 100 ? "#17673F" : "#389E92")}</div>`).join("");
  return `
    <form class="mg-bloco" data-form="conta" data-canal="${esc(c.canal.id)}" data-plat="${esc(p.id)}" novalidate>
      <div class="mg-entre">
        <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(c.canal.cor)}"></span>${esc(c.canal.nome)}</p>
        ${chip(c.situacao === "monetizando" ? "ok" : c.situacao === "planejada" ? "espera" : "in", SITUACAO_CONTA[c.situacao] || c.situacao)}
      </div>
      ${metas}
      <div class="mg-campos">
        <div class="mg-campo"><label for="s-${id}">Situação</label><select class="mg-input" id="s-${id}" name="situacao">${opcoes(c.situacao)}</select></div>
        <div class="mg-campo"><label for="us-${id}">Usuário</label><input class="mg-input" id="us-${id}" name="usuario" maxlength="60" placeholder="@nome" value="${esc(c.usuario)}"></div>
        <div class="mg-campo mg-largura-2"><label for="ur-${id}">Link do perfil</label><input class="mg-input" id="ur-${id}" name="url" type="url" inputmode="url" maxlength="300" placeholder="https://" value="${esc(c.url)}"></div>
        ${numeros}
      </div>
      <label class="mg-check"><input type="checkbox" name="seguranca"${c.seguranca ? " checked" : ""}> Verificação em 2 etapas ou passkey ativa</label>
      <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-sec mg-sm">Salvar ${esc(c.canal.nome)}</button>
        <p class="mg-erro" aria-live="polite"></p></div>
    </form>`;
}

function pecaGrafico(g) {
  if (!g.series.length) {
    return '<div class="mg-card mg-in"><h2 class="mg-h2">Visualizações por dia</h2><p class="mg-sub mg-mt">As métricas aparecem aqui quando o coletor rodar.</p></div>';
  }
  const totais = g.dias.map((_, i) => g.series.reduce((soma, s) => soma + (s.valores[i] || 0), 0));
  const topo = Math.max(15000, Math.ceil(Math.max(...totais) / 15000) * 15000);
  const escala = 180 / topo;
  const grades = [1 / 3, 2 / 3, 1]
    .map((f) => `<div class="mg-grade" data-b="${Math.round(180 * f)}"></div><span class="mg-eixo" data-b="${Math.round(180 * f) - 7}">${fmtMil(Math.round(topo * f))}</span>`)
    .join("");
  const colunas = g.dias.map((dia, i) => {
    const partes = g.series.map((s) => `<i data-h="${Math.round((s.valores[i] || 0) * escala)}" data-cor="${esc(s.cor)}"></i>`).join("");
    const rotulo = `${fmtData(`${dia}T12:00:00`, { day: "2-digit", month: "2-digit" })}: ${fmtMil(totais[i])}`;
    const total = i === g.dias.length - 1 ? `<span class="mg-total">${fmtMil(totais[i])}</span>` : "";
    return `<div class="mg-coluna" title="${esc(rotulo)}">${partes}${total}</div>`;
  }).join("");
  const rotulos = g.dias.map((dia, i) => `<span>${i % 2 ? fmtData(`${dia}T12:00:00`, { day: "2-digit", month: "2-digit" }) : ""}</span>`).join("");
  const legenda = g.series.map((s) => `<span><span class="mg-ponto" data-cor="${esc(s.cor)}"></span>${esc(s.nome)}</span>`).join("");
  const resumo = `Visualizações por dia nos últimos 14 dias, de ${fmtMil(totais[0])} a ${fmtMil(totais[totais.length - 1])}`;
  return `
    <div class="mg-card mg-in" data-atraso="250">
      <div class="mg-entre"><div><h2 class="mg-h2">Visualizações por dia</h2><p class="mg-sub">Últimos 14 dias, por canal</p></div><div class="mg-legenda">${legenda}</div></div>
      <div class="mg-grafico" role="img" aria-label="${esc(resumo)}">${grades}${colunas}</div>
      <div class="mg-rotulos" aria-hidden="true">${rotulos}</div>
    </div>`;
}

function pecaPrecisa(lista) {
  const NIVEL = { cr: "cr", at: "at", in: "in" };
  const linhas = lista.length
    ? lista.map((p) => `
      <div class="mg-row"><span class="mg-st ${CLASSE[NIVEL[p.nivel]] || "mg-c-in"}">${ICONE[NIVEL[p.nivel]] || ""}</span>
        <div class="mg-flex1"><p class="mg-forte">${esc(p.titulo)}</p><p class="mg-sub">${esc(p.detalhe)}</p></div>
        <a class="mg-btn mg-sec mg-sm" href="#${esc(p.rota)}">Ver</a></div>`).join("")
    : '<p class="mg-sub mg-mt">Nada pendente agora.</p>';
  return `<div class="mg-card mg-in" data-atraso="300"><h2 class="mg-h2">Precisa de você</h2><p class="mg-sub">Do mais urgente para o menos urgente</p><div class="mg-mt">${linhas}</div></div>`;
}

function pecaLinha(etapas) {
  const caixas = etapas.map((e) => {
    const classe = e.etapa === "fila" ? "fila" : e.voce ? "voce" : "";
    const detalhe = e.etapa === "fila" ? "para aprovar" : e.voce ? "esperando você" : e.erro ? `${e.erro} com erro` : e.rodando ? `${e.rodando} rodando` : "";
    return `<div class="mg-etapa ${classe}"><b>${e.total}</b><span class="mg-forte">${NOME_ETAPA[e.etapa] || esc(e.etapa)}</span><br><small>${detalhe}</small></div>`;
  }).join("");
  return `<div class="mg-card mg-in" data-atraso="350"><h2 class="mg-h2">Linha de produção agora</h2><p class="mg-sub">Quantos vídeos estão em cada etapa</p><div class="mg-etapas">${caixas}</div><a class="mg-btn mg-sec mg-sm mg-mt" href="#producao">Ver produção e console</a></div>`;
}

function pecaGatilho(conds, titulo = "Gatilho do próximo canal") {
  const ok = conds.filter((c) => c.ok).length;
  const linhas = conds.map((c) => `
    <div class="mg-row"><span class="mg-st ${c.ok ? "mg-c-ok" : "mg-c-at"}">${c.ok ? ICONE.ok : ICONE.at}</span>
      <div class="mg-flex1"><p class="mg-forte">${esc(c.nome)}</p><p class="mg-sub">${esc(c.valor)}</p></div></div>`).join("");
  return `<div class="mg-card mg-in" data-atraso="400"><h2 class="mg-h2">${titulo}</h2><p class="mg-sub">${ok} de ${conds.length} condições valendo; precisam valer por 4 semanas seguidas</p><div class="mg-mt">${linhas}</div></div>`;
}

function cartaoVideo(v, i) {
  const testes = v.testes.map((t) => `<li class="mg-chip ${CLASSE[t.status] || "mg-c-ne"}" title="${esc(t.detalhe)}">${ICONE[t.status] || ""}${esc(t.nome)}</li>`).join("");
  const online = window.FONTE.previa(v);
  const previa = online || '<span class="mg-sem-previa">Sem link do vídeo no Drive</span>';
  const janela = v.janela && !online
    ? `<div class="mg-janela"><b>${esc(ROTULO_JANELA[v.janela.tipo] || v.janela.tipo)}</b><span>${esc(v.janela.titulo)} (${esc(v.janela.referencia)})</span></div>`
    : "";
  const falhas = v.testes.filter((t) => t.status === "cr").map((t) => `${esc(t.nome)}${t.detalhe ? `: ${esc(t.detalhe)}` : ""}`).join("; ");
  const origem = [v.serie, v.referencia].filter(Boolean).join(", ");
  return `
    <article class="mg-card mg-in" data-id="${esc(v.id)}" data-atraso="${80 + i * 50}">
      <div class="mg-video">
        <div class="mg-prev">${janela}${previa}<span class="mg-tempo">${fmtDur(v.duracao)}</span></div>
        <div class="mg-info">
          <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(v.canal.cor)}"></span>${esc(v.canal.nome)} <span class="mg-sub">${esc(origem)}</span></p>
          <h2 class="mg-titulo-video">${esc(v.titulo)}</h2>
          <ul class="mg-testes" aria-label="Testes automáticos">${testes || '<li class="mg-sub">Sem testes ainda</li>'}</ul>
          ${v.aviso ? `<p class="mg-aviso mg-c-at">${esc(v.aviso)}</p>` : ""}
          ${v.status === "reprovado" && falhas ? `<p class="mg-aviso mg-c-cr">Reprovado: ${falhas}</p>` : ""}
          <div class="mg-acoes" aria-live="polite">${acoesDo(v)}</div>
        </div>
      </div>
    </article>`;
}

function acoesDo(v) {
  if (estado.refazendo === v.id) {
    return `
      <form class="mg-form-refazer" data-form="refazer" data-id="${esc(v.id)}" novalidate>
        <div class="mg-campo"><label for="nota-${esc(v.id)}">O que mudar nesta versão?</label>
          <textarea class="mg-input" id="nota-${esc(v.id)}" name="nota" maxlength="500" placeholder="Ex.: trocar o quadro 4; narração mais lenta"></textarea></div>
        <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-pri">Enviar para refazer</button>
          <button type="button" class="mg-btn mg-ghost" data-acao="cancelar">Cancelar</button></div>
      </form>`;
  }
  const desfazer = '<button type="button" class="mg-btn mg-sec" data-acao="desfazer">Desfazer</button>';
  switch (v.status) {
    case "fila":
      return `<button type="button" class="mg-btn mg-pri" data-acao="aprovar">Aprovar e agendar</button>
        <button type="button" class="mg-btn mg-sec" data-acao="abrir-refazer">Refazer</button>
        <button type="button" class="mg-btn mg-ghost" data-acao="rejeitar">Rejeitar</button>
        <p class="mg-sub mg-largura">Se aprovar: ${esc(fmtHorario(v.horario_sugerido))}</p>`;
    case "reprovado":
      return `<button type="button" class="mg-btn mg-pri" data-acao="abrir-refazer">Refazer com a correção</button>
        <button type="button" class="mg-btn mg-ghost" data-acao="rejeitar">Rejeitar</button>`;
    case "aprovado":
      return `${chip("ok", `Agendado para ${fmtHorario(v.horario)}`)}${desfazer}`;
    case "rejeitado":
      return `${chip("espera", "Rejeitado, não será publicado")}${desfazer}`;
    case "refazer":
      return `${chip("in", "Voltou para a produção; reaparece aqui quando passar nos testes")}${desfazer}`;
    default:
      return chip("espera", (STATUS_VIDEO[v.status] || [v.status])[0]);
  }
}

function linhaProducao(v) {
  const segs = v.etapas.map((e) => {
    const titulo = `${NOME_ETAPA[e.etapa] || e.etapa}: ${STATUS_ETAPA[e.status] || e.status}${e.nota ? `. ${e.nota}` : ""}`;
    return `<li class="mg-seg ${CLASSE[e.status] || "mg-c-ne"}" title="${esc(titulo)}">${ICONE[e.status] || ""}<span>${esc(NOME_ETAPA[e.etapa] || e.etapa)}</span></li>`;
  }).join("");
  let destaque = "";
  if (v.destaque) {
    const classe = v.destaque.status === "erro" ? "mg-c-cr" : "mg-c-at";
    const botao = v.destaque.etapa === "gancho" && v.destaque.status === "voce"
      ? '<button type="button" class="mg-btn mg-sec mg-sm" data-acao="pular-gancho">Seguir sem gancho</button>'
      : "";
    destaque = `<div class="mg-acoes mg-mt"><p class="mg-aviso ${classe} mg-flex1">${esc(v.destaque.nota || STATUS_ETAPA[v.destaque.status])}</p>${botao}</div>`;
  }
  const origem = [v.serie, v.referencia].filter(Boolean).join(", ");
  return `
    <div class="mg-linha-prod" data-id="${esc(v.id)}">
      <p class="mg-com-ponto mg-forte"><span class="mg-ponto" data-cor="${esc(v.canal.cor)}"></span>${esc(v.canal.nome)} <span class="mg-sub">${esc(origem)}</span></p>
      <p class="mg-titulo-video">${esc(v.titulo)}</p>
      <ol class="mg-trilha" aria-label="Etapas de ${esc(v.titulo)}">${segs}</ol>
      ${destaque}
      <p class="mg-erro" aria-live="polite"></p>
    </div>`;
}

/* ------------------------------------------------------------------ ações */

function ocupar(botao, texto) {
  const original = botao.innerHTML;
  botao.setAttribute("aria-busy", "true");
  botao.disabled = true;
  if (texto) botao.textContent = texto;
  return () => {
    botao.removeAttribute("aria-busy");
    botao.disabled = false;
    botao.innerHTML = original;
  };
}

function mostrarErroNoCartao(id, mensagem) {
  const cartao = tela.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const alvo = cartao && (cartao.querySelector(".mg-erro") || cartao.querySelector(".mg-acoes"));
  if (alvo) {
    let p = cartao.querySelector(".mg-erro");
    if (!p) {
      p = document.createElement("p");
      p.className = "mg-erro";
      alvo.after(p);
    }
    p.textContent = mensagem;
  }
}

async function acaoVideo(botao, id, acao, nota = "") {
  const inicio = estado.inicioRevisao.get(id);
  const soltar = ocupar(botao, acao === "aprovar" ? "Agendando…" : null);
  try {
    const r = await enviar(`/api/videos/${encodeURIComponent(id)}/acao`, {
      acao,
      nota,
      revisao_s: acao === "aprovar" && inicio ? (Date.now() - inicio) / 1000 : null,
    });
    const item = estado.itensFila.get(id);
    if (item) estado.recentes.set(id, { ...item, status: r.status, horario: r.horario });
    estado.refazendo = null;
    estado.formSujo = false;
    await navegar(false);
    recarregarCabecalho();
    const proximo = tela.querySelector(`[data-id="${CSS.escape(id)}"] .mg-acoes button`);
    if (proximo) proximo.focus();
  } catch (erro) {
    soltar();
    mostrarErroNoCartao(id, erro.message);
  }
}

async function marcarPublicacao(botao, id, situacao, url = "") {
  const linha = botao.closest("[data-plat]");
  const plat = linha?.dataset.plat;
  const soltar = ocupar(botao, situacao === "publicado" ? "Salvando…" : null);
  try {
    await enviar(`/api/publicacoes/${encodeURIComponent(id)}/${encodeURIComponent(plat)}`, { situacao, url });
    estado.formSujo = false;
    await navegar(false);
    recarregarCabecalho();
    const mesma = tela.querySelector(`[data-id="${CSS.escape(id)}"] [data-plat="${CSS.escape(plat)}"] button`);
    if (mesma) mesma.focus();
  } catch (erro) {
    soltar();
    const p = linha && linha.querySelector(".mg-erro");
    if (p) p.textContent = erro.message;
  }
}

const ACOES = {
  tentar: () => navegar(),
  aprovar: (b, id) => acaoVideo(b, id, "aprovar"),
  rejeitar: (b, id) => acaoVideo(b, id, "rejeitar"),
  desfazer: (b, id) => acaoVideo(b, id, "desfazer"),
  "abrir-refazer": (_b, id) => {
    estado.refazendo = id;
    const area = tela.querySelector(`[data-id="${CSS.escape(id)}"] .mg-acoes`);
    const item = estado.itensFila.get(id);
    if (area && item) {
      area.innerHTML = acoesDo(item);
      area.querySelector("textarea").focus();
    }
  },
  cancelar: (_b, id) => {
    estado.refazendo = null;
    estado.formSujo = false;
    const area = tela.querySelector(`[data-id="${CSS.escape(id)}"] .mg-acoes`);
    const item = estado.itensFila.get(id);
    if (area && item) {
      area.innerHTML = acoesDo(item);
      const botao = area.querySelector('[data-acao="abrir-refazer"]');
      if (botao) botao.focus();
    }
  },
  "pular-gancho": async (b, id) => {
    const soltar = ocupar(b, "Seguindo…");
    try {
      await enviar(`/api/videos/${encodeURIComponent(id)}/etapas/gancho/pular`);
      await navegar(false);
    } catch (erro) {
      soltar();
      mostrarErroNoCartao(id, erro.message);
    }
  },
  copiar: async (b, id) => {
    const plat = b.closest("[data-plat]")?.dataset.plat;
    const legenda = estado.legendas.get(`${id}:${plat}`);
    const texto = legenda ? legenda[b.dataset.campo] || "" : "";
    const original = b.textContent;
    try {
      await navigator.clipboard.writeText(texto);
      b.textContent = "Copiado ✓";
    } catch {
      /* sem HTTPS a área de transferência pode ser bloqueada: mostra o texto para copiar à mão */
      const detalhes = b.closest(".mg-pub")?.querySelector("details");
      if (detalhes) {
        detalhes.open = true;
        const campo = detalhes.querySelectorAll("textarea")[b.dataset.campo === "titulo" ? 0 : detalhes.querySelectorAll("textarea").length - 1];
        if (campo) { campo.focus(); campo.select(); }
      }
      b.textContent = "Selecione e copie";
    }
    setTimeout(() => { b.textContent = original; }, 2000);
  },
  "restaurar-exemplo": async (b) => {
    const soltar = ocupar(b, "Restaurando…");
    await window.FONTE.restaurarExemplo(false);
    soltar();
    location.hash = "#inicio";
    navegar();
  },
  "estudio-vazio": async (b) => {
    const soltar = ocupar(b, "Zerando…");
    await window.FONTE.restaurarExemplo(true);
    soltar();
    location.hash = "#inicio";
    navegar();
  },
  "apagar-canal": async (b, id) => {
    // dois cliques: o primeiro só pede confirmação
    if (b.dataset.confirmar !== "sim") {
      b.dataset.confirmar = "sim";
      b.textContent = "Clique de novo para apagar";
      setTimeout(() => {
        if (b.isConnected && !b.disabled) {
          b.dataset.confirmar = "";
          b.textContent = "Apagar canal";
        }
      }, 6000);
      return;
    }
    const soltar = ocupar(b, "Apagando…");
    try {
      await enviar(`/api/canais/${encodeURIComponent(id)}/apagar`);
      estado.formSujo = false;
      estado.levar = "Canal apagado.";
      location.hash = "#canais";
      recarregarCabecalho();
    } catch (erro) {
      soltar();
      b.dataset.confirmar = "";
      tela.querySelector("#e-geral").textContent = erro.message;
    }
  },
  "estudio-ativo": async (b, id) => {
    const soltar = ocupar(b, "Salvando…");
    try {
      await enviar(`/api/plataforma/estudios/${encodeURIComponent(id)}/ativo`, { ativo: b.dataset.ativo === "true" });
      await navegar(false);
    } catch (erro) {
      soltar();
      const p = b.closest(".mg-card").querySelector(".mg-erro");
      if (p) p.textContent = erro.message;
    }
  },
  "pular-pub": (b, id) => marcarPublicacao(b, id, "pulado"),
  "desfazer-pub": (b, id) => marcarPublicacao(b, id, "pendente"),
  ligar: async (b, id) => {
    const novo = b.getAttribute("aria-checked") !== "true";
    b.disabled = true;
    try {
      await enviar(`/api/canais/${encodeURIComponent(id)}/ligado`, { ligado: novo });
      await navegar(false);
    } catch (erro) {
      b.disabled = false;
      mostrarErroNoCartao(id, erro.message);
    }
  },
};

function marcarErros(form, erros) {
  form.querySelectorAll(".mg-erro").forEach((p) => { p.textContent = ""; });
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  let primeiro = null;
  Object.entries(erros).forEach(([campo, mensagem]) => {
    const input = form.querySelector(`[name="${CSS.escape(campo)}"]`);
    const p = form.querySelector(`#e-${CSS.escape(campo)}`) || (input && document.getElementById(input.getAttribute("aria-describedby")));
    if (input) input.setAttribute("aria-invalid", "true");
    if (p) p.textContent = mensagem;
    primeiro = primeiro || input;
  });
  if (primeiro) primeiro.focus();
}

const FORMULARIOS = {
  async refazer(form) {
    const id = form.dataset.id;
    await acaoVideo(form.querySelector('[type="submit"]'), id, "refazer", form.elements.nota.value.trim());
  },
  async lote(form) {
    const dados = Object.fromEntries(new FormData(form));
    if ((dados.tema || "").trim().length < 3) {
      marcarErros(form, { tema: "Escreva o tema do vídeo (mínimo 3 letras)." });
      return;
    }
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Gerando…");
    try {
      const r = await enviar("/api/lotes", {
        canal: dados.canal, tema: dados.tema.trim(), serie: (dados.serie || "").trim(),
        referencia: (dados.referencia || "").trim(), qtd: Number(dados.qtd) || 1,
      });
      estado.formSujo = false;
      estado.mensagem = `Lote criado: ${plural(r.ids.length, "vídeo entrou", "vídeos entraram")} na linha de produção.`;
      await navegar(false);
    } catch (erro) {
      soltar();
      marcarErros(form, { tema: erro.status === 422 ? "Confira o tema e a quantidade (1 a 10)." : erro.message });
    }
  },
  async config(form) {
    const valores = Object.fromEntries(new FormData(form));
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Salvando…");
    try {
      await enviar("/api/config", valores);
      estado.formSujo = false;
      estado.mensagem = "Configurações salvas.";
      await navegar(false);
    } catch (erro) {
      soltar();
      marcarErros(form, erro.dados && erro.dados.erros ? erro.dados.erros : {});
    }
  },
  async adicionar(form) {
    const dados = Object.fromEntries(new FormData(form));
    const erros = {};
    if ((dados.titulo || "").trim().length < 3) erros.titulo = "Escreva o título (mínimo 3 letras).";
    if (dados.link && !/^https:\/\/(drive|docs)\.google\.com\//i.test(dados.link.trim())) erros.link = "Cole um link do Google Drive (https://drive.google.com/…).";
    if (Object.keys(erros).length) {
      marcarErros(form, erros);
      return;
    }
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Enviando…");
    try {
      await enviar("/api/videos", {
        canal: dados.canal, titulo: dados.titulo.trim(), link: (dados.link || "").trim(),
        duracao: Number(dados.duracao) || null, serie: (dados.serie || "").trim(), descricao: (dados.descricao || "").trim(),
      });
      estado.formSujo = false;
      estado.mensagem = "Vídeo na fila de aprovação.";
      location.hash = "#aprovacao";
    } catch (erro) {
      soltar();
      marcarErros(form, { titulo: erro.message });
    }
  },
  async publicado(form) {
    const url = form.elements.url.value.trim();
    if (url && !/^https:\/\//i.test(url)) {
      marcarErros(form, { url: "Cole o link completo do post, começando com https://" });
      return;
    }
    const id = form.closest("[data-id]").dataset.id;
    await marcarPublicacao(form.querySelector('[type="submit"]'), id, "publicado", url);
  },
  async conta(form) {
    const numeros = {};
    form.querySelectorAll("[data-numero]").forEach((el) => {
      numeros[el.dataset.numero] = Math.max(0, Math.round(Number(el.value) || 0));
    });
    const dados = {
      situacao: form.elements.situacao.value,
      usuario: form.elements.usuario.value.trim(),
      url: form.elements.url.value.trim(),
      seguranca: form.elements.seguranca.checked,
      numeros,
    };
    const erro = form.querySelector(".mg-erro");
    if (dados.url && !/^https:\/\//i.test(dados.url)) {
      erro.textContent = "O link do perfil precisa começar com https://";
      form.elements.url.focus();
      return;
    }
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Salvando…");
    try {
      await enviar(`/api/contas/${encodeURIComponent(form.dataset.canal)}/${encodeURIComponent(form.dataset.plat)}`, dados);
      estado.formSujo = false;
      await navegar(false);
    } catch (e) {
      soltar();
      erro.textContent = e.message;
    }
  },
  async canal(form) {
    const fd = new FormData(form);
    const corpo = {
      modelo: fd.get("modelo") || "",
      nome: String(fd.get("nome") || "").trim(),
      cor: fd.get("cor"),
      descricao: String(fd.get("descricao") || "").trim(),
      horarios: fd.getAll("horarios").filter(Boolean),
      plataformas: fd.getAll("plataformas"),
      duracao_min: Number(fd.get("duracao_min")),
      duracao_max: Number(fd.get("duracao_max")),
    };
    if (corpo.nome.length < 2) {
      marcarErros(form, { nome: "Escreva o nome do canal (mínimo 2 letras)." });
      return;
    }
    const slug = form.dataset.id;
    const geral = form.querySelector("#e-geral");
    geral.textContent = "";
    const soltar = ocupar(form.querySelector('[type="submit"]'), slug ? "Salvando…" : "Criando…");
    try {
      const r = await enviar(slug ? `/api/canais/${encodeURIComponent(slug)}` : "/api/canais", corpo);
      estado.formSujo = false;
      estado.levar = slug
        ? `${r.nome}: alterações salvas.`
        : `Canal ${r.nome} criado e ligado. Próximo passo: cadastre as contas dele em Plataformas › Contas e programas.`;
      location.hash = "#canais";
      recarregarCabecalho();
    } catch (erro) {
      soltar();
      const erros = erro.dados && erro.dados.erros;
      if (erros) marcarErros(form, erros);
      else geral.textContent = erro.message;
    }
  },
  async acesso(form) {
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Salvando…");
    try {
      await enviar("/api/plataforma/acesso", { aberto: form.elements.aberto.value === "sim", convidados: form.elements.convidados.value });
      estado.formSujo = false;
      estado.mensagem = "Cadastro salvo.";
      await navegar(false);
    } catch (erro) {
      soltar();
      marcarErros(form, erro.dados && erro.dados.erros ? erro.dados.erros : { convidados: erro.message });
    }
  },
  async aipro(form) {
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Salvando…");
    try {
      await enviar("/api/config", { preco_ai_pro_brl: form.elements.preco_ai_pro_brl.value });
      estado.formSujo = false;
      await navegar(false);
    } catch (erro) {
      soltar();
      marcarErros(form, erro.dados && erro.dados.erros ? erro.dados.erros : { preco_ai_pro_brl: erro.message });
    }
  },
};

/* ------------------------------------------------------------------ roteiro com IA */
/* Dois boxes: a história (esquerda) e os prompts de imagem de cada quadro (direita).
   Quando a história muda (pela IA ou digitando), os quadros são refeitos sozinhos depois de uma
   pausa; os prompts são montados pelo js/roteiro.js com a ficha fixa de cada personagem. */

const ESPERA_DIGITACAO_MS = 4000;

function abasProducao(aba) {
  const botoes = [["linha", "Linha de produção", "#producao"], ["roteiro", "Roteiro com IA", "#producao/roteiro"]]
    .map(([id, rotulo, href]) => `<a class="mg-tab" href="${href}"${id === aba ? ' aria-current="page"' : ""}>${rotulo}</a>`)
    .join("");
  return `<nav class="mg-card mg-in mg-barra-abas" aria-label="Produção"><div class="mg-abas">${botoes}</div>
    <p class="mg-sub">${aba === "roteiro" ? "A IA escreve a história e os prompts de imagem; a bíblia da série mantém os personagens iguais do capítulo 1 ao 50." : "Adicione vídeos prontos e acompanhe a produção."}</p></nav>`;
}

const rotaRoteiro = (serie, n) => `#producao/roteiro/${encodeURIComponent(serie)}${n ? `/${n}` : ""}`;

async function telaRoteiro(param) {
  const [, serieP = "", capP = ""] = param.split("/");
  const consulta = new URLSearchParams();
  if (serieP && serieP !== "nova") consulta.set("serie", serieP);
  if (capP) consulta.set("cap", capP);
  const d = await api(`/api/roteiro?${consulta}`);
  estado.roteiro.dados = d;
  if (serieP === "nova" || !d.serie) return formNovaSerie(d, serieP === "nova");
  const s = d.serie;
  const cap = d.cap;
  const opcoesSerie = d.series.map((x) => `<option value="${esc(x.id)}"${x.id === s.id ? " selected" : ""}>${esc(x.nome)} (${x.capitulos}/${x.meta})</option>`).join("");
  const feitos = new Set(d.capitulos.filter((c) => c.pronto).map((c) => c.n));
  const opcoesCap = Array.from({ length: s.meta }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === cap.n ? " selected" : ""}>${feitos.has(n) ? "✓ " : ""}Capítulo ${n}${(d.capitulos.find((c) => c.n === n) || {}).titulo ? `: ${esc(d.capitulos.find((c) => c.n === n).titulo)}` : ""}</option>`).join("");
  const anterior = cap.n > 1 ? `<a class="mg-btn mg-sec mg-sm" href="${rotaRoteiro(s.id, cap.n - 1)}" aria-label="Capítulo anterior">‹</a>` : "";
  const proximo = cap.n < s.meta ? `<a class="mg-btn mg-sec mg-sm" href="${rotaRoteiro(s.id, cap.n + 1)}" aria-label="Próximo capítulo">›</a>` : "";
  const semIa = d.ia ? "" : '<p class="mg-aviso mg-c-at mg-mt">IA desligada: falta a chave do reCAPTCHA em web/config.js. Dá para escrever e salvar à mão.</p>';
  const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok" role="status">${esc(estado.mensagem)}</p>` : "";
  return `
    <section class="mg-card mg-in mg-mt mg-roteiro-topo">
      <div class="mg-campo"><label for="r-serie">Série</label>
        <select class="mg-input" id="r-serie" data-roteiro-serie>${opcoesSerie}</select></div>
      <div class="mg-campo"><label for="r-cap">Capítulo</label>
        <div class="mg-linha">${anterior}<select class="mg-input" id="r-cap" data-roteiro-cap>${opcoesCap}</select>${proximo}</div></div>
      <a class="mg-btn mg-sec" href="#producao/roteiro/nova">Nova série</a>
      <p class="mg-sub mg-largura">${esc(s.canal.nome)} · ${feitos.size} de ${s.meta} capítulos escritos · ${d.formato.palavras[0]}–${d.formato.palavras[1]} palavras (${d.formato.duracao[0]}–${d.formato.duracao[1]} s)</p>
      <div class="mg-largura" id="r-status" aria-live="polite">${msg}</div>
      ${semIa}
    </section>
    <section class="mg-roteiro mg-mt">
      ${boxHistoria(d)}
      <div class="mg-card mg-in" data-quadros data-atraso="50">${painelQuadros(d)}</div>
    </section>
    ${boxBiblia(d)}
    ${boxArco(d)}
    <section class="mg-card mg-mt mg-in mg-entre">
      <div><h2 class="mg-h2">Já fez as imagens e montou o vídeo?</h2>
        <p class="mg-sub">Mande o vídeo deste capítulo para a fila com título, série e descrição preenchidos.</p></div>
      <button type="button" class="mg-btn mg-pri" data-acao="capitulo-para-fila"${cap.historia ? "" : " disabled"}>Adicionar vídeo pronto</button>
    </section>
    <p class="mg-sub mg-mt mg-recaptcha">Protegido pelo reCAPTCHA do Google: valem a
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Política de Privacidade</a> e os
      <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">Termos de Serviço</a>.</p>`;
}

function formNovaSerie(d, pedida) {
  if (!d.canais.length) {
    return `<div class="mg-card mg-vazio mg-mt"><p class="mg-h2">Crie um canal primeiro</p>
      <p class="mg-sub">A série usa o estilo visual e os personagens do canal.</p><a class="mg-btn mg-pri mg-mt" href="#canais/novo">Criar canal</a></div>`;
  }
  const canais = d.canais.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  return `
    <form class="mg-card mg-in mg-mt" data-form="serie" novalidate>
      <h2 class="mg-h2">${pedida && d.series.length ? "Nova série" : "Comece uma série"}</h2>
      <p class="mg-sub">A série guarda a bíblia (personagens, roupas, lugares, estilo) e o plano dos capítulos. Ela começa com os personagens do canal.</p>
      <div class="mg-g2">
        <div class="mg-campo"><label for="s-nome">Nome da série</label>
          <input class="mg-input" id="s-nome" name="nome" maxlength="60" required placeholder="Ex.: Temporada Davi" aria-describedby="e-nome"><p class="mg-erro" id="e-nome"></p></div>
        <div class="mg-campo"><label for="s-canal">Canal</label><select class="mg-input" id="s-canal" name="canal" aria-describedby="e-canal">${canais}</select><p class="mg-erro" id="e-canal"></p></div>
      </div>
      <div class="mg-campo"><label for="s-premissa">Premissa: do que é a série, do começo ao fim</label>
        <textarea class="mg-input" id="s-premissa" name="premissa" maxlength="2000" placeholder="Ex.: a vida de Davi, de pastor em Belém a rei de Israel, fiel a 1 e 2 Samuel."></textarea></div>
      <div class="mg-campo"><label for="s-meta">Quantos capítulos</label>
        <input class="mg-input mg-curto" id="s-meta" name="meta" type="number" min="1" max="200" value="50" inputmode="numeric" aria-describedby="e-meta"><p class="mg-erro" id="e-meta"></p></div>
      <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-pri">Criar série</button>
        ${d.series.length ? `<a class="mg-btn mg-ghost" href="#producao/roteiro">Cancelar</a>` : ""}</div>
      <p class="mg-erro mg-mt" id="e-geral" aria-live="polite"></p>
    </form>`;
}

function contagem(palavras, f) {
  const s = Math.round(palavras / 2.5);
  const ok = palavras >= f.palavras[0] && palavras <= f.palavras[1];
  return `${chip(palavras ? (ok ? "ok" : "at") : "espera", `${palavras} palavras · cerca de ${s} s`)} <span class="mg-sub">meta: ${f.palavras[0]} a ${f.palavras[1]}</span>`;
}

function boxHistoria(d) {
  const { cap, serie: s } = d;
  const batida = cap.batida
    ? `<p class="mg-sub">Plano do arco: <b>${esc(cap.batida.titulo)}</b>${cap.batida.resumo ? `. ${esc(cap.batida.resumo)}` : ""}</p>`
    : '<p class="mg-sub">Sem plano para este capítulo: planeje o arco lá embaixo ou dê uma direção.</p>';
  const sugestoes = estado.roteiro.sugestoes.length
    ? `<div class="mg-bloco"><p class="mg-forte">A IA usou alguém ou algum lugar fora da bíblia</p>${estado.roteiro.sugestoes.map((x, i) => `
        <div class="mg-row"><div class="mg-flex1"><p class="mg-forte">${esc(x.nome)} <span class="mg-sub">(${x.tipo === "cenario" ? "cenário" : "personagem"})</span></p>
          <p class="mg-sub">${esc(x.aparencia || x.descricao || "")}${x.roupas ? `; ${esc(x.roupas)}` : ""}</p></div>
          <button type="button" class="mg-btn mg-sec mg-sm" data-acao="aceitar-sugestao" data-i="${i}">Pôr na bíblia</button></div>`).join("")}</div>`
    : "";
  return `
    <form class="mg-card mg-in" data-form="historia" novalidate>
      <h2 class="mg-h2">História · capítulo ${cap.n} de ${s.meta}</h2>
      ${batida}
      <div class="mg-campo"><label for="h-ideia">Direção para a IA (opcional)</label>
        <input class="mg-input" id="h-ideia" name="ideia" maxlength="600" value="${esc(cap.ideia)}" placeholder="Ex.: mais tensão; terminar com Golias rindo do exército"></div>
      <div class="mg-acoes mg-mt"><button type="button" class="mg-btn mg-pri" data-acao="escrever-ia"${d.ia ? "" : " disabled"}>${cap.historia ? "Reescrever com IA" : "Escrever com IA"}</button>
        <span class="mg-sub">A IA lê a bíblia, o plano e tudo o que já aconteceu.</span></div>
      <div class="mg-campo"><label for="h-titulo">Título do capítulo</label>
        <input class="mg-input" id="h-titulo" name="titulo" maxlength="80" value="${esc(cap.titulo)}"></div>
      <div class="mg-campo"><label for="h-historia">Narração</label>
        <textarea class="mg-input mg-historia" id="h-historia" name="historia" maxlength="5000" data-historia aria-describedby="h-contagem">${esc(cap.historia)}</textarea>
        <p id="h-contagem" data-contagem>${contagem(cap.palavras, d.formato)}</p></div>
      <div class="mg-campo"><label for="h-resumo">Resumo (2 frases; a IA usa para lembrar o que aconteceu)</label>
        <textarea class="mg-input" id="h-resumo" name="resumo" maxlength="600">${esc(cap.resumo)}</textarea></div>
      <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-sec">Salvar capítulo</button></div>
      <p class="mg-erro mg-mt" id="h-erro" aria-live="polite"></p>
      ${sugestoes}
    </form>`;
}

function painelQuadros(d) {
  const { cap } = d;
  let situacao;
  if (estado.roteiro.ocupado === "quadros") situacao = chip("rodando", "Atualizando os prompts com a história…");
  else if (!cap.historia) situacao = chip("espera", "Escreva a história: os prompts aparecem aqui");
  else if (cap.sem_quadros) situacao = chip("at", "Ainda sem quadros para esta história");
  else if (cap.desatualizado) situacao = chip("at", "A história mudou: os prompts vão ser refeitos");
  else situacao = chip("ok", "Em dia com a história");
  const refazer = cap.historia && d.ia && estado.roteiro.ocupado !== "quadros"
    ? `<button type="button" class="mg-btn mg-sec mg-sm" data-acao="atualizar-quadros">${cap.sem_quadros ? "Criar prompts" : "Refazer prompts"}</button>`
    : "";
  const pendentes = d.serie.fichas_pendentes
    ? `<p class="mg-aviso mg-c-at mg-mt">${plural(d.serie.fichas_pendentes, "ficha da bíblia ainda está", "fichas da bíblia ainda estão")} sem a versão em inglês: salve a bíblia para atualizar.</p>`
    : "";
  const quadros = cap.quadros.map((q, i) => {
    const chips = [
      ...q.personagens.map((p) => chip("in", p)),
      q.cenario ? chip("espera", q.cenario) : "",
      ...q.referencias.map((r) => `<span class="mg-chip mg-c-ne" title="Anexe esta imagem de referência no gerador">Anexe: ${esc(r.split("/").pop())}</span>`),
    ].join("");
    return `
      <li class="mg-quadro">
        <div class="mg-entre"><p class="mg-forte">Quadro ${q.n}</p>
          <button type="button" class="mg-btn mg-sec mg-sm" data-acao="copiar-prompt" data-i="${i}">Copiar prompt</button></div>
        <p class="mg-sub mg-trecho">“${esc(q.trecho)}”</p>
        <div class="mg-legenda">${chips}</div>
        <pre class="mg-prompt">${esc(q.prompt)}</pre>
      </li>`;
  }).join("");
  return `
    <div class="mg-entre"><h2 class="mg-h2">Prompts dos quadros</h2>
      ${cap.quadros.length ? '<button type="button" class="mg-btn mg-sec mg-sm" data-acao="copiar-todos">Copiar todos</button>' : ""}</div>
    <p class="mg-sub">Um prompt de imagem por quadro. Aparência e roupa vêm da bíblia, iguais em todos os capítulos.</p>
    <div class="mg-acoes mg-mt">${situacao}${refazer}</div>
    ${pendentes}
    <ol class="mg-quadros mg-mt">${quadros}</ol>`;
}

function linhaItem(tipo, item, i) {
  const pers = tipo === "personagens";
  const campos = pers
    ? [["nome", "Nome", 60], ["aparencia", "Aparência (rosto, cabelo, corpo, idade)", 400], ["roupas", "Roupas e acessórios fixos", 400], ["personalidade", "Personalidade", 400]]
    : [["nome", "Nome do lugar", 60], ["descricao", "Como é o lugar", 400]];
  const id = `${tipo}-${i}`;
  const ficha = item.ficha_en
    ? `<p class="mg-sub mg-largura">${item.ficha_ok ? "No prompt" : "No prompt (vai ser atualizado ao salvar)"}: <i>${esc(item.ficha_en)}</i></p>`
    : '<p class="mg-sub mg-largura">A ficha em inglês para o prompt é criada ao salvar.</p>';
  return `
    <fieldset class="mg-item" data-item="${tipo}" data-id="${esc(item.id || "")}" data-ficha="${esc(item.ficha || "")}">
      <legend class="mg-oculto">${pers ? "Personagem" : "Cenário"} ${i + 1}</legend>
      ${campos.map(([nome, rotulo, max]) => `<div class="mg-campo"><label for="${id}-${nome}">${rotulo}</label>
        <input class="mg-input" id="${id}-${nome}" data-campo="${nome}" maxlength="${max}" value="${esc(item[nome] || "")}"></div>`).join("")}
      ${ficha}
      <button type="button" class="mg-btn mg-ghost mg-sm" data-acao="remover-item">Remover</button>
    </fieldset>`;
}

function boxBiblia(d) {
  const s = d.serie;
  return `
    <details class="mg-card mg-mt mg-in mg-detalhes"${s.fichas_pendentes ? " open" : ""}>
      <summary class="mg-h2">Bíblia da série</summary>
      <p class="mg-sub">É a memória fixa da série: mudou aqui, todos os prompts mudam junto. Escreva em português; a ficha em inglês para o gerador de imagem é feita ao salvar.</p>
      <form data-form="biblia" novalidate>
        <h3 class="mg-h3 mg-mt">Personagens</h3>
        <div class="mg-itens" data-lista="personagens">${s.personagens.map((p, i) => linhaItem("personagens", p, i)).join("")}</div>
        <button type="button" class="mg-btn mg-sec mg-sm mg-mt" data-acao="novo-item" data-tipo="personagens">+ Personagem</button>
        <h3 class="mg-h3 mg-mt">Cenários</h3>
        <div class="mg-itens" data-lista="cenarios">${s.cenarios.map((c, i) => linhaItem("cenarios", c, i)).join("")}</div>
        <button type="button" class="mg-btn mg-sec mg-sm mg-mt" data-acao="novo-item" data-tipo="cenarios">+ Cenário</button>
        <h3 class="mg-h3 mg-mt">Estilo e regras</h3>
        <div class="mg-campo"><label for="b-estilo">Estilo da imagem (em inglês, vai no começo de todo prompt)</label>
          <textarea class="mg-input" id="b-estilo" name="estilo" maxlength="600" aria-describedby="e-estilo">${esc(s.estilo)}</textarea><p class="mg-erro" id="e-estilo"></p></div>
        <div class="mg-campo"><label for="b-evitar">O que evitar nas imagens</label>
          <input class="mg-input" id="b-evitar" name="evitar" maxlength="400" value="${esc(s.evitar)}"></div>
        <div class="mg-campo"><label for="b-premissa">Premissa</label>
          <textarea class="mg-input" id="b-premissa" name="premissa" maxlength="2000">${esc(s.premissa)}</textarea></div>
        <div class="mg-campo"><label for="b-regras">Regras da série (a IA segue em todo capítulo)</label>
          <textarea class="mg-input" id="b-regras" name="regras" maxlength="3000">${esc(s.regras)}</textarea></div>
        <div class="mg-campo"><label for="b-meta">Quantos capítulos</label>
          <input class="mg-input mg-curto" id="b-meta" name="meta" type="number" min="1" max="200" value="${s.meta}" aria-describedby="e-meta"><p class="mg-erro" id="e-meta"></p></div>
        <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-pri">Salvar bíblia</button></div>
        <p class="mg-erro mg-mt" id="b-erro" aria-live="polite"></p>
      </form>
    </details>`;
}

function boxArco(d) {
  const s = d.serie;
  const linhas = s.arco.map((a) => `${a.n} | ${a.titulo} | ${a.resumo}`).join("\n");
  return `
    <details class="mg-card mg-mt mg-in mg-detalhes">
      <summary class="mg-h2">Arco da série · ${s.arco.length} de ${s.meta} capítulos planejados</summary>
      <p class="mg-sub">O plano que impede a história de se perder: cada capítulo novo segue a sua linha. Os capítulos já escritos são mantidos ao replanejar.</p>
      <div class="mg-acoes mg-mt"><button type="button" class="mg-btn mg-sec" data-acao="planejar-arco"${d.ia ? "" : " disabled"}>${s.arco.length ? "Replanejar com IA" : `Planejar os ${s.meta} capítulos com IA`}</button></div>
      <form data-form="arco" class="mg-mt" novalidate>
        <div class="mg-campo"><label for="a-arco">Um capítulo por linha: número | título | resumo</label>
          <textarea class="mg-input mg-arco" id="a-arco" name="arco" placeholder="1 | O caçula ungido | Samuel unge Davi diante dos irmãos.">${esc(linhas)}</textarea></div>
        <div class="mg-acoes mg-mt"><button type="submit" class="mg-btn mg-sec">Salvar arco</button></div>
        <p class="mg-erro mg-mt" id="a-erro" aria-live="polite"></p>
      </form>
    </details>`;
}

/* ---------- ações do roteiro */

function statusRoteiro(texto, tipo = "rodando") {
  const alvo = document.getElementById("r-status");
  if (alvo) alvo.innerHTML = texto ? chip(tipo, texto) : "";
}
function erroRoteiro(erro) {
  statusRoteiro("", "");
  const alvo = document.getElementById("r-status");
  if (alvo) alvo.innerHTML = `<p class="mg-aviso mg-c-cr">${esc(erro.message)}</p>`;
}
const serieAtual = () => estado.roteiro.dados && estado.roteiro.dados.serie;
const capAtual = () => estado.roteiro.dados && estado.roteiro.dados.cap;

async function pedidoIA(tipo, extra = {}) {
  const q = new URLSearchParams({ tipo, serie: serieAtual().id, ...extra });
  return api(`/api/roteiro/pedido?${q}`);
}

/** Redesenha só o box dos prompts (a história, que pode estar sendo digitada, fica intacta). */
async function redesenharQuadros() {
  const s = serieAtual();
  const c = capAtual();
  const d = await api(`/api/roteiro?serie=${encodeURIComponent(s.id)}&cap=${c.n}`);
  estado.roteiro.dados = d;
  const caixa = tela.querySelector("[data-quadros]");
  if (caixa) {
    caixa.innerHTML = painelQuadros(d);
    aplicarEstilos(caixa);
  }
}

/** Traduz para o inglês as fichas da bíblia que mudaram (uma chamada para todas). */
async function atualizarFichas() {
  const s = serieAtual();
  if (!s.fichas_pendentes || !estado.roteiro.dados.ia) return;
  statusRoteiro("Atualizando as fichas em inglês da bíblia…");
  const p = await pedidoIA("fichas");
  const r = await window.IA.gerar("fichas", p.texto, p);
  const fichas = {};
  (r.fichas || []).forEach((f) => { if (f && f.id) fichas[f.id] = f.ficha_en; });
  await enviar(`/api/series/${encodeURIComponent(s.id)}`, { fichas, ...(r.evitar_en ? { evitar_en: r.evitar_en } : {}) });
}

/** Salva a história e refaz os quadros a partir dela. */
async function atualizarQuadros(historia) {
  const s = serieAtual();
  const c = capAtual();
  if (!historia.trim() || !estado.roteiro.dados.ia) return;
  estado.roteiro.ocupado = "quadros";
  await redesenharQuadros();
  try {
    await atualizarFichas();
    statusRoteiro("Dividindo a história em quadros…");
    const p = await pedidoIA("quadros", { historia });
    const r = await window.IA.gerar("quadros", p.texto, p);
    await enviar(`/api/capitulos/${encodeURIComponent(s.id)}/${c.n}`, { quadros: r.quadros || [], para: historia });
    statusRoteiro("Prompts em dia com a história.", "ok");
  } finally {
    estado.roteiro.ocupado = null;
    await redesenharQuadros();
  }
}

function lerHistoria(form) {
  return {
    titulo: form.elements.titulo.value.trim(),
    historia: form.elements.historia.value.trim(),
    resumo: form.elements.resumo.value.trim(),
    ideia: form.elements.ideia.value.trim(),
  };
}

async function salvarHistoria(form) {
  const s = serieAtual();
  const c = capAtual();
  const dados = lerHistoria(form);
  await enviar(`/api/capitulos/${encodeURIComponent(s.id)}/${c.n}`, dados);
  estado.formSujo = false;
  return dados;
}

/* o capítulo mudou na mão: depois de uma pausa na digitação, salva; se foi a história, refaz os prompts */
function agendarQuadros(mudouHistoria) {
  cancelarAgendamento();
  const caixa = tela.querySelector("[data-quadros] .mg-acoes");
  if (mudouHistoria && caixa && caixa.firstElementChild && capAtual() && capAtual().quadros.length) {
    caixa.firstElementChild.outerHTML = chip("at", "A história mudou: os prompts vão ser refeitos");
  }
  estado.roteiro.timer = setTimeout(async () => {
    estado.roteiro.timer = null;
    const form = tela.querySelector('form[data-form="historia"]');
    if (!form) return;
    if (estado.roteiro.ocupado) {
      agendarQuadros(false); // a IA está trabalhando: tenta de novo daqui a pouco
      return;
    }
    try {
      const antes = capAtual();
      const dados = await salvarHistoria(form);
      if (dados.historia && (dados.historia !== antes.historia || antes.desatualizado || antes.sem_quadros)) await atualizarQuadros(dados.historia);
      else {
        statusRoteiro("Salvo.", "ok");
        await redesenharQuadros();
      }
    } catch (erro) {
      erroRoteiro(erro);
    }
  }, ESPERA_DIGITACAO_MS);
}

function cancelarAgendamento() {
  clearTimeout(estado.roteiro.timer);
  estado.roteiro.timer = null;
}

/** Antes de sair do capítulo: o que foi digitado e ainda não foi salvo é salvo agora. */
async function salvarPendenteRoteiro() {
  if (!estado.roteiro.timer) return;
  cancelarAgendamento();
  const form = tela.querySelector('form[data-form="historia"]');
  if (form && capAtual()) {
    try {
      await salvarHistoria(form);
    } catch {
      /* sem conexão: o texto continua na tela anterior do navegador */
    }
  }
}

async function comOcupado(botao, texto, tarefa) {
  if (estado.roteiro.ocupado) return;
  estado.roteiro.ocupado = "ia";
  const soltar = ocupar(botao, texto);
  try {
    await tarefa();
  } catch (erro) {
    erroRoteiro(erro);
  } finally {
    estado.roteiro.ocupado = null;
    if (botao.isConnected) soltar();
  }
}

function itensDaBiblia(form, tipo) {
  return [...form.querySelectorAll(`[data-item="${tipo}"]`)].map((fs) => {
    const item = { id: fs.dataset.id || undefined, ficha: fs.dataset.ficha || undefined };
    fs.querySelectorAll("[data-campo]").forEach((el) => { item[el.dataset.campo] = el.value.trim(); });
    return item;
  }).filter((x) => x.nome);
}

Object.assign(ACOES, {
  "escrever-ia": (b) => {
    if (capAtual().historia && b.dataset.confirmar !== "sim") {
      b.dataset.confirmar = "sim";
      b.textContent = "Clique de novo: a história atual será substituída";
      setTimeout(() => {
        if (b.isConnected && !b.disabled) {
          b.dataset.confirmar = "";
          b.textContent = "Reescrever com IA";
        }
      }, 6000);
      return undefined;
    }
    return escreverComIA(b);
  },
});

const escreverComIA = (b) => comOcupado(b, "Escrevendo…", async () => {
    cancelarAgendamento();
    const s = serieAtual();
    const c = capAtual();
    const form = b.closest("form");
    const ideia = form.elements.ideia.value.trim();
    statusRoteiro(`Escrevendo o capítulo ${c.n}…`);
    await atualizarFichas();
    const p = await pedidoIA("historia", { cap: String(c.n), ideia });
    const r = await window.IA.gerar("historia", p.texto, p);
    const nomes = new Set([...s.personagens, ...s.cenarios].map((x) => x.nome.toLowerCase()));
    estado.roteiro.sugestoes = [
      ...(r.novos_personagens || []).map((x) => ({ ...x, tipo: "personagem" })),
      ...(r.novos_cenarios || []).map((x) => ({ ...x, tipo: "cenario" })),
    ].filter((x) => x.nome && !nomes.has(String(x.nome).toLowerCase())).slice(0, 6);
    await enviar(`/api/capitulos/${encodeURIComponent(s.id)}/${c.n}`, { titulo: r.titulo || "", historia: r.historia || "", resumo: r.resumo || "", ideia });
    estado.formSujo = false;
    await navegar(false);
    estado.roteiro.ocupado = null;
    await atualizarQuadros(r.historia || "");
  });

Object.assign(ACOES, {
  "atualizar-quadros": (b) => comOcupado(b, "Refazendo…", async () => {
    cancelarAgendamento();
    const form = tela.querySelector('form[data-form="historia"]');
    const { historia } = await salvarHistoria(form);
    estado.roteiro.ocupado = null;
    await atualizarQuadros(historia);
  }),
  "copiar-prompt": async (b) => {
    const q = capAtual().quadros[Number(b.dataset.i)];
    await copiarTexto(b, q ? q.prompt : "");
  },
  "copiar-todos": async (b) => {
    await copiarTexto(b, capAtual().quadros.map((q) => `Quadro ${q.n}\n${q.prompt}`).join("\n\n"));
  },
  "aceitar-sugestao": (b) => comOcupado(b, "Adicionando…", async () => {
    const x = estado.roteiro.sugestoes[Number(b.dataset.i)];
    if (!x) return;
    await enviar(`/api/series/${encodeURIComponent(serieAtual().id)}/itens`, x.tipo === "cenario"
      ? { tipo: "cenario", nome: x.nome, descricao: x.descricao || "" }
      : { nome: x.nome, aparencia: x.aparencia || "", roupas: x.roupas || "", personalidade: x.personalidade || "" });
    estado.roteiro.sugestoes = estado.roteiro.sugestoes.filter((y) => y !== x);
    estado.roteiro.ocupado = null;
    await navegar(false);
    statusRoteiro(`${x.nome} entrou na bíblia. Refaça os prompts para incluí-lo nos quadros.`, "ok");
  }),
  "novo-item": (b) => {
    const tipo = b.dataset.tipo;
    const lista = b.closest("form").querySelector(`[data-lista="${tipo}"]`);
    lista.insertAdjacentHTML("beforeend", linhaItem(tipo, {}, lista.children.length + Date.now() % 1000));
    lista.lastElementChild.querySelector("input").focus();
    estado.formSujo = true;
  },
  "remover-item": (b) => {
    b.closest("fieldset").remove();
    estado.formSujo = true;
  },
  "planejar-arco": (b) => comOcupado(b, "Planejando…", async () => {
    statusRoteiro(`Planejando os ${serieAtual().meta} capítulos…`);
    const p = await pedidoIA("arco");
    const r = await window.IA.gerar("arco", p.texto, p);
    await enviar(`/api/series/${encodeURIComponent(serieAtual().id)}`, { arco: r.arco || [] });
    estado.mensagem = "Arco planejado. Cada capítulo novo segue a sua linha do plano.";
    estado.roteiro.ocupado = null;
    await navegar(false);
  }),
  "capitulo-para-fila": () => {
    const s = serieAtual();
    const c = capAtual();
    estado.prefill = { canal: s.canal.id, titulo: `${c.titulo || `Capítulo ${c.n}`}`.slice(0, 120), serie: s.nome, descricao: c.resumo || "" };
    location.hash = "#producao";
  },
});

async function copiarTexto(b, textoCopiado) {
  const original = b.textContent;
  try {
    await navigator.clipboard.writeText(textoCopiado);
    b.textContent = "Copiado ✓";
  } catch {
    const pre = b.closest("li")?.querySelector("pre");
    if (pre) window.getSelection().selectAllChildren(pre);
    b.textContent = "Selecione e copie";
  }
  setTimeout(() => { if (b.isConnected) b.textContent = original; }, 2000);
}

Object.assign(FORMULARIOS, {
  async serie(form) {
    const dados = Object.fromEntries(new FormData(form));
    if ((dados.nome || "").trim().length < 2) {
      marcarErros(form, { nome: "Escreva o nome da série (mínimo 2 letras)." });
      return;
    }
    const soltar = ocupar(form.querySelector('[type="submit"]'), "Criando…");
    try {
      const r = await enviar("/api/series", { nome: dados.nome.trim(), canal: dados.canal, premissa: (dados.premissa || "").trim(), meta: Number(dados.meta) || 50 });
      estado.formSujo = false;
      estado.levar = `Série ${r.nome} criada com os personagens do canal. Confira a bíblia e planeje o arco.`;
      location.hash = rotaRoteiro(r.id);
    } catch (erro) {
      soltar();
      if (erro.dados && erro.dados.erros) marcarErros(form, erro.dados.erros);
      else form.querySelector("#e-geral").textContent = erro.message;
    }
  },
  async historia(form) {
    cancelarAgendamento();
    const botao = form.querySelector('[type="submit"]');
    await comOcupado(botao, "Salvando…", async () => {
      const { historia } = await salvarHistoria(form);
      statusRoteiro("Capítulo salvo.", "ok");
      const c = capAtual();
      estado.roteiro.ocupado = null;
      if (historia && (c.sem_quadros || window.Roteiro.hashTexto(historia) !== window.Roteiro.hashTexto(c.historia) || c.desatualizado)) await atualizarQuadros(historia);
      else await redesenharQuadros();
    });
  },
  async biblia(form) {
    const botao = form.querySelector('[type="submit"]');
    form.querySelector("#b-erro").textContent = "";
    await comOcupado(botao, "Salvando…", async () => {
      const corpo = {
        personagens: itensDaBiblia(form, "personagens"),
        cenarios: itensDaBiblia(form, "cenarios"),
        estilo: form.elements.estilo.value.trim(), evitar: form.elements.evitar.value.trim(),
        premissa: form.elements.premissa.value.trim(), regras: form.elements.regras.value.trim(),
        meta: Number(form.elements.meta.value),
      };
      try {
        await enviar(`/api/series/${encodeURIComponent(serieAtual().id)}`, corpo);
      } catch (erro) {
        if (erro.dados && erro.dados.erros) marcarErros(form, erro.dados.erros);
        throw erro;
      }
      estado.formSujo = false;
      await redesenharQuadros();
      await atualizarFichas();
      estado.mensagem = "Bíblia salva. Os prompts de todos os capítulos já usam a versão nova.";
      estado.roteiro.ocupado = null;
      await navegar(false);
    });
  },
  async arco(form) {
    const linhas = form.elements.arco.value.split("\n").map((l) => l.trim()).filter(Boolean);
    const arco = linhas.map((l) => {
      const [n, titulo = "", ...resto] = l.split("|").map((x) => x.trim());
      return { n: Number(n), titulo, resumo: resto.join(" | ") };
    });
    const ruim = arco.find((a) => !Number.isInteger(a.n) || a.n < 1);
    if (ruim) {
      form.querySelector("#a-erro").textContent = "Cada linha começa com o número do capítulo: 1 | Título | resumo";
      return;
    }
    await comOcupado(form.querySelector('[type="submit"]'), "Salvando…", async () => {
      await enviar(`/api/series/${encodeURIComponent(serieAtual().id)}`, { arco });
      estado.formSujo = false;
      estado.mensagem = "Arco salvo.";
      estado.roteiro.ocupado = null;
      await navegar(false);
    });
  },
});

/* ------------------------------------------------------------------ eventos */

tela.addEventListener("click", (ev) => {
  const alvo = ev.target.closest("[data-acao], [data-aba]");
  if (!alvo || !tela.contains(alvo)) return;
  if (alvo.dataset.aba) {
    location.hash = `#${alvo.dataset.base || "aprovacao"}/${alvo.dataset.aba}`;
    return;
  }
  const tratador = ACOES[alvo.dataset.acao];
  if (!tratador) return;
  ev.preventDefault();
  const id = alvo.closest("[data-id]")?.dataset.id;
  tratador(alvo, id);
});

tela.addEventListener("submit", (ev) => {
  const form = ev.target.closest("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const tratador = FORMULARIOS[form.dataset.form];
  if (tratador) tratador(form);
});

/* "Começar de" no formulário de canal: recomeça o formulário com o modelo escolhido */
tela.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-roteiro-serie]")) {
    location.hash = rotaRoteiro(ev.target.value);
    return;
  }
  if (ev.target.matches("[data-roteiro-cap]")) {
    location.hash = rotaRoteiro(serieAtual().id, ev.target.value);
    return;
  }
  if (!ev.target.matches("[data-modelo]")) return;
  const id = ev.target.value;
  location.hash = `#canais/novo${id ? `/${encodeURIComponent(id)}` : ""}`;
});

tela.addEventListener("input", (ev) => {
  const historia = ev.target.closest('form[data-form="historia"]');
  if (historia && estado.roteiro.dados) {
    if (ev.target.matches("[data-historia]")) {
      const p = historia.querySelector("[data-contagem]");
      p.innerHTML = contagem(window.Roteiro.palavras(ev.target.value), estado.roteiro.dados.formato);
    }
    agendarQuadros(ev.target.matches("[data-historia]"));
  }
  if (ev.target.closest("form")) {
    estado.formSujo = true;
    estado.mensagem = null;
  }
});

tela.addEventListener("play", (ev) => {
  const id = ev.target.dataset && ev.target.dataset.video;
  if (id && !estado.inicioRevisao.has(id)) estado.inicioRevisao.set(id, Date.now());
}, true);

document.getElementById("atualizar").addEventListener("click", async (ev) => {
  const soltar = ocupar(ev.currentTarget, "Atualizando…");
  try {
    await window.FONTE.recarregar();
  } catch {
    /* a tela mostra o erro ao redesenhar */
  }
  await navegar(false);
  await recarregarCabecalho();
  soltar();
});

document.getElementById("sair").addEventListener("click", () => window.FONTE.sair());

window.addEventListener("hashchange", () => navegar());

/* atualização ao vivo: não redesenha com formulário sujo nem com vídeo tocando */
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  recarregarCabecalho();
  const tocando = [...tela.querySelectorAll("video")].some((v) => !v.paused);
  const ocupado = estado.formSujo || estado.refazendo || tocando || document.activeElement?.closest("form")
    || document.activeElement?.tagName === "IFRAME";
  const roteiro = estado.rota === "producao" && estado.param.startsWith("roteiro");
  if (!ocupado && !roteiro && ["inicio", "producao", "saude"].includes(estado.rota)) navegar(false);
}, 60_000);

/* a fonte decide se mostra o login do Google antes das telas */
window.FONTE.iniciar(tela).then((pronto) => {
  if (!pronto) return;
  navegar().then(() => {
    if (estado.rota !== "inicio") recarregarCabecalho();
  });
});
