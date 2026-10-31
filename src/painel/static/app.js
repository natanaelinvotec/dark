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
};
const DO_MAIS = new Set(["saude"]);
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

async function api(caminho, opcoes = {}) {
  const cabecalhos = { "X-Estudio": "1" };
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
  let resposta;
  try {
    resposta = await fetch(caminho, {
      method: opcoes.metodo || "GET",
      credentials: "same-origin",
      headers: cabecalhos,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
    });
  } catch {
    /* acesso online: quando o login da Cloudflare expira, o fetch é desviado e falha aqui */
    throw new Error(navigator.onLine
      ? "O painel não respondeu. Recarregue a página (se estiver pelo endereço online, o login da Cloudflare pode ter expirado)."
      : "Sem internet neste aparelho.");
  }
  if (resposta.redirected && !resposta.url.startsWith(location.origin)) {
    location.reload();
    throw new Error("Login expirado.");
  }
  if (resposta.status === 401) {
    location.href = "/login";
    throw new Error("Sessão expirada.");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(typeof dados.detail === "string" ? dados.detail : `O painel respondeu ${resposta.status}.`);
    erro.status = resposta.status;
    erro.dados = dados;
    throw erro;
  }
  return dados;
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
  const [rota, param = ""] = bruto.split("/");
  return Object.hasOwn(TITULOS, rota) ? { rota, param } : { rota: "inicio", param: "" };
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
  const { rota, param } = lerRota();
  if (rota !== estado.rota || param !== estado.param) {
    // itens "recém-decididos" só fazem sentido na aba onde a decisão foi tomada
    estado.recentes.clear();
    estado.refazendo = null;
    estado.formSujo = false;
    estado.mensagem = null;
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
        <p class="mg-sub">Assista antes de aprovar. Aprovar coloca o vídeo no pacote de agendamento do dia.</p>
      </div>
      ${vazio}
      <section class="mg-g2 mg-mt" aria-label="Vídeos">${itens.map(cartaoVideo).join("")}</section>`;
  },

  async producao() {
    const [p, c] = await Promise.all([api("/api/producao"), api("/api/canais")]);
    const opcoes = c.canais
      .filter((x) => x.ligado)
      .map((x) => `<option value="${esc(x.id)}">${esc(x.nome)}</option>`)
      .join("");
    const videos = p.videos.length
      ? p.videos.map(linhaProducao).join("")
      : '<p class="mg-sub mg-mt">Nada em produção. Gere um lote ao lado.</p>';
    const eventos = p.eventos.length
      ? p.eventos.map((e) => `<div><span class="h">${esc(fmtData(e.ts, { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</span><span class="${esc(e.nivel)}">${esc(e.etapa)}</span><span class="alvo">${esc(e.alvo)}</span><span class="${esc(e.nivel)}">${esc(e.msg)}</span></div>`).join("")
      : "<div>Sem eventos ainda.</div>";
    const msg = estado.mensagem ? `<p class="mg-chip mg-c-ok mg-mt" role="status">${esc(estado.mensagem)}</p>` : "";
    return `
      <section class="mg-split mg-split-inv">
        <form class="mg-card mg-in" data-form="lote" aria-labelledby="t-lote" novalidate>
          <h2 class="mg-h2" id="t-lote">Gerar lote</h2>
          <p class="mg-sub">Roteiro, voz e montagem rodam sozinhos. Quadros e gancho viram tarefas suas.</p>
          <div class="mg-campo"><label for="f-canal">Canal</label><select class="mg-input" id="f-canal" name="canal">${opcoes}</select></div>
          <div class="mg-campo"><label for="f-tema">Tema</label><input class="mg-input" id="f-tema" name="tema" maxlength="300" required aria-describedby="e-tema"><p class="mg-erro" id="e-tema"></p></div>
          <div class="mg-campo"><label for="f-serie">Série (opcional)</label><input class="mg-input" id="f-serie" name="serie" maxlength="120"></div>
          <div class="mg-campo"><label for="f-ref">Trecho base (opcional)</label><input class="mg-input" id="f-ref" name="referencia" maxlength="120" placeholder="Ex.: 1 Samuel 17:38-39"></div>
          <div class="mg-campo"><label for="f-qtd">Quantos vídeos (1 a 10)</label><input class="mg-input" id="f-qtd" name="qtd" type="number" min="1" max="10" value="3" inputmode="numeric"></div>
          <button type="submit" class="mg-btn mg-pri mg-mt">Gerar vídeos</button>
          <div aria-live="polite">${msg}</div>
        </form>
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

  async canais() {
    const d = await api("/api/canais");
    const cards = d.canais.map((c, i) => {
      const ypp = c.ypp;
      const pctInscritos = ypp.inscritos ? (ypp.inscritos / ypp.inscritos_meta) * 100 : 0;
      const pctViews = (ypp.views_90d / ypp.views_meta) * 100;
      return `
        <article class="mg-card mg-in" data-id="${esc(c.id)}" data-atraso="${50 + i * 50}">
          <div class="mg-entre">
            <h2 class="mg-h2 mg-com-ponto"><span class="mg-ponto" data-cor="${esc(c.cor)}"></span>${esc(c.nome)}</h2>
            <button type="button" class="mg-switch" role="switch" aria-checked="${c.ligado}" aria-label="Publicação do canal ${esc(c.nome)}" data-acao="ligar" ${c.permitido ? "" : "disabled"}></button>
          </div>
          <p class="mg-sub">${esc(c.descricao)}</p>
          <p class="mg-mt">${c.permitido ? chip(c.ligado ? "ok" : "espera", c.ligado ? "Ligado, produzindo" : "Pausado, nada será gerado") : chip("espera", "Desligado no YAML (enabled: false)")}</p>
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
          <p class="mg-erro" aria-live="polite"></p>
        </article>`;
    }).join("");
    return `
      ${pecaGatilho(d.gatilho, "Gatilho para abrir o próximo canal")}
      <section class="mg-g3 mg-mt" aria-label="Canais">${cards}</section>`;
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
    const chaves = Object.entries(d.chaves).map(([k, ok]) => `<li>${chip(ok ? "ok" : "cr", `${k}: ${ok ? "configurada" : "falta"}`)}</li>`).join("");
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
          <h2 class="mg-h2">Vem do arquivo .env</h2>
          <p class="mg-sub">Para mudar, edite o .env e reinicie. As chaves nunca aparecem aqui.</p>
          <dl class="mg-dados">
            <div><dt>Teto do mês</dt><dd>${fmtBRL(d.teto_mes_brl)}</dd></div>
            <div><dt>Modelo Gemini</dt><dd class="mg-pequeno">${esc(d.modelo)}</dd></div>
            <div><dt>Voz da Azure</dt><dd class="mg-pequeno">${esc(d.voz)}</dd></div>
          </dl>
          <ul class="mg-testes mg-mt">${chaves}</ul>
        </div>
      </section>`;
  },

  async saude() {
    const s = await api("/api/saude");
    const minutos = s.worker.minutos;
    const workerOk = minutos != null && minutos <= 15;
    const itens = [
      ["Worker", workerOk ? "ok" : "cr", minutos == null ? "nunca rodou" : `último ciclo há ${minutos} min`],
      ["FFmpeg", s.ffmpeg ? "ok" : "cr", s.ffmpeg || "não encontrado no PATH"],
      ["Pasta do Drive", s.pasta_dados ? "ok" : "cr", s.pasta_dados ? "encontrada" : "não encontrada: confira ESTUDIO_DADOS"],
      ["Fontes", s.fontes.length ? "ok" : "at", s.fontes.length ? s.fontes.join(", ") : "sem fontes em assets/fonts"],
      ["Disco", s.disco && s.disco.livre_gb >= 20 ? "ok" : "at", s.disco ? `${NUM1.format(s.disco.livre_gb)} GB livres de ${NUM1.format(s.disco.total_gb)} GB` : "—"],
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
      ["#config", "Configurações", "Preços, câmbio, créditos e chaves"],
      ["#saude", "Saúde do sistema", "Worker, FFmpeg, Drive e disco"],
      ["#canais", "Canais", "Liga/desliga e gatilho do próximo canal"],
      ["#series", "Séries", "Temporadas e personagens"],
      ["#dinheiro", "Dinheiro", "Caixa do mês e custos de IA"],
    ];
    const EM_BREVE = [
      ["Calendário", "Semana e mês de publicações"],
      ["Ativos e licenças", "Origem e licença de cada arquivo"],
      ["Pautas", "Ideias com nota e similaridade"],
      ["Comentários", "YouTube e TikTok num lugar só"],
    ];
    const grupo = (titulo, cards) => `<h2 class="mg-h2 mg-mt">${titulo}</h2><div class="mg-g3 mg-mt">${cards}</div>`;
    return grupo("Ferramentas", ATALHOS.map(([href, nome, desc]) => `
        <a class="mg-card mg-atalho" href="${href}"><p class="mg-forte">${nome}</p><p class="mg-sub">${desc}</p></a>`).join(""))
      + grupo("Em breve", EM_BREVE.map(([nome, desc]) => `
        <div class="mg-card mg-atalho mg-desabilitado" aria-disabled="true"><p class="mg-forte">${nome} ${chip("espera", "em breve")}</p><p class="mg-sub">${desc}</p></div>`).join(""));
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
  const baixar = v.tem_arquivo
    ? `<a class="mg-btn mg-pri" href="/api/videos/${encodeURIComponent(v.id)}/arquivo" download>Baixar vídeo</a>`
    : chip("at", "MP4 não está neste aparelho");
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
    ? `<p class="mg-aviso mg-c-at mg-mt">Os dados das plataformas foram conferidos há ${d.dias} dias. As regras mudam: revise o arquivo plataformas.yaml.</p>`
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
      : '<p class="mg-sub mg-bloco">Nenhum canal publica aqui. Adicione o id em "plataformas" no YAML do canal.</p>';
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
  const previa = v.tem_previa
    ? `<video controls preload="none" playsinline src="/api/videos/${encodeURIComponent(v.id)}/previa" data-video="${esc(v.id)}" aria-label="Prévia de ${esc(v.titulo)}"></video>`
    : '<span class="mg-sem-previa">Sem prévia neste computador</span>';
  const janela = v.janela && !v.tem_previa
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

tela.addEventListener("input", (ev) => {
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
  await navegar(false);
  await recarregarCabecalho();
  soltar();
});

document.getElementById("sair").addEventListener("click", async () => {
  try {
    await enviar("/logout");
  } finally {
    location.href = "/login";
  }
});

window.addEventListener("hashchange", () => navegar());

/* atualização ao vivo: não redesenha com formulário sujo nem com vídeo tocando */
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  recarregarCabecalho();
  const tocando = [...tela.querySelectorAll("video")].some((v) => !v.paused);
  const ocupado = estado.formSujo || estado.refazendo || tocando || document.activeElement?.closest("form");
  if (!ocupado && ["inicio", "producao", "saude"].includes(estado.rota)) navegar(false);
}, 60_000);

navegar().then(() => {
  if (estado.rota !== "inicio") recarregarCabecalho();
});
