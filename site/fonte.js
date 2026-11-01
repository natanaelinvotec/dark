"use strict";
/* Fonte de dados do painel no GitHub Pages (o app.js chama FONTE.get/post no lugar de /api).
   - Demonstração: telas de exemplo (exemplo/telas.json); nada é salvo.
   - Firebase: login com Google; as telas vêm de Firestore telas/{nome}, que o PC publica, e cada
     ação vira um documento em comandos/, que o PC executa com as mesmas validações da API local
     e responde no próprio documento. */
(function () {
  const CFG = window.ESTUDIO_CONFIG || {};
  const FB = CFG.firebase || {};
  const LIGADO = Boolean(FB.apiKey && !/^COLE/.test(FB.apiKey) && FB.projectId);
  const VERSAO = "10.12.2";
  const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
  const MAPA = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => MAPA[c]);
  const copia = (x) => JSON.parse(JSON.stringify(x));

  /* mesma regra de estudio/nuvem.py: "/api/fila?aba=prontos" -> "fila-prontos" */
  function chave(caminho) {
    const [rota, consulta = ""] = String(caminho).split("?");
    const nome = rota.replace(/^\/api\//, "");
    const aba = new URLSearchParams(consulta).get("aba");
    return aba ? `${nome}-${aba}` : nome;
  }

  /* ------------------------------------------------ demonstração */
  let exemplo = null;
  const DEMO = {
    modo: "demo",
    semPrevia: "Demonstração: sem vídeo",
    async iniciar() { return true; },
    async get(caminho) {
      if (!exemplo) {
        const r = await fetch("exemplo/telas.json", { cache: "no-cache" });
        if (!r.ok) throw new Error("Não achei os dados de exemplo do painel.");
        exemplo = await r.json();
      }
      const t = exemplo[chave(caminho)];
      if (!t) throw new Error("Esta tela não tem dados de exemplo.");
      return copia(t);
    },
    async post() {
      throw new Error("Modo demonstração: nada é salvo. Ligue o Firebase (README, seção Painel online).");
    },
    previa: () => "",
    baixar: () => "",
    async sair() { location.reload(); },
  };

  /* ------------------------------------------------ Firebase */
  let sdk = null;
  function firebase() {
    if (sdk) return sdk;
    const base = `https://www.gstatic.com/firebasejs/${VERSAO}/`;
    sdk = Promise.all([
      import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-firestore.js`),
    ]).then(([app, A, F]) => {
      const aplicativo = app.initializeApp(FB);
      return { A, F, auth: A.getAuth(aplicativo), db: F.getFirestore(aplicativo) };
    });
    return sdk;
  }

  function usuario(f) {
    return new Promise((ok) => {
      const parar = f.A.onAuthStateChanged(f.auth, (u) => { parar(); ok(u); });
    });
  }

  function telaLogin(tela, f, aviso) {
    document.getElementById("titulo").textContent = "Entrar";
    document.getElementById("selo").textContent = "Painel online";
    tela.innerHTML = `
      <div class="mg-card mg-in mg-entrar">
        <p class="mg-h2">Entrar no painel</p>
        <p class="mg-sub">Use a conta Google do dono. Ninguém mais consegue ver as telas.</p>
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

  const NUVEM = {
    modo: "firebase",
    semPrevia: "A prévia aparece quando o PC enviar o vídeo ao Drive",
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
      return true;
    },
    async get(caminho) {
      const f = await firebase();
      let s;
      try {
        s = await f.F.getDoc(f.F.doc(f.db, "telas", chave(caminho)));
      } catch (e) {
        throw new Error(e && e.code === "permission-denied"
          ? "Sem permissão: confira as regras do Firestore e o e-mail do dono."
          : "Sem conexão com o Firebase.");
      }
      if (!s.exists()) throw new Error("O PC ainda não enviou esta tela. Ligue o PC (iniciar.bat) e espere 1 minuto.");
      return JSON.parse(s.data().json);
    },
    async post(caminho, corpo) {
      const f = await firebase();
      const F = f.F;
      const ref = await F.addDoc(F.collection(f.db, "comandos"), {
        caminho, corpo: corpo || {}, status: "pendente", criadoEm: F.serverTimestamp(), porEmail: f.auth.currentUser.email,
      });
      return new Promise((ok, falha) => {
        let parar = () => {};
        const limite = setTimeout(() => {
          parar();
          falha(new Error("O PC não respondeu (desligado?). O pedido ficou guardado e roda quando ele ligar."));
        }, 45000);
        parar = F.onSnapshot(ref, (s) => {
          const d = s.data() || {};
          if (d.status === "pendente") return;
          clearTimeout(limite);
          parar();
          const resposta = d.resposta ? JSON.parse(d.resposta) : null;
          if (d.status === "ok") {
            ok(resposta || {});
            return;
          }
          const erro = new Error(d.erro || "O PC recusou o pedido.");
          erro.status = d.codigo;
          erro.dados = resposta || {};
          falha(erro);
        }, () => {
          clearTimeout(limite);
          falha(new Error("Sem conexão com o Firebase."));
        });
      });
    },
    previa(v) {
      return v && DRIVE_ID.test(v.drive_id || "")
        ? `<iframe src="https://drive.google.com/file/d/${v.drive_id}/preview" allow="autoplay; fullscreen" title="Prévia de ${esc(v.titulo)}" loading="lazy"></iframe>`
        : "";
    },
    baixar(v) {
      return v && DRIVE_ID.test(v.drive_id || "") ? `https://drive.google.com/uc?export=download&id=${v.drive_id}` : "";
    },
    async sair() {
      const f = await firebase();
      await f.A.signOut(f.auth);
      location.reload();
    },
  };

  window.FONTE = LIGADO ? NUVEM : DEMO;
})();
