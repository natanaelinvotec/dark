"use strict";
/* Camada de dados do painel (o app.js só fala com window.FONTE).
   Dois modos, mesma interface:
   - demonstração: sem Firebase configurado; dados de exemplo no localStorage deste navegador;
   - Firebase: login com Google + Firestore (só o e-mail do dono passa, conferido também nas regras).
   As telas são montadas pelo Motor a partir do estado carregado; cada ação vira um lote de
   gravações no banco (writeBatch), aplicado também no estado em memória. */
(function () {
  const CFG = window.ESTUDIO_CONFIG || {};
  const FB = CFG.firebase || {};
  const LIGADO = Boolean(FB.apiKey && !/^COLE/.test(FB.apiKey) && FB.projectId);
  const M = window.Motor;
  const VERSAO_SDK = "10.12.2";
  const CHAVE_DEMO = "estudio:demo:v2";
  const VALIDADE_MS = 30e3; // recarrega do banco se o estado tiver mais de 30 s
  const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAPA[c]);
  const COLECOES_MAPA = ["videos", "contas"];
  const COLECOES_LISTA = ["acoes", "eventos", "custos", "metricas", "receitas", "campanhas"];

  /* ------------------------------------------------ arquivos fixos (canais e plataformas) */
  let fixos = null;
  async function carregarFixos() {
    if (fixos) return fixos;
    const ler = async (caminho) => {
      const r = await fetch(caminho, { cache: "no-cache" });
      if (!r.ok) throw new Error(`Não achei ${caminho}.`);
      return r.json();
    };
    const [canais, plataformas] = await Promise.all([ler("dados/canais.json"), ler("dados/plataformas.json")]);
    fixos = { canais: Object.fromEntries(canais.map((c) => [c.slug, c])), plataformas };
    return fixos;
  }

  /* ------------------------------------------------ demonstração (localStorage) */
  function lerDemo() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE_DEMO));
      if (d && d.versao === 2) return d;
    } catch {
      /* armazenamento bloqueado ou corrompido: recomeça do exemplo */
    }
    return null;
  }
  function gravarDemo(d) {
    try {
      localStorage.setItem(CHAVE_DEMO, JSON.stringify(d));
    } catch {
      /* sem armazenamento: o exemplo continua só nesta aba */
    }
  }
  const DEMO = {
    modo: "demo",
    async iniciar() { return true; },
    async carregar() {
      const f = await carregarFixos();
      let d = lerDemo();
      if (!d) {
        d = window.Semente.criar(M, new Date());
        gravarDemo(d);
      }
      return { ...d, canais: f.canais, plataformas: f.plataformas, conexao: { modo: "demo", projeto: "", email: "", funcoes: false } };
    },
    async gravar(mudancas) {
      const d = lerDemo() || window.Semente.criar(M, new Date());
      M.aplicar(d, mudancas);
      gravarDemo(d);
    },
    async sair() { location.reload(); },
    async restaurarExemplo() {
      try { localStorage.removeItem(CHAVE_DEMO); } catch { /* nada a apagar */ }
    },
  };

  /* ------------------------------------------------ Firebase */
  let sdk = null;
  function firebase() {
    if (sdk) return sdk;
    const base = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/`;
    sdk = Promise.all([import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-firestore.js`)])
      .then(([app, A, F]) => {
        const aplicativo = app.initializeApp(FB);
        return { A, F, auth: A.getAuth(aplicativo), db: F.getFirestore(aplicativo) };
      });
    return sdk;
  }
  const usuario = (f) => new Promise((ok) => {
    const parar = f.A.onAuthStateChanged(f.auth, (u) => { parar(); ok(u); });
  });

  function telaLogin(tela, f, aviso) {
    document.getElementById("titulo").textContent = "Entrar";
    document.getElementById("selo").textContent = "Estúdio de Canais";
    tela.innerHTML = `
      <div class="mg-card mg-in mg-entrar">
        <p class="mg-h2">Entrar no painel</p>
        <p class="mg-sub">Use a conta Google do dono. Ninguém mais vê os dados.</p>
        ${aviso ? `<p class="mg-aviso mg-c-at mg-mt">${esc(aviso)}</p>` : ""}
        <button type="button" class="mg-btn mg-pri" id="entrar-google">Entrar com Google</button>
        <p class="mg-erro" aria-live="polite"></p>
      </div>`;
    const botao = tela.querySelector("#entrar-google");
    botao.focus();
    botao.addEventListener("click", async () => {
      botao.disabled = true;
      try {
        await f.A.signInWithPopup(f.auth, new f.A.GoogleAuthProvider());
        location.reload();
      } catch (e) {
        botao.disabled = false;
        tela.querySelector(".mg-erro").textContent = e && e.code === "auth/popup-blocked"
          ? "O navegador bloqueou a janela de login. Libere pop-ups para este site e tente de novo."
          : "Não deu para entrar. Tente de novo.";
      }
    });
  }

  function erroFirebase(e) {
    return new Error(e && e.code === "permission-denied"
      ? "Sem permissão: confira as regras do Firestore e o e-mail do dono em web/config.js."
      : "Sem conexão com o Firebase. Tente de novo.");
  }

  const NUVEM = {
    modo: "firebase",
    email: "",
    async iniciar(tela) {
      const f = await firebase();
      const u = await usuario(f);
      if (!u) {
        telaLogin(tela, f);
        return false;
      }
      if (CFG.dono && String(u.email || "").toLowerCase() !== String(CFG.dono).toLowerCase()) {
        await f.A.signOut(f.auth);
        telaLogin(tela, f, `A conta ${u.email} não tem acesso a este painel.`);
        return false;
      }
      NUVEM.email = u.email || "";
      return true;
    },
    async carregar() {
      const [fx, f] = await Promise.all([carregarFixos(), firebase()]);
      const { F, db } = f;
      const agora = new Date();
      const recente = M.isoBR(new Date(agora.getTime() - 45 * 86400e3));
      const desde = M.somarDias(M.diaBR(agora), -95);
      try {
        const [ativos, recentes, contas, acoes, eventos, custos, metricas, receitas, campanhas, config] = await Promise.all([
          F.getDocs(F.query(F.collection(db, "videos"), F.where("status", "in", ["pauta", "produzindo", "voce", "fila", "reprovado", "aprovado", "refazer"]))),
          F.getDocs(F.query(F.collection(db, "videos"), F.where("atualizadoEm", ">=", recente))),
          F.getDocs(F.collection(db, "contas")),
          F.getDocs(F.query(F.collection(db, "acoes"), F.orderBy("n", "desc"), F.limit(300))),
          F.getDocs(F.query(F.collection(db, "eventos"), F.orderBy("n", "desc"), F.limit(60))),
          F.getDocs(F.query(F.collection(db, "custos"), F.where("mes", ">=", desde.slice(0, 7)))),
          F.getDocs(F.query(F.collection(db, "metricas"), F.where("data", ">=", desde))),
          F.getDocs(F.collection(db, "receitas")),
          F.getDocs(F.collection(db, "campanhas")),
          F.getDoc(F.doc(db, "config", "geral")),
        ]);
        const mapa = (...snaps) => {
          const o = {};
          snaps.forEach((s) => s.forEach((d) => { o[d.id] = { id: d.id, ...d.data() }; }));
          return o;
        };
        const listaDe = (s) => {
          const a = [];
          s.forEach((d) => a.push({ id: d.id, ...d.data() }));
          return a;
        };
        return {
          exemplo: false, canais: fx.canais, plataformas: fx.plataformas,
          videos: mapa(ativos, recentes), contas: mapa(contas),
          acoes: listaDe(acoes), eventos: listaDe(eventos), custos: listaDe(custos), metricas: listaDe(metricas),
          receitas: listaDe(receitas), campanhas: listaDe(campanhas), config: config.exists() ? config.data() : {},
          conexao: { modo: "firebase", projeto: FB.projectId, email: NUVEM.email, funcoes: Boolean(CFG.funcoes) },
        };
      } catch (e) {
        throw erroFirebase(e);
      }
    },
    async gravar(mudancas) {
      const { F, db } = await firebase();
      const lote = F.writeBatch(db);
      for (const m of mudancas) {
        if (m.tipo === "set") {
          const { id: _ignorar, ...dados } = m.dados;
          lote.set(F.doc(db, m.col, m.id), dados, m.substituir ? {} : { merge: true });
        } else if (m.tipo === "add") {
          lote.set(F.doc(F.collection(db, m.col)), m.dados);
        } else if (m.tipo === "config") {
          lote.set(F.doc(db, "config", "geral"), m.dados, { merge: true });
        }
      }
      try {
        await lote.commit();
      } catch (e) {
        throw erroFirebase(e);
      }
    },
    async sair() {
      const f = await firebase();
      await f.A.signOut(f.auth);
      location.reload();
    },
    async restaurarExemplo() { /* só existe na demonstração */ },
  };

  /* ------------------------------------------------ a fonte que o app.js usa */
  const banco = LIGADO ? NUVEM : DEMO;
  let estado = null;
  let carregadoEm = 0;

  async function obterEstado(forcar) {
    if (!estado || forcar || Date.now() - carregadoEm > VALIDADE_MS) {
      estado = await banco.carregar();
      carregadoEm = Date.now();
    }
    return estado;
  }

  window.FONTE = {
    get modo() { return banco.modo; },
    iniciar: (tela) => banco.iniciar(tela),
    async get(caminho) {
      const e = await obterEstado(false);
      return M.get(e, caminho, new Date());
    },
    async post(caminho, corpo) {
      const e = await obterEstado(false);
      const { resposta, mudancas } = M.post(e, caminho, corpo, new Date());
      await banco.gravar(mudancas);
      M.aplicar(e, mudancas);
      return resposta;
    },
    recarregar: () => obterEstado(true),
    previa(v) {
      return v && DRIVE_ID.test(v.drive_id || "")
        ? `<iframe src="https://drive.google.com/file/d/${v.drive_id}/preview" allow="autoplay; fullscreen" title="Prévia de ${esc(v.titulo)}" loading="lazy"></iframe>`
        : "";
    },
    baixar(v) {
      return v && DRIVE_ID.test(v.drive_id || "") ? `https://drive.google.com/uc?export=download&id=${v.drive_id}` : "";
    },
    sair: () => banco.sair(),
    async restaurarExemplo() {
      await banco.restaurarExemplo();
      estado = null;
    },
  };
})();
