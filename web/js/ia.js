"use strict";
/* IA do Roteiro: o navegador fala com o Gemini pelo Firebase AI Logic (nenhuma chave no site;
   o App Check com reCAPTCHA garante que só este site usa a cota do projeto).
   Os pedidos (o texto) vêm do js/roteiro.js; aqui ficam só o "papel" da IA, o formato JSON de cada
   resposta e o tratamento de erro. Na demonstração, um gerador de mentira responde no mesmo formato. */
(function () {
  const CFG = window.ESTUDIO_CONFIG || {};
  const MODELO = (CFG.ia || {}).modelo || "gemini-3.8-flash";
  const RESERVA = (CFG.ia || {}).reserva || "gemini-3.5-flash-lite";

  const SISTEMA = [
    "Você é roteirista-chefe de uma série de vídeos curtos verticais (Shorts, Reels, TikTok) em português do Brasil.",
    "Continuidade é a prioridade: a aparência, as roupas, a personalidade dos personagens e os lugares seguem a bíblia da série;",
    "nada contradiz os capítulos anteriores; cada capítulo cumpre a sua parte do arco e termina com um gancho.",
    "Texto original, com palavras próprias; nada de copiar trechos de obras protegidas.",
    "Responda só com o JSON pedido.",
  ].join(" ");

  /** Formato da resposta de cada tipo de pedido (a IA não consegue fugir dele). */
  function esquema(S, tipo, info) {
    const lista = (props) => S.array({ items: S.object({ properties: props }) });
    if (tipo === "historia") {
      return S.object({
        properties: {
          titulo: S.string(), historia: S.string(), resumo: S.string(),
          novos_personagens: lista({ nome: S.string(), aparencia: S.string(), roupas: S.string(), personalidade: S.string() }),
          novos_cenarios: lista({ nome: S.string(), descricao: S.string() }),
        },
      });
    }
    if (tipo === "quadros") {
      const pers = info.personagens.length ? S.enumString({ enum: info.personagens }) : S.string();
      const quadro = {
        trecho: S.string(), personagens: S.array({ items: pers }), acao_en: S.string(), enquadramento_en: S.string(),
      };
      if (info.cenarios.length) quadro.cenario = S.enumString({ enum: info.cenarios });
      return S.object({
        properties: { quadros: S.array({ items: S.object({ properties: quadro, optionalProperties: info.cenarios.length ? ["cenario"] : [] }) }) },
      });
    }
    if (tipo === "fichas") {
      return S.object({ properties: { fichas: lista({ id: S.string(), ficha_en: S.string() }), evitar_en: S.string() } });
    }
    if (tipo === "arco") {
      return S.object({ properties: { arco: lista({ n: S.integer(), titulo: S.string(), resumo: S.string() }) } });
    }
    throw new Error(`pedido desconhecido: ${tipo}`);
  }

  function erroAmigavel(e) {
    const t = `${(e && e.code) || ""} ${(e && e.message) || ""}`;
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(t)) {
      return new Error("A cota grátis da IA acabou por agora. Espere alguns minutos; o limite do dia volta de madrugada (horário de Brasília).");
    }
    if (/app.?check|attestation|recaptcha/i.test(t)) return new Error("A proteção anti-robô (App Check) não liberou o pedido. Recarregue a página e tente de novo.");
    if (/SAFETY|blocked|PROHIBITED/i.test(t)) return new Error("A IA recusou este pedido pelo filtro de segurança. Mude a direção do capítulo e tente de novo.");
    if (/JSON/i.test(t)) return new Error("A IA respondeu fora do formato. Tente de novo.");
    return new Error("Não deu para falar com a IA agora. Confira a internet e tente de novo.");
  }

  let carregado = null;
  async function sdk() {
    if (!carregado) {
      carregado = Promise.all([window.FONTE.appFirebase(), import(`https://www.gstatic.com/firebasejs/${window.FONTE.versaoSdk}/firebase-ai.js`)])
        .then(([app, AI]) => ({ AI, ai: AI.getAI(app, { backend: new AI.GoogleAIBackend() }) }))
        .catch((e) => {
          carregado = null;
          throw e;
        });
    }
    return carregado;
  }

  async function chamar(nomeModelo, tipo, texto, info) {
    const { AI, ai } = await sdk();
    const modelo = AI.getGenerativeModel(ai, {
      model: nomeModelo,
      systemInstruction: SISTEMA,
      generationConfig: { responseMimeType: "application/json", responseSchema: esquema(AI.Schema, tipo, info) },
    });
    const r = await modelo.generateContent(texto);
    return JSON.parse(r.response.text());
  }

  /** Gera a resposta de um pedido do roteiro. info = { personagens: [ids], cenarios: [ids] } */
  async function gerar(tipo, texto, info = { personagens: [], cenarios: [] }) {
    if (window.FONTE.modo === "demo") return falso(tipo, texto, info);
    try {
      return await chamar(MODELO, tipo, texto, info);
    } catch (e) {
      // sem cota ou modelo indisponível: tenta o modelo mais leve antes de desistir
      if (/429|RESOURCE_EXHAUSTED|quota|404|not found|unavailable|503/i.test(`${e && e.code} ${e && e.message}`)) {
        try {
          return await chamar(RESERVA, tipo, texto, info);
        } catch (e2) {
          throw erroAmigavel(e2);
        }
      }
      throw erroAmigavel(e);
    }
  }

  /* ------------------------------------------------ demonstração: respostas de mentira */
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  function nomesDo(texto) {
    const nomes = [];
    String(texto).replace(/^- ([^()\n]+) \(id: ([a-z0-9-]+)\)/gm, (_, nome, id) => nomes.push({ nome: nome.trim(), id }));
    String(texto).replace(/^- ([a-z0-9-]+): ([^;\n]+);/gm, (_, id, nome) => nomes.push({ nome: nome.trim(), id }));
    return nomes;
  }
  async function falso(tipo, texto, info) {
    await espera(700);
    if (tipo === "historia") {
      const n = Number((/Capítulo (\d+)/.exec(texto) || [])[1]) || 1;
      const batida = (/PRECISA CONTAR \(arco planejado\): ([^.\n]+)\.? ?([^\n]*)/.exec(texto) || []);
      const [heroi = { nome: "o herói" }, outro = { nome: "o rival" }] = nomesDo(texto);
      const titulo = batida[1] || `Capítulo ${n}`;
      const historia = [
        `[Texto de demonstração, sem IA.] Capítulo ${n}: ${titulo}.`,
        `${heroi.nome} acorda antes do sol, com a sensação de que algo vai mudar.`,
        batida[2] || "O dia começa como qualquer outro, mas um aviso chega pela estrada.",
        `No caminho, ${heroi.nome} lembra de tudo o que aconteceu até aqui e respira fundo.`,
        `Do outro lado, ${outro.nome} observa em silêncio, esperando o primeiro erro.`,
        "As pessoas da vila cochicham. Ninguém acredita que alguém tão jovem possa resolver isso.",
        `${heroi.nome} não discute. Ajeita o cinto, firma o passo e segue em frente.`,
        "Cada passo parece mais pesado que o anterior, mas a decisão já foi tomada.",
        "Quando a poeira baixa, todos percebem que nada mais será como antes.",
        `E, no último instante, ${outro.nome} faz um movimento que ninguém esperava.`,
        "O que vem agora vai mudar o destino de todos.",
      ].join(" ");
      return { titulo, historia, resumo: `${heroi.nome} enfrenta o capítulo ${n}. ${outro.nome} prepara uma surpresa.`, novos_personagens: [], novos_cenarios: [] };
    }
    if (tipo === "quadros") {
      const narracao = String(texto).split("NARRAÇÃO:\n")[1] || "";
      const frases = narracao.match(/[^.!?]+[.!?]+/g) || [narracao];
      const alvo = Math.max(1, Math.min(frases.length, Number((/em (\d+) a/.exec(texto) || [])[1]) || 9));
      const porQuadro = Math.ceil(frases.length / alvo);
      const nomes = nomesDo(texto);
      const quadros = [];
      for (let i = 0; i < frases.length; i += porQuadro) {
        const trecho = frases.slice(i, i + porQuadro).join(" ").trim();
        quadros.push({
          trecho,
          personagens: nomes.filter((p) => trecho.includes(p.nome) && info.personagens.includes(p.id)).map((p) => p.id),
          acao_en: `[demo] scene for: ${trecho.slice(0, 80)}`,
          enquadramento_en: i === 0 ? "wide establishing shot" : i % 2 ? "medium shot" : "close-up",
        });
      }
      return { quadros };
    }
    if (tipo === "fichas") {
      const fichas = [];
      String(texto).replace(/^- id ([a-z0-9-]+) \([^)]*\): (.*)$/gm, (_, id, desc) => fichas.push({ id, ficha_en: `[demo EN] ${desc}` }));
      const evitar = (/campo evitar_en\): (.*)$/m.exec(texto) || [])[1] || "";
      return { fichas, evitar_en: evitar ? `[demo EN] ${evitar}` : "" };
    }
    if (tipo === "arco") {
      const meta = Number((/em (\d+) capítulos/.exec(texto) || [])[1]) || 50;
      const arco = Array.from({ length: meta }, (_, i) => ({ n: i + 1, titulo: `Capítulo ${i + 1} (demonstração)`, resumo: "Resumo de exemplo: a IA de verdade escreve o plano da série." }));
      return { arco };
    }
    throw new Error(`pedido desconhecido: ${tipo}`);
  }

  window.IA = { gerar, MODELO, RESERVA };
})();
