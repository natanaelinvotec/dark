"use strict";
/* Camada de dados do painel (o app.js só fala com window.FONTE).
   Dois modos, mesma interface:
   - demonstração: sem Firebase configurado; dados de exemplo no localStorage deste navegador;
   - Firebase: login com Google + Firestore. Cada conta tem o próprio estúdio em estudios/{uid}/...
     e as regras (firestore.rules) só deixam cada um ler e gravar o seu.
   As telas são montadas pelo Motor a partir do estado carregado; cada ação vira um lote de
   gravações no banco (writeBatch), aplicado também no estado em memória. */
(function () {
  const CFG = window.ESTUDIO_CONFIG || {};
  const FB = CFG.firebase || {};
  const LIGADO = Boolean(FB.apiKey && !/^COLE/.test(FB.apiKey) && FB.projectId);
  const ADMIN = String(CFG.admin || "").trim().toLowerCase();
  const M = window.Motor;
  const VERSAO_SDK = "12.19.0"; // app, auth, firestore, ai e app-check precisam ser da mesma versão
  const VERSAO_DADOS = 1; // sobe quando o formato no banco mudar (migração no primeiro acesso)
  const CHAVE_DEMO = "estudio:demo:v4";
  const VALIDADE_MS = 30e3; // recarrega do banco se o estado tiver mais de 30 s
  const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAPA[c]);
  // coleções fora do estúdio (só o dono da plataforma grava)
  const GLOBAIS = new Set(["plataforma", "estudios"]);

  /* ------------------------------------------------ arquivos fixos (modelos e plataformas) */
  let fixos = null;
  async function carregarFixos() {
    if (fixos) return fixos;
    const ler = async (caminho) => {
      const r = await fetch(caminho, { cache: "no-cache" });
      if (!r.ok) throw new Error(`Não achei ${caminho}.`);
      return r.json();
    };
    const [modelos, plataformas] = await Promise.all([ler("dados/modelos.json"), ler("dados/plataformas.json")]);
    fixos = { modelos, plataformas };
    return fixos;
  }

  /* ------------------------------------------------ demonstração (localStorage) */
  function lerDemo() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE_DEMO));
      if (d && d.versao === 4) return d;
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
  let demoMemoria = null; // quando o navegador não deixa guardar nada
  const DEMO = {
    modo: "demo",
    admin: true,
    async iniciar() { return true; },
    async carregar() {
      const f = await carregarFixos();
      let d = lerDemo() || demoMemoria;
      if (!d) {
        d = window.Semente.criar(M, new Date(), f.modelos);
        gravarDemo(d);
      }
      demoMemoria = d;
      return {
        ...JSON.parse(JSON.stringify(d)), modelos: f.modelos, plataformas: f.plataformas,
        conexao: { modo: "demo", projeto: "", email: "", uid: "demo", admin: true, funcoes: false, ia: true },
      };
    },
    async gravar(mudancas) {
      const d = lerDemo() || demoMemoria;
      M.aplicar(d, mudancas);
      gravarDemo(d);
    },
    async sair() { location.reload(); },
    async restaurarExemplo(vazio) {
      demoMemoria = vazio ? window.Semente.vazio(new Date()) : null;
      try {
        if (vazio) gravarDemo(demoMemoria);
        else localStorage.removeItem(CHAVE_DEMO);
      } catch { /* nada a apagar */ }
    },
  };

  /* ------------------------------------------------ Firebase */
  let sdk = null;
  function firebase() {
    if (sdk) return sdk;
    const base = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}/`;
    const modulos = [import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-firestore.js`)];
    if (CFG.recaptcha) modulos.push(import(`${base}firebase-app-check.js`));
    sdk = Promise.all(modulos).then(([app, A, F, C]) => {
      const aplicativo = app.initializeApp(FB);
      // App Check (reCAPTCHA invisível): a IA só responde a pedidos que saem deste site
      if (C) C.initializeAppCheck(aplicativo, { provider: new C.ReCaptchaEnterpriseProvider(CFG.recaptcha), isTokenAutoRefreshEnabled: true });
      return { A, F, app: aplicativo, auth: A.getAuth(aplicativo), db: F.getFirestore(aplicativo) };
    });
    return sdk;
  }
  const usuario = (f) => new Promise((ok) => {
    const parar = f.A.onAuthStateChanged(f.auth, (u) => { parar(); ok(u); });
  });

  function cartao(tela, titulo, texto, aviso, botao) {
    document.getElementById("titulo").textContent = titulo;
    document.getElementById("selo").textContent = "Estúdio de Canais";
    tela.innerHTML = `
      <div class="mg-card mg-in mg-entrar">
        <p class="mg-h2">${esc(titulo)}</p>
        <p class="mg-sub">${esc(texto)}</p>
        ${aviso ? `<p class="mg-aviso mg-c-at mg-mt">${esc(aviso)}</p>` : ""}
        <button type="button" class="mg-btn mg-pri" id="botao-entrada">${esc(botao)}</button>
        <p class="mg-erro" aria-live="polite"></p>
      </div>`;
    const b = tela.querySelector("#botao-entrada");
    b.focus();
    return b;
  }

  function telaLogin(tela, f, aviso) {
    const botao = cartao(tela, "Entrar no estúdio",
      "Entre com a sua conta Google. Cada conta tem o próprio estúdio, com canais, fila e contas separados.", aviso, "Entrar com Google");
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

  /** Conta logada, mas sem estúdio liberado: explica e oferece trocar de conta. */
  function telaBarrado(tela, f, titulo, texto) {
    const botao = cartao(tela, titulo, texto, "", "Entrar com outra conta");
    botao.addEventListener("click", async () => {
      await f.A.signOut(f.auth);
      location.reload();
    });
  }

  function erroFirebase(e) {
    const erro = new Error(e && e.code === "permission-denied"
      ? "Sem permissão. Se o seu estúdio foi pausado, fale com o dono da plataforma."
      : "Sem conexão com o Firebase. Tente de novo.");
    erro.codigo = e && e.code;
    return erro;
  }

  const NUVEM = {
    modo: "firebase",
    email: "",
    uid: "",
    admin: false,
    async iniciar(tela) {
      const f = await firebase();
      const { F, db } = f;
      const u = await usuario(f);
      if (!u) {
        telaLogin(tela, f);
        return false;
      }
      const email = String(u.email || "").toLowerCase();
      const admin = Boolean(ADMIN) && email === ADMIN && u.emailVerified;
      try {
        const ref = F.doc(db, "estudios", u.uid);
        const snap = await F.getDoc(ref);
        if (!snap.exists()) {
          // primeiro acesso: o estúdio nasce vazio. Quem decide se a conta pode (cadastro aberto,
          // convite ou dono da plataforma) são as regras do Firestore; a lista de convidados não sai do banco.
          try {
            await F.setDoc(ref, {
              email: u.email, nome: String(u.displayName || "").slice(0, 80), ativo: true,
              criadoEm: M.isoBR(new Date()), versaoDados: VERSAO_DADOS,
            });
          } catch (e) {
            if (e && e.code === "permission-denied") {
              telaBarrado(tela, f, "Cadastro fechado",
                `A conta ${u.email} ainda não tem um estúdio. Peça um convite ao dono da plataforma e entre de novo.`);
              return false;
            }
            throw e;
          }
        } else if (snap.data().ativo === false) {
          telaBarrado(tela, f, "Estúdio pausado", "O dono da plataforma pausou este estúdio. Seus dados continuam guardados.");
          return false;
        }
      } catch (e) {
        telaBarrado(tela, f, "Não deu para abrir o estúdio", erroFirebase(e).message);
        return false;
      }
      NUVEM.email = u.email || "";
      NUVEM.uid = u.uid;
      NUVEM.admin = admin;
      return true;
    },
    async carregar() {
      const [fx, f] = await Promise.all([carregarFixos(), firebase()]);
      const { F, db } = f;
      const col = (nome) => F.collection(db, "estudios", NUVEM.uid, nome);
      const agora = new Date();
      const recente = M.isoBR(new Date(agora.getTime() - 45 * 86400e3));
      const desde = M.somarDias(M.diaBR(agora), -95);
      try {
        const pedidos = [
          F.getDocs(col("canais")),
          F.getDocs(F.query(col("videos"), F.where("status", "in", ["pauta", "produzindo", "voce", "fila", "reprovado", "aprovado", "refazer"]))),
          F.getDocs(F.query(col("videos"), F.where("atualizadoEm", ">=", recente))),
          F.getDocs(col("contas")),
          F.getDocs(F.query(col("acoes"), F.orderBy("n", "desc"), F.limit(300))),
          F.getDocs(F.query(col("eventos"), F.orderBy("n", "desc"), F.limit(60))),
          F.getDocs(F.query(col("custos"), F.where("mes", ">=", desde.slice(0, 7)))),
          F.getDocs(F.query(col("metricas"), F.where("data", ">=", desde))),
          F.getDocs(col("receitas")),
          F.getDocs(col("campanhas")),
          F.getDoc(F.doc(db, "estudios", NUVEM.uid, "config", "geral")),
          F.getDocs(col("series")),
          F.getDocs(F.query(col("capitulos"), F.limit(2000))),
        ];
        if (NUVEM.admin) {
          pedidos.push(F.getDoc(F.doc(db, "plataforma", "acesso")), F.getDocs(F.query(F.collection(db, "estudios"), F.limit(500))));
        }
        const [canais, ativos, recentes, contas, acoes, eventos, custos, metricas, receitas, campanhas, config, series, capitulos, acesso, estudios] = await Promise.all(pedidos);
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
        const porSlug = {};
        canais.forEach((d) => { porSlug[d.id] = { ...d.data(), slug: d.id }; });
        const estado = {
          exemplo: false, canais: porSlug, modelos: fx.modelos, plataformas: fx.plataformas,
          videos: mapa(ativos, recentes), contas: mapa(contas),
          acoes: listaDe(acoes), eventos: listaDe(eventos), custos: listaDe(custos), metricas: listaDe(metricas),
          receitas: listaDe(receitas), campanhas: listaDe(campanhas), config: config.exists() ? config.data() : {},
          series: mapa(series), capitulos: mapa(capitulos),
          conexao: {
            modo: "firebase", projeto: FB.projectId, email: NUVEM.email, uid: NUVEM.uid, admin: NUVEM.admin,
            funcoes: Boolean(CFG.funcoes), ia: Boolean(CFG.recaptcha),
          },
        };
        if (NUVEM.admin) {
          estado.plataforma = { acesso: acesso.exists() ? acesso.data() : { aberto: false, convidados: [] } };
          estado.estudios = {};
          estudios.forEach((d) => { estado.estudios[d.id] = d.data(); });
        }
        return estado;
      } catch (e) {
        throw erroFirebase(e);
      }
    },
    async gravar(mudancas) {
      const { F, db } = await firebase();
      const doc = (col, id) => (GLOBAIS.has(col) ? F.doc(db, col, id) : F.doc(db, "estudios", NUVEM.uid, col, id));
      try {
        // canal só sai se não sobrou vídeo nenhum no banco (o estado em memória guarda só os recentes)
        for (const m of mudancas.filter((x) => x.tipo === "del" && x.col === "canais")) {
          const q = F.query(F.collection(db, "estudios", NUVEM.uid, "videos"), F.where("canal", "==", m.id));
          if ((await F.getCountFromServer(q)).data().count > 0) {
            throw new Error("Este canal ainda tem vídeos guardados. Pause o canal em vez de apagar.");
          }
        }
        const lote = F.writeBatch(db);
        for (const m of mudancas) {
          if (m.tipo === "set") {
            const { id: _ignorar, ...dados } = m.dados;
            lote.set(doc(m.col, m.id), dados, m.substituir ? {} : { merge: true });
          } else if (m.tipo === "del") {
            lote.delete(doc(m.col, m.id));
          } else if (m.tipo === "add") {
            lote.set(F.doc(F.collection(db, "estudios", NUVEM.uid, m.col)), m.dados);
          } else if (m.tipo === "config") {
            lote.set(doc("config", "geral"), m.dados, { merge: true });
          }
        }
        await lote.commit();
      } catch (e) {
        throw e.code ? erroFirebase(e) : e;
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
    get admin() { return banco.admin; },
    versaoSdk: VERSAO_SDK,
    /** O app do Firebase já iniciado (o js/ia.js usa o mesmo, com o mesmo login e App Check). */
    async appFirebase() { return LIGADO ? (await firebase()).app : null; },
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
    async restaurarExemplo(vazio) {
      await banco.restaurarExemplo(vazio);
      estado = null;
    },
  };
})();
