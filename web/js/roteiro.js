"use strict";
/* Roteiro com IA: séries com "bíblia" (personagens, cenários, estilo), arco de capítulos,
   história de cada capítulo e os prompts de imagem de cada quadro.
   Regra de ouro da continuidade: a IA só diz O QUE acontece em cada quadro; a aparência e a roupa
   de cada personagem entram no prompt copiadas da bíblia, palavra por palavra (montarPrompt).
   Assim o personagem do capítulo 1 é o mesmo do capítulo 50.
   É puro (sem banco, sem IA, sem relógio): monta telas, valida, devolve mudanças e escreve os
   pedidos que o navegador manda ao Gemini (js/ia.js). Roda no navegador e no Node (testes). */
(function (raiz) {
  const M = typeof module !== "undefined" && module.exports ? require("./motor.js") : raiz.Motor;
  const { Invalido, isoBR, slugDe, texto } = M;

  const META_PADRAO = 50;
  const LIMITE_SERIES = 20;
  const PALAVRAS_POR_SEGUNDO = 2.5; // narração em português, ritmo de Shorts
  const L = {
    nome: 60, premissa: 2000, regras: 3000, estilo: 600, evitar: 400, campo: 400, ficha: 700, personagens: 30,
    cenarios: 30, arco: 200, historia: 5000, titulo: 80, resumo: 600, ideia: 600, quadros: 20, trecho: 800,
    acao: 700, enquadramento: 240,
  };
  const ESTILO_PADRAO = "vertical 9:16 illustration, consistent character design across panels, clean line art, cinematic lighting, no text, no logos, no watermark";

  const idCapitulo = (serie, n) => `${serie}--${String(n).padStart(3, "0")}`;

  /** Impressão digital curta de um texto (para saber se os prompts ainda batem com a história). */
  function hashTexto(s) {
    let h = 0x811c9dc5;
    const t = String(s || "");
    for (let i = 0; i < t.length; i += 1) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  const palavras = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
  const fichaDe = (item) => String(item.ficha_en || "").trim() || [item.aparencia, item.roupas, item.descricao].filter(Boolean).join("; ");
  const baseFicha = (item) => hashTexto([item.nome, item.aparencia, item.roupas, item.descricao].join("|"));
  const fichaEmDia = (item) => Boolean(item.ficha_en) && item.ficha_de === baseFicha(item);

  /* ------------------------------------------------------------ prompt de cada quadro */

  /** Prompt de imagem de um quadro: estilo + ação + ficha fixa de cada personagem + cenário. */
  function montarPrompt(serie, quadro) {
    const pers = (quadro.personagens || []).map((id) => (serie.personagens || []).find((p) => p.id === id)).filter(Boolean);
    const cen = (serie.cenarios || []).find((c) => c.id === quadro.cenario);
    const evitar = String(serie.evitar_en || serie.evitar || "").trim();
    return [
      String(serie.estilo || ESTILO_PADRAO).trim(),
      quadro.acao_en ? `Scene: ${String(quadro.acao_en).trim()}` : "",
      quadro.enquadramento_en ? `Framing: ${String(quadro.enquadramento_en).trim()}` : "",
      ...pers.map((p) => `${p.nome}: ${fichaDe(p)}`),
      cen ? `Setting, ${cen.nome}: ${fichaDe(cen)}` : "",
      evitar ? `Avoid: ${evitar}` : "",
    ].filter(Boolean).join("\n");
  }

  /* ------------------------------------------------------------ formato vindo do canal */

  function formatoDo(canal) {
    const f = (canal || {}).formato || {};
    const dur = Array.isArray(f.short_segundos) && f.short_segundos.length === 2 ? f.short_segundos : [61, 80];
    return {
      duracao: dur,
      palavras: [f.palavras_min || Math.round(dur[0] * PALAVRAS_POR_SEGUNDO), f.palavras_max || Math.round(dur[1] * PALAVRAS_POR_SEGUNDO)],
      quadros: [f.cenas_min || 8, f.cenas_max || 12],
    };
  }

  /* ------------------------------------------------------------ validação */

  function lista(valor) {
    return Array.isArray(valor) ? valor : [];
  }
  function limparPersonagens(bruto, antigos) {
    const usados = new Set();
    return lista(bruto).slice(0, L.personagens).map((p) => {
      const nome = texto(p.nome, L.nome);
      if (nome.length < 1) return null;
      let id = /^[a-z0-9][a-z0-9-]{0,40}$/.test(p.id || "") ? p.id : slugDe(nome);
      for (let i = 2; usados.has(id); i += 1) id = `${slugDe(nome)}-${i}`;
      usados.add(id);
      const antigo = (antigos || []).find((x) => x.id === id) || {};
      const item = {
        id, nome, aparencia: texto(p.aparencia, L.campo), roupas: texto(p.roupas, L.campo),
        personalidade: texto(p.personalidade, L.campo), ficha: texto(p.ficha ?? antigo.ficha, 200),
        ficha_en: texto(p.ficha_en ?? antigo.ficha_en, L.ficha), ficha_de: texto(p.ficha_de ?? antigo.ficha_de, 16),
      };
      return item;
    }).filter(Boolean);
  }
  function limparCenarios(bruto, antigos) {
    const usados = new Set();
    return lista(bruto).slice(0, L.cenarios).map((c) => {
      const nome = texto(c.nome, L.nome);
      if (!nome) return null;
      let id = /^[a-z0-9][a-z0-9-]{0,40}$/.test(c.id || "") ? c.id : slugDe(nome);
      for (let i = 2; usados.has(id); i += 1) id = `${slugDe(nome)}-${i}`;
      usados.add(id);
      const antigo = (antigos || []).find((x) => x.id === id) || {};
      return {
        id, nome, descricao: texto(c.descricao, L.campo),
        ficha_en: texto(c.ficha_en ?? antigo.ficha_en, L.ficha), ficha_de: texto(c.ficha_de ?? antigo.ficha_de, 16),
      };
    }).filter(Boolean);
  }
  function limparArco(bruto, meta) {
    const vistos = new Set();
    return lista(bruto).map((a) => ({ n: Number(a.n), titulo: texto(a.titulo, L.titulo), resumo: texto(a.resumo, L.resumo) }))
      .filter((a) => Number.isInteger(a.n) && a.n >= 1 && a.n <= meta && (a.titulo || a.resumo) && !vistos.has(a.n) && vistos.add(a.n))
      .sort((x, y) => x.n - y.n).slice(0, L.arco);
  }

  /* ------------------------------------------------------------ ações */

  function criarSerie(e, corpo, agora) {
    const series = e.series || {};
    if (Object.keys(series).length >= LIMITE_SERIES) throw new Invalido(`Cada estúdio pode ter até ${LIMITE_SERIES} séries.`, 409);
    const erros = {};
    const nome = texto(corpo.nome, L.nome);
    if (nome.length < 2) erros.nome = "de 2 a 60 letras";
    const canal = e.canais[corpo.canal];
    if (!canal) erros.canal = "escolha um canal";
    const meta = corpo.meta === undefined || corpo.meta === "" ? META_PADRAO : Number(corpo.meta);
    if (!Number.isInteger(meta) || meta < 1 || meta > 200) erros.meta = "de 1 a 200 capítulos";
    if (Object.keys(erros).length) throw new Invalido("Confira os campos marcados.", 422, { erros });
    let id = slugDe(nome);
    for (let i = 2; series[id]; i += 1) id = `${slugDe(nome)}-${i}`;
    const visual = canal.estilo_visual || {};
    const personagens = limparPersonagens((canal.personagens || []).map((p) => ({
      id: p.id, nome: p.nome || p.id.charAt(0).toUpperCase() + p.id.slice(1), aparencia: p.aparencia || p.descricao || "",
      roupas: p.roupas || "", personalidade: p.personalidade || "", ficha: p.ficha || "",
    })), []);
    const serie = {
      nome, canal: canal.slug, premissa: texto(corpo.premissa, L.premissa), meta,
      regras: texto(((canal.roteiro || {}).instrucoes) || "", L.regras),
      estilo: texto(visual.prompt_base || ESTILO_PADRAO, L.estilo),
      evitar: texto((visual.evitar || []).join(", "), L.evitar), evitar_en: "", evitar_de: "",
      personagens, cenarios: [], arco: [], criadoEm: isoBR(agora), atualizadoEm: isoBR(agora),
    };
    return { resposta: { id, nome }, mudancas: [{ tipo: "set", col: "series", id, dados: serie, substituir: true }] };
  }

  function salvarSerie(e, id, corpo, agora) {
    const atual = (e.series || {})[id];
    if (!atual) throw new Invalido("série não encontrada", 404);
    const patch = { atualizadoEm: isoBR(agora) };
    const erros = {};
    if ("premissa" in corpo) patch.premissa = texto(corpo.premissa, L.premissa);
    if ("regras" in corpo) patch.regras = texto(corpo.regras, L.regras);
    if ("estilo" in corpo) {
      patch.estilo = texto(corpo.estilo, L.estilo);
      if (patch.estilo.length < 10) erros.estilo = "descreva o estilo (mínimo 10 letras)";
    }
    if ("evitar" in corpo) patch.evitar = texto(corpo.evitar, L.evitar);
    if ("evitar_en" in corpo) {
      patch.evitar_en = texto(corpo.evitar_en, L.evitar);
      patch.evitar_de = hashTexto("evitar" in corpo ? patch.evitar : atual.evitar);
    }
    if ("meta" in corpo) {
      const meta = Number(corpo.meta);
      if (!Number.isInteger(meta) || meta < 1 || meta > 200) erros.meta = "de 1 a 200 capítulos";
      else patch.meta = meta;
    }
    if ("personagens" in corpo) patch.personagens = limparPersonagens(corpo.personagens, atual.personagens);
    if ("cenarios" in corpo) patch.cenarios = limparCenarios(corpo.cenarios, atual.cenarios);
    if ("arco" in corpo) patch.arco = limparArco(corpo.arco, patch.meta || atual.meta || META_PADRAO);
    if (Object.keys(erros).length) throw new Invalido("Confira os campos marcados.", 422, { erros });
    // ficha em inglês vinda da IA: só vale para o texto que ela traduziu
    if (corpo.fichas && typeof corpo.fichas === "object") {
      const aplicar = (itens) => itens.map((it) => {
        const f = corpo.fichas[it.id];
        return typeof f === "string" && f.trim() ? { ...it, ficha_en: texto(f, L.ficha), ficha_de: baseFicha(it) } : it;
      });
      patch.personagens = aplicar(patch.personagens || atual.personagens || []);
      patch.cenarios = aplicar(patch.cenarios || atual.cenarios || []);
    }
    return { resposta: { id }, mudancas: [{ tipo: "set", col: "series", id, dados: patch }] };
  }

  function salvarCapitulo(e, serieId, n, corpo, agora) {
    const serie = (e.series || {})[serieId];
    if (!serie) throw new Invalido("série não encontrada", 404);
    const num = Number(n);
    if (!Number.isInteger(num) || num < 1 || num > (serie.meta || META_PADRAO)) throw new Invalido("capítulo fora da série", 422);
    const id = idCapitulo(serieId, num);
    const atual = (e.capitulos || {})[id];
    const patch = { serie: serieId, n: num, atualizadoEm: isoBR(agora) };
    if (!atual) patch.criadoEm = isoBR(agora);
    if ("titulo" in corpo) patch.titulo = texto(corpo.titulo, L.titulo);
    if ("historia" in corpo) patch.historia = texto(corpo.historia, L.historia);
    if ("resumo" in corpo) patch.resumo = texto(corpo.resumo, L.resumo);
    if ("ideia" in corpo) patch.ideia = texto(corpo.ideia, L.ideia);
    if ("quadros" in corpo) {
      const pers = new Set((serie.personagens || []).map((p) => p.id));
      const cens = new Set((serie.cenarios || []).map((c) => c.id));
      patch.quadros = lista(corpo.quadros).slice(0, L.quadros).map((q) => ({
        trecho: texto(q.trecho, L.trecho),
        personagens: [...new Set(lista(q.personagens).filter((p) => pers.has(p)))],
        cenario: cens.has(q.cenario) ? q.cenario : "",
        acao_en: texto(q.acao_en, L.acao),
        enquadramento_en: texto(q.enquadramento_en, L.enquadramento),
      })).filter((q) => q.acao_en || q.trecho);
      // os quadros valem para a história de onde saíram (se a história mudar, ficam desatualizados)
      patch.quadros_de = hashTexto("para" in corpo ? texto(corpo.para, L.historia) : (patch.historia ?? (atual || {}).historia));
    }
    return { resposta: { id, n: num }, mudancas: [{ tipo: "set", col: "capitulos", id, dados: patch }] };
  }

  function adicionarPersonagem(e, serieId, corpo, agora) {
    const serie = (e.series || {})[serieId];
    if (!serie) throw new Invalido("série não encontrada", 404);
    const tipo = corpo.tipo === "cenario" ? "cenarios" : "personagens";
    const atuais = serie[tipo] || [];
    const novo = tipo === "cenarios"
      ? limparCenarios([...atuais, { nome: corpo.nome, descricao: corpo.descricao || corpo.aparencia }], atuais)
      : limparPersonagens([...atuais, { nome: corpo.nome, aparencia: corpo.aparencia, roupas: corpo.roupas, personalidade: corpo.personalidade }], atuais);
    if (novo.length === atuais.length) throw new Invalido("não deu para adicionar (nome vazio ou limite cheio)", 422);
    return { resposta: { id: novo[novo.length - 1].id }, mudancas: [{ tipo: "set", col: "series", id: serieId, dados: { [tipo]: novo, atualizadoEm: isoBR(agora) } }] };
  }

  /* ------------------------------------------------------------ tela */

  function capitulosDa(e, serieId) {
    return Object.values(e.capitulos || {}).filter((c) => c.serie === serieId).sort((a, b) => a.n - b.n);
  }

  function telaRoteiro(e, consulta) {
    const series = Object.entries(e.series || {}).sort((a, b) => (a[1].criadoEm || "").localeCompare(b[1].criadoEm || ""));
    const canalJson = (id) => {
      const c = e.canais[id];
      return { id, nome: c ? c.nome : id, cor: c ? c.cor : "#56676A" };
    };
    const base = {
      ia: Boolean((e.conexao || {}).ia),
      canais: Object.values(e.canais).map((c) => ({ id: c.slug, nome: c.nome })),
      series: series.map(([id, s]) => ({ id, nome: s.nome, canal: canalJson(s.canal), capitulos: capitulosDa(e, id).length, meta: s.meta || META_PADRAO })),
      serie: null, capitulos: [], cap: null,
    };
    const escolhida = consulta.get("serie") && (e.series || {})[consulta.get("serie")] ? consulta.get("serie") : (series[0] || [])[0];
    if (!escolhida) return base;
    const s = e.series[escolhida];
    const caps = capitulosDa(e, escolhida);
    const meta = s.meta || META_PADRAO;
    const pedido = Number(consulta.get("cap"));
    const proximo = Math.min(meta, (caps.length ? caps[caps.length - 1].n : 0) + 1);
    const n = Number.isInteger(pedido) && pedido >= 1 && pedido <= meta ? pedido : proximo;
    const cap = (e.capitulos || {})[idCapitulo(escolhida, n)] || { n, titulo: "", historia: "", resumo: "", ideia: "", quadros: [] };
    const formato = formatoDo(e.canais[s.canal]);
    const historia = cap.historia || "";
    const nPal = palavras(historia);
    const pendentes = [...(s.personagens || []), ...(s.cenarios || [])].filter((it) => !fichaEmDia(it)).length
      + (s.evitar && s.evitar_de !== hashTexto(s.evitar) ? 1 : 0);
    return {
      ...base,
      serie: {
        id: escolhida, nome: s.nome, canal: canalJson(s.canal), premissa: s.premissa || "", regras: s.regras || "",
        estilo: s.estilo || "", evitar: s.evitar || "", evitar_en: s.evitar_en || "", meta,
        personagens: (s.personagens || []).map((p) => ({ ...p, ficha_ok: fichaEmDia(p) })),
        cenarios: (s.cenarios || []).map((c) => ({ ...c, ficha_ok: fichaEmDia(c) })),
        arco: s.arco || [], fichas_pendentes: pendentes,
      },
      capitulos: caps.map((c) => ({ n: c.n, titulo: c.titulo || "", pronto: Boolean(c.historia) })),
      formato,
      cap: {
        n, existe: Boolean((e.capitulos || {})[idCapitulo(escolhida, n)]), titulo: cap.titulo || "", historia, resumo: cap.resumo || "",
        ideia: cap.ideia || "", palavras: nPal, segundos: Math.round(nPal / PALAVRAS_POR_SEGUNDO),
        batida: (s.arco || []).find((a) => a.n === n) || null,
        desatualizado: Boolean(historia) && (cap.quadros || []).length > 0 && cap.quadros_de !== hashTexto(historia),
        sem_quadros: Boolean(historia) && !(cap.quadros || []).length,
        quadros: (cap.quadros || []).map((q, i) => ({
          n: i + 1, trecho: q.trecho || "", prompt: montarPrompt(s, q),
          personagens: (q.personagens || []).map((id) => ((s.personagens || []).find((p) => p.id === id) || {}).nome).filter(Boolean),
          cenario: ((s.cenarios || []).find((c) => c.id === q.cenario) || {}).nome || "",
          referencias: (q.personagens || []).map((id) => ((s.personagens || []).find((p) => p.id === id) || {}).ficha).filter(Boolean),
        })),
      },
    };
  }

  /* ------------------------------------------------------------ pedidos para a IA */

  const linhaPersonagem = (p) => `- ${p.nome} (id: ${p.id}): aparência: ${p.aparencia || "—"}; roupas: ${p.roupas || "—"}; personalidade: ${p.personalidade || "—"}`;
  const linhaCenario = (c) => `- ${c.nome} (id: ${c.id}): ${c.descricao || "—"}`;

  function exigirSerie(e, serieId) {
    const s = (e.series || {})[serieId];
    if (!s) throw new Invalido("série não encontrada", 404);
    return s;
  }

  /** Texto do pedido do capítulo n: bíblia + arco + resumo de tudo que já aconteceu + capítulo anterior inteiro. */
  function pedidoHistoria(e, serieId, n, ideia) {
    const s = exigirSerie(e, serieId);
    const meta = s.meta || META_PADRAO;
    const f = formatoDo(e.canais[s.canal]);
    const caps = capitulosDa(e, serieId).filter((c) => c.n < n && c.historia);
    const anterior = caps[caps.length - 1];
    const batida = (s.arco || []).find((a) => a.n === n);
    const vizinhos = (s.arco || []).filter((a) => a.n > n && a.n <= n + 3);
    return [
      `SÉRIE: ${s.nome}. Capítulo ${n} de ${meta}.`,
      s.premissa ? `PREMISSA: ${s.premissa}` : "",
      s.regras ? `REGRAS DA SÉRIE (obrigatórias): ${s.regras}` : "",
      "BÍBLIA DA SÉRIE (não mude aparência, roupas nem personalidade de ninguém):",
      ...(s.personagens || []).map(linhaPersonagem),
      ...(s.cenarios || []).length ? ["Cenários:", ...(s.cenarios || []).map(linhaCenario)] : [],
      batida ? `O QUE ESTE CAPÍTULO PRECISA CONTAR (arco planejado): ${batida.titulo}. ${batida.resumo}` : "",
      vizinhos.length ? `PRÓXIMOS CAPÍTULOS PLANEJADOS (não adiante): ${vizinhos.map((a) => `${a.n}. ${a.titulo}`).join("; ")}` : "",
      caps.length ? "O QUE JÁ ACONTECEU:" : "Este é o primeiro capítulo da série.",
      ...caps.map((c) => `${c.n}. ${c.titulo}: ${c.resumo || c.historia.slice(0, 220)}`),
      anterior ? `CAPÍTULO ANTERIOR COMPLETO (${anterior.n}. ${anterior.titulo}):\n${anterior.historia}` : "",
      ideia ? `DIREÇÃO DO AUTOR PARA ESTE CAPÍTULO: ${texto(ideia, L.ideia)}` : "",
      `FORMATO: narração em português do Brasil com ${f.palavras[0]} a ${f.palavras[1]} palavras (vídeo de ${f.duracao[0]} a ${f.duracao[1]} s). Frases curtas, boas para voz. A primeira frase prende a atenção; a última deixa um gancho para o capítulo ${Math.min(n + 1, meta)}.`,
      "Devolva: titulo (até 60 letras), historia (só a narração), resumo (2 frases: o que mudou na história), novos_personagens e novos_cenarios (só se a história precisou de alguém ou de um lugar que não está na bíblia; senão, listas vazias).",
    ].filter(Boolean).join("\n");
  }

  /** Pedido para dividir a história em quadros (a IA não descreve aparência: isso vem da bíblia). */
  function pedidoQuadros(e, serieId, historia) {
    const s = exigirSerie(e, serieId);
    const f = formatoDo(e.canais[s.canal]);
    return [
      `Divida a narração abaixo em ${f.quadros[0]} a ${f.quadros[1]} quadros de quadrinho vertical, na ordem.`,
      "Para cada quadro devolva:",
      "- trecho: a(s) frase(s) da narração que o quadro cobre, sem mudar o texto;",
      "- personagens: ids de quem aparece na imagem (só da lista abaixo; lista vazia se ninguém aparece);",
      "- cenario: id do cenário (da lista; vazio se nenhum serve);",
      "- acao_en: em inglês, o que se vê: ação, pose, expressão, objetos, luz. NÃO descreva rosto, cabelo, corpo nem roupa dos personagens (isso vem da ficha fixa de cada um);",
      "- enquadramento_en: em inglês, plano e ângulo (ex.: close-up, low angle, wide establishing shot).",
      "Personagens:",
      ...(s.personagens || []).map((p) => `- ${p.id}: ${p.nome}; personalidade: ${p.personalidade || "—"}`),
      ...(s.cenarios || []).length ? ["Cenários:", ...(s.cenarios || []).map((c) => `- ${c.id}: ${c.nome}`)] : ["Cenários: nenhum cadastrado (deixe cenario vazio e descreva o lugar em acao_en)."],
      `NARRAÇÃO:\n${texto(historia, L.historia)}`,
    ].join("\n");
  }

  /** Itens da bíblia cuja ficha em inglês está faltando ou ficou velha. */
  function fichasPendentes(e, serieId) {
    const s = exigirSerie(e, serieId);
    const itens = [
      ...(s.personagens || []).filter((p) => !fichaEmDia(p)).map((p) => ({ id: p.id, tipo: "personagem", nome: p.nome, texto: `aparência: ${p.aparencia}; roupas: ${p.roupas}` })),
      ...(s.cenarios || []).filter((c) => !fichaEmDia(c)).map((c) => ({ id: c.id, tipo: "cenário", nome: c.nome, texto: c.descricao })),
    ];
    return { itens, evitar: s.evitar && s.evitar_de !== hashTexto(s.evitar) ? s.evitar : "" };
  }

  function pedidoFichas(e, serieId) {
    const { itens, evitar } = fichasPendentes(e, serieId);
    return [
      "Escreva, em inglês, uma ficha visual curta (até 45 palavras) para cada item, para um gerador de imagens.",
      "Só o que se vê e não muda: idade aparente, corpo, rosto, cabelo, roupa e acessórios fixos (personagem) ou arquitetura, materiais, luz e época (cenário).",
      "Sem nomes de pessoas reais famosas, sem personalidade abstrata, sem a palavra 'manhwa'. Use o mesmo texto sempre: é a âncora da continuidade.",
      ...itens.map((it) => `- id ${it.id} (${it.tipo} ${it.nome}): ${it.texto}`),
      evitar ? `Traduza também a lista do que evitar nas imagens (campo evitar_en): ${evitar}` : "Campo evitar_en: devolva vazio.",
    ].join("\n");
  }

  function pedidoArco(e, serieId) {
    const s = exigirSerie(e, serieId);
    const meta = s.meta || META_PADRAO;
    const feitos = capitulosDa(e, serieId).filter((c) => c.historia);
    return [
      `Planeje o arco completo da série "${s.nome}" em ${meta} capítulos de vídeo curto (cerca de 1 minuto cada).`,
      s.premissa ? `PREMISSA: ${s.premissa}` : "",
      s.regras ? `REGRAS: ${s.regras}` : "",
      "Personagens:", ...(s.personagens || []).map(linhaPersonagem),
      feitos.length ? "Capítulos já escritos (mantenha exatamente estes):" : "",
      ...feitos.map((c) => `${c.n}. ${c.titulo}: ${c.resumo || ""}`),
      `Cada capítulo avança a história, tem um acontecimento claro e termina pedindo o próximo. Distribua começo, meio, virada e final nos ${meta}.`,
      `Devolva arco: uma lista com n (1 a ${meta}), titulo (até 60 letras) e resumo (1 frase) de cada capítulo.`,
    ].filter(Boolean).join("\n");
  }

  const PEDIDOS = {
    historia: (e, c) => pedidoHistoria(e, c.get("serie"), Number(c.get("cap")), c.get("ideia") || ""),
    quadros: (e, c) => pedidoQuadros(e, c.get("serie"), c.get("historia") || ""),
    fichas: (e, c) => pedidoFichas(e, c.get("serie")),
    arco: (e, c) => pedidoArco(e, c.get("serie")),
  };

  /** GET /api/roteiro/pedido?tipo=historia|fichas|arco&serie=…  -> { texto, ids } para o js/ia.js */
  function telaPedido(e, consulta) {
    const tipo = consulta.get("tipo");
    if (!PEDIDOS[tipo]) throw new Invalido("pedido desconhecido", 404);
    const s = exigirSerie(e, consulta.get("serie"));
    return {
      tipo, texto: PEDIDOS[tipo](e, consulta),
      personagens: (s.personagens || []).map((p) => p.id), cenarios: (s.cenarios || []).map((c) => c.id),
      meta: s.meta || META_PADRAO,
    };
  }

  const SERIE = "([a-z0-9][a-z0-9-]{0,40})";
  M.registrar(
    { "/api/roteiro": telaRoteiro, "/api/roteiro/pedido": telaPedido },
    [
      [/^\/api\/series$/, (e, m, c, a) => criarSerie(e, c, a)],
      [new RegExp(`^/api/series/${SERIE}$`), (e, m, c, a) => salvarSerie(e, m[1], c, a)],
      [new RegExp(`^/api/series/${SERIE}/itens$`), (e, m, c, a) => adicionarPersonagem(e, m[1], c, a)],
      [new RegExp(`^/api/capitulos/${SERIE}/(\\d{1,3})$`), (e, m, c, a) => salvarCapitulo(e, m[1], m[2], c, a)],
    ],
  );

  const Roteiro = {
    META_PADRAO, ESTILO_PADRAO, idCapitulo, hashTexto, palavras, montarPrompt, formatoDo, pedidoHistoria, pedidoQuadros,
    pedidoFichas, pedidoArco, fichasPendentes, fichaEmDia, baseFicha,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Roteiro;
  else raiz.Roteiro = Roteiro;
})(typeof window !== "undefined" ? window : globalThis);
