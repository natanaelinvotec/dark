"use strict";
/* Motor do painel: as regras do estúdio, sem servidor.
   Recebe o "estado" (o que está no Firestore, ou no exemplo do navegador) e:
   - get(caminho)  -> monta a tela pedida (o mesmo JSON que o painel sempre usou);
   - post(caminho) -> valida o pedido e devolve { resposta, mudancas } para gravar.
   É puro (não lê relógio nem banco por conta própria): roda no navegador e no Node (testes). */
(function (raiz) {
  const OFFSET = "-03:00"; // Brasília, sem horário de verão desde 2019
  const ETAPAS = ["pauta", "roteiro", "checagem", "quadros", "gancho", "voz", "montagem", "testes"];
  const ACOES = ["aprovar", "refazer", "rejeitar", "desfazer"];
  const ORIGEM = { aprovar: ["fila"], refazer: ["fila", "reprovado"], rejeitar: ["fila", "reprovado", "voce"] };
  const DESTINO = { aprovar: "aprovado", refazer: "refazer", rejeitar: "rejeitado" };
  const EM_PRODUCAO = ["pauta", "produzindo", "voce", "refazer"];
  const ABAS = {
    fila: ["Na fila", (v) => v.status === "fila" || v.status === "reprovado"],
    prontos: ["Prontos", (v) => v.status === "fila"],
    reprovados: ["Para refazer", (v) => v.status === "reprovado"],
    agendados: ["Agendados", (v) => v.status === "aprovado"],
  };
  const ABAS_PUBLICAR = { pendentes: "Para publicar", feitos: "Publicados (14 dias)" };
  const SITUACOES_CONTA = ["planejada", "criada", "crescendo", "monetizando", "pausada"];
  const SITUACOES_PUBLICACAO = ["pendente", "publicado", "pulado"];
  const RESOLVIDAS = ["publicado", "pulado"];
  const FAIXAS_CONFIG = {
    teto_mes_brl: [0, 10000],
    preco_entrada_milhao_brl: [0, 10000],
    preco_saida_milhao_brl: [0, 10000],
    preco_tts_milhao_chars_brl: [0, 10000],
    preco_ai_pro_brl: [0, 2000],
    cambio_usd_brl: [1, 20],
    creditos_flow_restantes: [0, 100000],
    creditos_flow_total: [1, 100000],
  };
  const NIVEL_ORDEM = { cr: 0, at: 1, in: 2 };
  const JANELA_PUBLICAR_DIAS = 30;
  const NUMERO_MAX = 1e12;
  const DIA = 86400e3;
  const ID_VIDEO = "([a-f0-9]{6,40})";
  const SLUG = "([a-z0-9][a-z0-9-]{0,40})";
  const UID = "([A-Za-z0-9_-]{1,128})";
  const VERSAO = "3.0";
  const LIMITE_CANAIS = 10;
  const LIMITE_CONVIDADOS = 200;
  const DURACAO_FAIXA = [15, 180];
  const DURACAO_PADRAO = [61, 80];
  const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
  const COR = /^#[0-9a-fA-F]{6}$/;
  const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,185}\.[a-z]{2,24}$/i;
  // o que um canal herda do modelo (o resto vem do formulário)
  const DO_MODELO = ["idioma", "formato", "producao", "roteiro", "estilo_visual", "personagens", "janela_de_missao", "busca_visual_padrao", "sistema"];

  class Invalido extends Error {
    constructor(mensagem, status = 422, dados = undefined) {
      super(mensagem);
      this.status = status;
      this.dados = dados;
    }
  }

  /* ------------------------------------------------------------ tempo e números */

  const pad = (n) => String(n).padStart(2, "0");
  function isoBR(data) {
    const t = new Date(data.getTime() - 3 * 3600e3);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${OFFSET}`;
  }
  const diaBR = (data) => isoBR(data).slice(0, 10);
  const mesBR = (data) => isoBR(data).slice(0, 7);
  const ms = (iso) => (iso ? new Date(iso).getTime() : NaN);
  const somarDias = (dia, n) => diaBR(new Date(new Date(`${dia}T12:00:00${OFFSET}`).getTime() + n * DIA));
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const arred = (n, casas = 1) => Math.round(n * 10 ** casas) / 10 ** casas;
  const virgula = (n) => n.toFixed(1).replace(".", ",");
  const lista = (obj) => Object.values(obj || {});
  function novoId() {
    const b = new Uint8Array(6);
    raiz.crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  /* ------------------------------------------------------------ mudanças */

  const set = (col, id, dados) => ({ tipo: "set", col, id, dados });
  const trocar = (col, id, dados) => ({ tipo: "set", col, id, dados, substituir: true });
  const apagar = (col, id) => ({ tipo: "del", col, id });
  const add = (col, dados) => ({ tipo: "add", col, dados });
  const cfg = (dados) => ({ tipo: "config", dados });
  const evento = (agora, etapa, alvo, msg, nivel) =>
    add("eventos", { ts: isoBR(agora), n: agora.getTime(), etapa, alvo, msg, nivel });

  function mesclar(destino, origem) {
    for (const [k, v] of Object.entries(origem)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        destino[k] = mesclar(destino[k] && typeof destino[k] === "object" ? destino[k] : {}, v);
      } else {
        destino[k] = v;
      }
    }
    return destino;
  }

  /** Aplica as mudanças no estado em memória (o banco recebe as mesmas mudanças). */
  function aplicar(estado, mudancas) {
    for (const m of mudancas) {
      if (m.tipo === "set") {
        estado[m.col] = estado[m.col] || {};
        const copia = JSON.parse(JSON.stringify(m.dados));
        estado[m.col][m.id] = m.substituir ? copia : mesclar(estado[m.col][m.id] || {}, copia);
      } else if (m.tipo === "del") {
        if (estado[m.col]) delete estado[m.col][m.id];
      } else if (m.tipo === "add") {
        estado[m.col] = estado[m.col] || [];
        estado[m.col].unshift(JSON.parse(JSON.stringify(m.dados)));
      } else if (m.tipo === "config") {
        estado.config = mesclar(estado.config || {}, JSON.parse(JSON.stringify(m.dados)));
      }
    }
    return estado;
  }

  /* ------------------------------------------------------------ canais e configuração */

  const canalJson = (e, id) => {
    const c = e.canais[id];
    return { id, nome: c ? c.nome : id, cor: c ? c.cor : "#56676A" };
  };
  const ligado = (e, id) => {
    const c = e.canais[id];
    return Boolean(c && c.ligado !== false);
  };
  const config = (e, chave) => num((e.config || {})[chave]);
  const metricaCanal = (e, canal, chave) => num((((e.config || {}).metricas || {}).por_canal || {})[canal]?.[chave]);
  const metrica = (e, chave) => num(((e.config || {}).metricas || {})[chave]);
  const teto = (e) => config(e, "teto_mes_brl") ?? 150;
  const plataformasDoCanal = (e, canal) =>
    (canal.plataformas || []).map((id) => e.plataformas.plataformas.find((p) => p.id === id)).filter(Boolean);
  const titulo = (v) => v.titulo || v.tema || "";
  const somaViews = (e, desde, ate, canal) =>
    (e.metricas || []).filter((m) => m.data >= desde && m.data < ate && (!canal || m.canal === canal))
      .reduce((s, m) => s + (Number(m.views) || 0), 0);
  const gastoMes = (e, mes, fornecedores) =>
    (e.custos || []).filter((c) => c.mes === mes && (!fornecedores || fornecedores.includes(c.fornecedor)))
      .reduce((s, c) => s + (Number(c.valor) || 0), 0);

  /* ------------------------------------------------------------ horários e ações da fila */

  function proximoHorario(e, canal, agora, dias = 14) {
    const ocupados = new Set(
      lista(e.videos).filter((v) => v.canal === canal.slug && v.horario && ["aprovado", "publicado"].includes(v.status))
        .map((v) => v.horario),
    );
    const limite = agora.getTime() + 30 * 60e3;
    const hoje = diaBR(agora);
    for (let i = 0; i < dias; i += 1) {
      const dia = somarDias(hoje, i);
      for (const hora of [...canal.horarios].sort()) {
        const candidato = `${dia}T${hora}:00${OFFSET}`;
        if (ms(candidato) >= limite && !ocupados.has(candidato)) return candidato;
      }
    }
    return null;
  }

  function executarAcao(e, id, corpo, agora) {
    const v = e.videos[id];
    if (!v) throw new Invalido("vídeo não encontrado", 404);
    const acao = corpo.acao;
    if (!ACOES.includes(acao)) throw new Invalido(`ação desconhecida: ${acao}`, 422);
    const nota = String(corpo.nota || "").slice(0, 500);
    if (acao === "desfazer") return desfazer(e, v, agora);
    if (!ORIGEM[acao].includes(v.status)) throw new Invalido(`não dá para ${acao} um vídeo com status '${v.status}'`, 409);

    const patch = { status: DESTINO[acao], atualizadoEm: isoBR(agora) };
    if (acao === "aprovar") {
      const canal = e.canais[v.canal];
      if (!canal) throw new Invalido("canal do vídeo não está configurado", 409);
      const horario = proximoHorario(e, canal, agora);
      if (!horario) throw new Invalido("nenhum horário livre nos próximos 14 dias", 409);
      patch.horario = horario;
      const r = num(corpo.revisao_s);
      if (r !== null && r > 0 && r < 6 * 3600) patch.revisaoS = arred(r, 1);
    }
    if (acao === "refazer") patch.notaRefazer = nota.trim();
    return {
      resposta: { id, status: patch.status, horario: patch.horario ?? v.horario ?? null },
      mudancas: [
        set("videos", id, patch),
        add("acoes", { ts: isoBR(agora), n: agora.getTime(), video: id, acao, nota, de: v.status, para: patch.status }),
        evento(agora, "fila", id, `${acao}: ${titulo(v)}`, "info"),
      ],
    };
  }

  function desfazer(e, v, agora) {
    const ultima = (e.acoes || []).filter((a) => a.video === v.id && a.acao !== "desfazer").sort((a, b) => b.n - a.n)[0];
    if (!ultima || ultima.para !== v.status) throw new Invalido("nada para desfazer", 409);
    const patch = { status: ultima.de, atualizadoEm: isoBR(agora) };
    if (ultima.acao === "aprovar") patch.horario = null;
    if (ultima.acao === "refazer") patch.notaRefazer = "";
    return {
      resposta: { id: v.id, status: patch.status, horario: patch.horario === null ? null : v.horario ?? null },
      mudancas: [
        set("videos", v.id, patch),
        add("acoes", { ts: isoBR(agora), n: agora.getTime(), video: v.id, acao: "desfazer", nota: "", de: v.status, para: ultima.de }),
      ],
    };
  }

  function pularGancho(e, id, agora) {
    const v = e.videos[id];
    if (!v) throw new Invalido("vídeo não encontrado", 404);
    if (((v.etapas || {}).gancho || {}).status !== "voce") throw new Invalido("o gancho deste vídeo não está esperando você", 409);
    return {
      resposta: { ok: true },
      mudancas: [
        set("videos", id, { status: "produzindo", atualizadoEm: isoBR(agora), etapas: { gancho: { status: "pulado", nota: "seguiu sem gancho" } } }),
        evento(agora, "gancho", id, "seguiu sem gancho animado", "info"),
      ],
    };
  }

  function texto(valor, max) {
    return String(valor ?? "").trim().slice(0, max);
  }

  function videoNovo(id, canal, campos, agora, etapaPadrao) {
    const etapas = {};
    ETAPAS.forEach((et) => { etapas[et] = { status: et === "pauta" ? "feito" : etapaPadrao, nota: "" }; });
    return {
      id, canal, titulo: "", tema: "", serie: "", referencia: "", status: "pauta", roteiro: null,
      duracao: null, horario: null, aviso: "", notaRefazer: "", revisaoS: null, driveId: null,
      etapas, testes: [], publicacoes: {}, criadoEm: isoBR(agora), atualizadoEm: isoBR(agora), ...campos,
    };
  }

  function criarLote(e, corpo, agora) {
    const canal = e.canais[corpo.canal];
    const erros = {};
    if (!canal) erros.canal = "canal desconhecido";
    const tema = texto(corpo.tema, 300);
    if (tema.length < 3) erros.tema = "escreva o tema (mínimo 3 letras)";
    const qtd = Number(corpo.qtd);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 10) erros.qtd = "de 1 a 10 vídeos";
    if (Object.keys(erros).length) throw new Invalido("Confira o tema e a quantidade (1 a 10).", 422, { erros });
    const ids = [];
    const mudancas = [];
    for (let i = 0; i < qtd; i += 1) {
      const id = novoId();
      ids.push(id);
      mudancas.push(set("videos", id, videoNovo(id, canal.slug, {
        tema, serie: texto(corpo.serie, 120), referencia: texto(corpo.referencia, 120),
      }, agora, "espera")));
    }
    mudancas.push(evento(agora, "pauta", canal.slug, `lote de ${qtd}: ${tema}`, "info"));
    return { resposta: { ids }, mudancas };
  }

  const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
  function idDoDrive(link) {
    const achado = /\/d\/([A-Za-z0-9_-]{10,100})/.exec(link) || /[?&]id=([A-Za-z0-9_-]{10,100})/.exec(link);
    return achado ? achado[1] : null;
  }

  function testeDuracao(duracao) {
    if (!duracao) return { nome: "Duração p/ monetizar", status: "at", detalhe: "duração não informada" };
    if (duracao < 60) return { nome: "Duração p/ monetizar", status: "at", detalhe: `${Math.round(duracao)} s: o TikTok só paga vídeos com 1 min ou mais` };
    if (duracao > 90) return { nome: "Duração p/ monetizar", status: "at", detalhe: `${Math.round(duracao)} s: Reels pela API aceita até 90 s` };
    return { nome: "Duração p/ monetizar", status: "ok", detalhe: `${Math.round(duracao)} s: dentro da faixa que rende em todas as redes` };
  }

  function adicionarVideo(e, corpo, agora) {
    const canal = e.canais[corpo.canal];
    if (!canal) throw new Invalido("canal desconhecido", 422);
    const nome = texto(corpo.titulo, 120);
    if (nome.length < 3) throw new Invalido("escreva o título (mínimo 3 letras)", 422);
    const link = texto(corpo.link, 300);
    let driveId = null;
    if (link) {
      if (!hostAceito(link, ["drive.google.com", "docs.google.com"])) throw new Invalido("o link precisa ser do Google Drive (https://drive.google.com/…)", 422);
      driveId = idDoDrive(link);
      if (!driveId) throw new Invalido("não reconheci o arquivo nesse link do Drive", 422);
    }
    const duracao = num(corpo.duracao);
    if (duracao !== null && (duracao < 1 || duracao > 600)) throw new Invalido("duração de 1 a 600 segundos", 422);
    const descricaoBruta = texto(corpo.descricao, 1000);
    const hashtags = (descricaoBruta.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 10);
    const descricao = descricaoBruta.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
    const id = novoId();
    const testes = [
      testeDuracao(duracao),
      driveId ? { nome: "Vídeo no Drive", status: "ok", detalhe: "link conferido" } : { nome: "Vídeo no Drive", status: "at", detalhe: "sem link: não dá para assistir nem baixar pelo painel" },
    ];
    return {
      resposta: { id },
      mudancas: [
        set("videos", id, videoNovo(id, canal.slug, {
          titulo: nome, tema: nome, serie: texto(corpo.serie, 120), status: "fila", duracao, driveId,
          roteiro: { descricao, hashtags, fontes: [], janelas: [] }, testes,
        }, agora, "feito")),
        evento(agora, "fila", id, `vídeo adicionado: ${nome}`, "info"),
      ],
    };
  }

  function ligarCanal(e, slug, corpo, agora) {
    const canal = e.canais[slug];
    if (!canal) throw new Invalido("canal não encontrado", 404);
    const valor = corpo.ligado === true;
    return {
      resposta: { ligado: valor },
      mudancas: [set("canais", slug, { ligado: valor, atualizadoEm: isoBR(agora) }), evento(agora, "canal", slug, valor ? "ligado" : "pausado", "info")],
    };
  }

  /* ------------------------------------------------------------ canais criados no painel */

  /** "Histórias da Bíblia!" -> "historias-da-biblia" (vira o id do canal e não muda mais). */
  function slugDe(nome) {
    const s = String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
    return s || "canal";
  }
  function slugLivre(e, base) {
    let slug = base;
    for (let i = 2; e.canais[slug]; i += 1) slug = `${base}-${i}`;
    return slug;
  }
  const idsPlataformas = (e) => e.plataformas.plataformas.map((p) => p.id);
  const duracaoDo = (c) => {
    const d = ((c || {}).formato || {}).short_segundos;
    return Array.isArray(d) && d.length === 2 ? d : DURACAO_PADRAO;
  };

  /** Confere o formulário do canal; devolve os campos limpos ou lança 422 com o erro de cada campo. */
  function validarCanal(e, corpo) {
    const erros = {};
    const nome = texto(corpo.nome, 80);
    if (nome.length < 2 || nome.length > 40) erros.nome = "de 2 a 40 letras";
    const cor = String(corpo.cor || "").trim();
    if (!COR.test(cor)) erros.cor = "escolha uma cor";
    const descricao = texto(corpo.descricao, 400);
    if (descricao.length > 160) erros.descricao = "até 160 letras";
    const horarios = [...new Set((Array.isArray(corpo.horarios) ? corpo.horarios : []).map((h) => String(h ?? "").trim()).filter(Boolean))].sort();
    if (!horarios.length) erros.horarios = "informe pelo menos um horário";
    else if (horarios.length > 4) erros.horarios = "até 4 horários por dia";
    else if (!horarios.every((h) => HORA.test(h))) erros.horarios = "use o formato 12:00";
    const marcadas = new Set(Array.isArray(corpo.plataformas) ? corpo.plataformas : []);
    const plataformas = idsPlataformas(e).filter((id) => marcadas.has(id));
    if (!marcadas.size) erros.plataformas = "marque pelo menos uma rede";
    else if (plataformas.length !== marcadas.size) erros.plataformas = "rede desconhecida";
    const dmin = Number(corpo.duracao_min);
    const dmax = Number(corpo.duracao_max);
    const [piso, teto_] = DURACAO_FAIXA;
    if (![dmin, dmax].every((d) => Number.isInteger(d) && d >= piso && d <= teto_) || dmin > dmax) {
      erros.duracao_min = `de ${piso} a ${teto_} segundos, e o mínimo não pode passar do máximo`;
    }
    if (Object.keys(erros).length) throw new Invalido("Confira os campos marcados.", 422, { erros });
    return { nome, cor: cor.toUpperCase(), descricao, horarios, plataformas, duracao: [dmin, dmax] };
  }

  function criarCanal(e, corpo, agora) {
    if (Object.keys(e.canais).length >= LIMITE_CANAIS) throw new Invalido(`Cada estúdio pode ter até ${LIMITE_CANAIS} canais.`, 409);
    const modelo = corpo.modelo ? (e.modelos || []).find((m) => m.id === corpo.modelo) : null;
    if (corpo.modelo && !modelo) throw new Invalido("modelo desconhecido", 422);
    const v = validarCanal(e, corpo);
    const slug = slugLivre(e, slugDe(v.nome));
    const herdado = {};
    if (modelo) DO_MODELO.filter((k) => k in modelo).forEach((k) => { herdado[k] = JSON.parse(JSON.stringify(modelo[k])); });
    const canal = {
      idioma: "pt-BR", producao: { quadros: "manual", gancho: "nenhum", voz: "tts" }, roteiro: { instrucoes: "" }, personagens: [],
      ...herdado,
      slug, nome: v.nome, cor: v.cor, descricao: v.descricao, horarios: v.horarios, plataformas: v.plataformas,
      formato: { ...(herdado.formato || {}), short_segundos: v.duracao, tiktok_segundos: v.duracao },
      modelo: modelo ? modelo.id : "", ligado: true, criadoEm: isoBR(agora), atualizadoEm: isoBR(agora),
    };
    return {
      resposta: { slug, nome: v.nome },
      mudancas: [trocar("canais", slug, canal), evento(agora, "canal", slug, `canal criado: ${v.nome}`, "ok")],
    };
  }

  function editarCanal(e, slug, corpo, agora) {
    if (!e.canais[slug]) throw new Invalido("canal não encontrado", 404);
    const v = validarCanal(e, corpo);
    const patch = {
      nome: v.nome, cor: v.cor, descricao: v.descricao, horarios: v.horarios, plataformas: v.plataformas,
      formato: { short_segundos: v.duracao, tiktok_segundos: v.duracao }, atualizadoEm: isoBR(agora),
    };
    return {
      resposta: { slug, nome: v.nome },
      mudancas: [set("canais", slug, patch), evento(agora, "canal", slug, "canal editado", "info")],
    };
  }

  /** Só apaga canal sem vídeos (o histórico não pode ficar sem dono); as contas vão junto. */
  function apagarCanal(e, slug, agora) {
    const canal = e.canais[slug];
    if (!canal) throw new Invalido("canal não encontrado", 404);
    const videos = lista(e.videos).filter((v) => v.canal === slug).length;
    if (videos) throw new Invalido(`O canal tem ${videos} vídeo(s). Pause o canal em vez de apagar.`, 409);
    const contas = Object.keys(e.contas || {}).filter((id) => id.startsWith(`${slug}:`));
    return {
      resposta: { ok: true },
      mudancas: [apagar("canais", slug), ...contas.map((id) => apagar("contas", id)), evento(agora, "canal", slug, `canal apagado: ${canal.nome}`, "info")],
    };
  }

  /* ------------------------------------------------------------ dono da plataforma */

  function exigirAdmin(e) {
    if (!(e.conexao || {}).admin) throw new Invalido("Só o dono da plataforma abre esta tela.", 403);
  }

  function telaPlataforma(e) {
    exigirAdmin(e);
    const a = (e.plataforma || {}).acesso || {};
    const voce = (e.conexao || {}).uid;
    return {
      aberto: a.aberto === true,
      convidados: a.convidados || [],
      estudios: Object.entries(e.estudios || {}).map(([uid, s]) => ({
        uid, email: s.email || "", nome: s.nome || "", criado_em: s.criadoEm || null, ativo: s.ativo !== false, voce: uid === voce,
      })).sort((x, y) => (x.criado_em || "").localeCompare(y.criado_em || "")),
    };
  }

  function salvarAcesso(e, corpo, agora) {
    exigirAdmin(e);
    const bruto = Array.isArray(corpo.convidados) ? corpo.convidados.join("\n") : String(corpo.convidados || "");
    const convidados = [...new Set(bruto.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    const ruim = convidados.find((x) => x.length > 254 || !EMAIL.test(x));
    if (ruim) throw new Invalido("Confira os e-mails.", 422, { erros: { convidados: `e-mail inválido: ${ruim}` } });
    if (convidados.length > LIMITE_CONVIDADOS) throw new Invalido("Confira os e-mails.", 422, { erros: { convidados: `até ${LIMITE_CONVIDADOS} convidados` } });
    const dados = { aberto: corpo.aberto === true, convidados, atualizadoEm: isoBR(agora) };
    return { resposta: { aberto: dados.aberto, convidados }, mudancas: [trocar("plataforma", "acesso", dados)] };
  }

  function ativarEstudio(e, uid, corpo) {
    exigirAdmin(e);
    if (!(e.estudios || {})[uid]) throw new Invalido("estúdio não encontrado", 404);
    if (uid === e.conexao.uid) throw new Invalido("Você não pode pausar o próprio estúdio.", 409);
    const ativo = corpo.ativo === true;
    return { resposta: { ativo }, mudancas: [set("estudios", uid, { ativo })] };
  }

  function salvarConfig(e, valores) {
    const erros = {};
    const limpos = {};
    for (const [chave, bruto] of Object.entries(valores || {})) {
      if (!(chave in FAIXAS_CONFIG)) {
        erros[chave] = "campo desconhecido";
        continue;
      }
      const t = String(bruto ?? "").trim().replace(",", ".");
      if (t === "") {
        limpos[chave] = "";
        continue;
      }
      const n = Number(t);
      if (!Number.isFinite(n)) {
        erros[chave] = "precisa ser um número";
        continue;
      }
      const [minimo, maximo] = FAIXAS_CONFIG[chave];
      if (n < minimo || n > maximo) {
        erros[chave] = `entre ${minimo} e ${maximo}`;
        continue;
      }
      limpos[chave] = String(n);
    }
    if (Object.keys(erros).length) throw new Invalido("Confira os campos marcados.", 422, { erros });
    return { resposta: { ok: true }, mudancas: [cfg(limpos)] };
  }

  /* ------------------------------------------------------------ plataformas e publicação */

  function hostAceito(url, dominios) {
    const bruto = String(url || "").trim();
    if (/\\/.test(bruto) || /[\u0000- ]/.test(bruto)) return false;
    let u;
    try {
      u = new URL(bruto);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;
    return dominios.some((d) => host === d || host.endsWith(`.${d}`));
  }

  function elegibilidade(p, duracao) {
    if (!duracao) return ["ne", "duração ainda desconhecida"];
    if (p.duracao_min_s && duracao < p.duracao_min_s) return ["at", `não rende: o programa pede ${p.duracao_min_s} s ou mais`];
    if (p.duracao_max_s && duracao > p.duracao_max_s) return ["at", `passa do limite de ${p.duracao_max_s} s`];
    return ["ok", "a duração conta para o programa"];
  }

  function hashtags(roteiro) {
    return ((roteiro || {}).hashtags || []).map((t) => String(t).trim().replace(/\s+/g, ""))
      .filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  }

  function legenda(p, nome, roteiro) {
    const r = roteiro || {};
    const descricao = String(r.descricao || "").trim();
    const tags = hashtags(r);
    if (p.legenda === "titulo_descricao") {
      const fontes = (r.fontes || []).map((f) => String(f).trim()).filter(Boolean);
      const partes = [descricao, fontes.length ? `Fontes: ${fontes.join("; ")}` : "", tags];
      return { titulo: nome.slice(0, 100), texto: partes.filter(Boolean).join("\n\n") };
    }
    if (p.legenda === "curta") return { titulo: "", texto: [nome, tags].filter(Boolean).join(" ") };
    return { titulo: "", texto: [nome, descricao, tags].filter(Boolean).join("\n\n") };
  }

  function progresso(p, numeros) {
    return (p.metas || []).map((m) => {
      const atual = Number((numeros || {})[m.chave]) || 0;
      return { chave: m.chave, rotulo: m.rotulo, alvo: m.alvo, atual, pct: Math.min(100, Math.round((atual / m.alvo) * 100)) };
    });
  }

  function contaDe(e, canal, plat) {
    const c = (e.contas || {})[`${canal}:${plat}`];
    return c
      ? { usuario: c.usuario || "", url: c.url || "", situacao: c.situacao || "planejada", seguranca: Boolean(c.seguranca), numeros: c.numeros || {}, atualizado_em: c.atualizadoEm || null }
      : { usuario: "", url: "", situacao: "planejada", seguranca: false, numeros: {}, atualizado_em: null };
  }

  function salvarConta(e, canalId, platId, corpo, agora) {
    const canal = e.canais[canalId];
    const p = e.plataformas.plataformas.find((x) => x.id === platId);
    if (!canal || !p) throw new Invalido("canal ou plataforma não encontrado", 404);
    if (!(canal.plataformas || []).includes(p.id)) throw new Invalido(`o canal ${canal.nome} não publica em ${p.nome}`, 422);
    const situacao = corpo.situacao;
    if (!SITUACOES_CONTA.includes(situacao)) throw new Invalido(`situação inválida: ${situacao}`, 422);
    const usuario = String(corpo.usuario || "").trim();
    if (usuario.length > 60 || /[\s<>"']/.test(usuario)) throw new Invalido("usuário: até 60 caracteres, sem espaços nem aspas", 422);
    const url = String(corpo.url || "").trim();
    if (url && !hostAceito(url, p.dominios)) throw new Invalido(`link do perfil precisa ser https em ${p.dominios.join(", ")}`, 422);
    const numeros = {};
    const permitidas = new Set(["seguidores", ...(p.metas || []).map((m) => m.chave)]);
    for (const [k, v] of Object.entries(corpo.numeros || {})) {
      if (!permitidas.has(k)) throw new Invalido(`número desconhecido para ${p.nome}: ${k}`, 422);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > NUMERO_MAX) throw new Invalido("os números precisam ser inteiros positivos", 422);
      numeros[k] = n;
    }
    const dados = { canal: canal.slug, plataforma: p.id, usuario, url, situacao, seguranca: corpo.seguranca === true, numeros, atualizadoEm: isoBR(agora) };
    return {
      resposta: { ...contaDe({ contas: { [`${canal.slug}:${p.id}`]: dados } }, canal.slug, p.id) },
      mudancas: [{ tipo: "set", col: "contas", id: `${canal.slug}:${p.id}`, dados, substituir: true }, evento(agora, "contas", `${canal.slug}/${p.id}`, `conta ${situacao}`, "info")],
    };
  }

  function pendentes(e, canal, publicacoes) {
    return plataformasDoCanal(e, canal).filter((p) => !RESOLVIDAS.includes(((publicacoes || {})[p.id] || {}).situacao)).map((p) => p.id);
  }

  function marcarPublicacao(e, id, platId, corpo, agora) {
    const v = e.videos[id];
    if (!v) throw new Invalido("vídeo não encontrado", 404);
    if (!["aprovado", "publicado"].includes(v.status)) throw new Invalido("só vídeos aprovados vão para as plataformas", 422);
    const canal = e.canais[v.canal];
    const p = e.plataformas.plataformas.find((x) => x.id === platId);
    if (!canal || !p || !(canal.plataformas || []).includes(platId)) throw new Invalido("esta plataforma não está na lista do canal", 422);
    const situacao = corpo.situacao;
    if (!SITUACOES_PUBLICACAO.includes(situacao)) throw new Invalido(`situação inválida: ${situacao}`, 422);
    const url = situacao === "publicado" ? String(corpo.url || "").trim() : "";
    if (url && !hostAceito(url, p.dominios)) throw new Invalido(`o link do post precisa ser https em ${p.dominios.join(", ")}`, 422);
    const antes = (v.publicacoes || {})[platId] || {};
    const registro = {
      situacao, url,
      // colar o link depois não muda a data em que o post saiu
      publicadoEm: situacao === "publicado" ? (antes.situacao === "publicado" && antes.publicadoEm) || isoBR(agora) : null,
      atualizadoEm: isoBR(agora),
    };
    const publicacoes = { ...(v.publicacoes || {}), [platId]: registro };
    const alguma = Object.values(publicacoes).some((x) => x.situacao === "publicado");
    const novoStatus = alguma ? "publicado" : "aprovado";
    const patch = { publicacoes: { [platId]: registro } };
    if (novoStatus !== v.status) {
      patch.status = novoStatus;
      patch.atualizadoEm = isoBR(agora);
    }
    return {
      resposta: { situacao, url, video_status: novoStatus, pendentes: pendentes(e, canal, publicacoes) },
      mudancas: [set("videos", id, patch), evento(agora, "publicar", platId, `${titulo(v)}: ${situacao}`, alguma ? "ok" : "info")],
    };
  }

  /* ------------------------------------------------------------ telas */

  function medir(e, agora) {
    const desde = isoBR(new Date(agora.getTime() - 7 * DIA));
    const revisoes = lista(e.videos).filter((v) => num(v.revisaoS) !== null && (v.atualizadoEm || "") >= desde).map((v) => v.revisaoS);
    const soma = revisoes.reduce((s, x) => s + x, 0);
    const ligados = Object.keys(e.canais).filter((c) => ligado(e, c));
    return {
      revisao_media_min: revisoes.length ? soma / revisoes.length / 60 : metrica(e, "revisao_media_min") || 0,
      melhor_media_views_short: Math.max(0, ...ligados.map((c) => metricaCanal(e, c, "media_views_short") || 0)),
      maior_inscritos: Math.max(0, ...ligados.map((c) => metricaCanal(e, c, "inscritos") || 0)),
      avisos_politica: metrica(e, "avisos_politica") || 0,
      horas_semana: soma ? soma / 3600 : metrica(e, "horas_semana") || 0,
    };
  }

  function condicoes(s) {
    return [
      { nome: "Revisão de até 10 min por vídeo", ok: s.revisao_media_min > 0 && s.revisao_media_min <= 10, valor: `Média: ${virgula(s.revisao_media_min)} min` },
      { nome: "Um canal com 5 mil views por Short ou 1.000 inscritos", ok: s.melhor_media_views_short >= 5000 || s.maior_inscritos >= 1000, valor: `Melhor média: ${virgula(s.melhor_media_views_short / 1000)} mil` },
      { nome: "Nenhum aviso de política", ok: s.avisos_politica === 0, valor: `${s.avisos_politica} aviso(s)` },
      { nome: "Menos de 7 h por semana", ok: s.horas_semana < 7, valor: `Esta semana: ${virgula(s.horas_semana)} h` },
    ];
  }

  const etapaAtual = (v) => ETAPAS.slice(1).find((et) => !["feito", "pulado"].includes(((v.etapas || {})[et] || {}).status || "espera"));

  function linhaDeProducao(e) {
    const contagem = Object.fromEntries(ETAPAS.slice(1).map((et) => [et, { total: 0, voce: 0, rodando: 0, erro: 0 }]));
    lista(e.videos).filter((v) => EM_PRODUCAO.includes(v.status)).forEach((v) => {
      const et = etapaAtual(v);
      if (!et) return;
      const st = v.etapas[et].status;
      contagem[et].total += 1;
      if (["voce", "rodando", "erro"].includes(st)) contagem[et][st] += 1;
    });
    const linha = Object.entries(contagem).map(([etapa, c]) => ({ etapa, ...c }));
    linha.push({ etapa: "fila", total: lista(e.videos).filter((v) => ["fila", "reprovado"].includes(v.status)).length, voce: 0, rodando: 0, erro: 0 });
    return linha;
  }

  function precisaDeVoce(e, agora) {
    const itens = [];
    const videos = lista(e.videos);
    const reprovados = videos.filter((v) => v.status === "reprovado");
    if (reprovados.length) {
      const nomes = [...new Set(reprovados.flatMap((v) => (v.testes || []).filter((t) => t.status === "cr").map((t) => t.nome.split(" ")[0].toLowerCase())))].sort();
      itens.push({ nivel: "cr", titulo: `${reprovados.length} vídeo(s) reprovado(s) nos testes`, detalhe: `Falhou: ${nomes.join(", ")}`, rota: "aprovacao/reprovados" });
    }
    videos.flatMap((v) => Object.entries(v.etapas || {}).filter(([, et]) => et.status === "erro").map(([nome, et]) => ({ v, nome, et })))
      .slice(0, 5).forEach(({ v, nome, et }) => itens.push({ nivel: "cr", titulo: `Erro na etapa ${nome}`, detalhe: `${titulo(v)}: ${et.nota || ""}`, rota: "producao" }));
    const fila = videos.filter((v) => v.status === "fila");
    if (fila.length) {
      const antigo = fila.map((v) => v.atualizadoEm).sort()[0];
      const horas = antigo ? (agora.getTime() - ms(antigo)) / 3600e3 : 0;
      itens.push({ nivel: "at", titulo: `${fila.length} vídeo(s) esperando aprovação`, detalhe: `O mais antigo está na fila há ${Math.round(horas)} h`, rota: "aprovacao" });
    }
    const agoraIso = isoBR(agora);
    const desde = isoBR(new Date(agora.getTime() - JANELA_PUBLICAR_DIAS * DIA));
    const devidos = videos.filter((v) => ["aprovado", "publicado"].includes(v.status) && v.horario && v.horario <= agoraIso && v.horario >= desde)
      .filter((v) => e.canais[v.canal] && pendentes(e, e.canais[v.canal], v.publicacoes).length).length;
    if (devidos) itens.push({ nivel: "at", titulo: `${devidos} vídeo(s) na hora de publicar`, detalhe: "Abra Plataformas e publique em cada rede", rota: "plataformas", n: devidos });
    const restantes = config(e, "creditos_flow_restantes");
    const total = config(e, "creditos_flow_total") || 1000;
    if (restantes !== null && restantes / total < 0.25) {
      itens.push({ nivel: "at", titulo: `Restam ${Math.round(restantes)} créditos do Flow`, detalhe: `Dá para uns ${Math.floor(restantes / 20)} ganchos`, rota: "dinheiro" });
    }
    videos.flatMap((v) => Object.entries(v.etapas || {}).filter(([, et]) => et.status === "voce").map(([nome, et]) => ({ v, nome, et })))
      .slice(0, 5).forEach(({ v, nome, et }) => itens.push({ nivel: "in", titulo: `${titulo(v)} espera você`, detalhe: et.nota || `etapa ${nome}`, rota: "producao" }));
    const gasto = gastoMes(e, mesBR(agora), ["gemini", "azure"]);
    const t = teto(e);
    if (t > 0 && gasto / t >= 0.6) {
      itens.push({ nivel: gasto < t * 0.85 ? "in" : "at", titulo: `IA em ${Math.round((gasto / t) * 100)}% do teto`, detalhe: `R$ ${Math.round(gasto)} de R$ ${Math.round(t)} neste mês`, rota: "dinheiro" });
    }
    return itens.sort((a, b) => (NIVEL_ORDEM[a.nivel] ?? 9) - (NIVEL_ORDEM[b.nivel] ?? 9));
  }

  function resumo(e, agora) {
    const hoje = diaBR(agora);
    const videos = lista(e.videos);
    const prontos = videos.filter((v) => v.status === "fila").length;
    const reprovados = videos.filter((v) => v.status === "reprovado").length;
    const contagem = {};
    videos.filter((v) => ["fila", "reprovado"].includes(v.status)).forEach((v) => { contagem[v.canal] = (contagem[v.canal] || 0) + 1; });
    const porCanal = Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ ...canalJson(e, id), n }));
    const sete = isoBR(new Date(agora.getTime() - 7 * DIA));
    const agoraIso = isoBR(agora);
    const publicados = videos.filter((v) => ["aprovado", "publicado"].includes(v.status) && v.horario && v.horario >= sete && v.horario <= agoraIso).length;
    const planejados = Object.values(e.canais).filter((c) => ligado(e, c.slug)).reduce((s, c) => s + c.horarios.length, 0) * 7;
    const views7 = somaViews(e, somarDias(hoje, -7), hoje);
    const viewsAnt = somaViews(e, somarDias(hoje, -14), somarDias(hoje, -7));
    const mes = mesBR(agora);
    const porFonte = {};
    (e.receitas || []).filter((r) => r.mes === mes).forEach((r) => { porFonte[r.fonte] = (porFonte[r.fonte] || 0) + (Number(r.valor) || 0); });
    const receitas = Object.entries(porFonte).map(([fonte, valor]) => ({ fonte, valor }));
    const dias = Array.from({ length: 14 }, (_, i) => somarDias(hoje, i - 14));
    const series = {};
    (e.metricas || []).filter((m) => dias.includes(m.data)).forEach((m) => {
      series[m.canal] = series[m.canal] || Array(14).fill(0);
      series[m.canal][dias.indexOf(m.data)] = Number(m.views) || 0;
    });
    return {
      numeros_em: agoraIso,
      exemplo: Boolean(e.exemplo),
      canais_total: Object.keys(e.canais).length,
      kpis: {
        esperando: prontos + reprovados, prontos, reprovados, por_canal: porCanal,
        publicados_7d: publicados, planejados_7d: planejados, views_7d: views7,
        variacao_views: viewsAnt ? Math.round(((views7 - viewsAnt) / viewsAnt) * 100) : null,
        receita_prevista: receitas.reduce((s, r) => s + r.valor, 0), receitas,
      },
      grafico: {
        dias,
        series: Object.entries(series).map(([id, valores]) => (e.canais[id]
          ? { ...canalJson(e, id), valores }
          : { id, nome: id.charAt(0).toUpperCase() + id.slice(1), cor: "#B7791F", valores })),
      },
      precisa: precisaDeVoce(e, agora),
      linha: linhaDeProducao(e),
      gatilho: condicoes(medir(e, agora)),
    };
  }

  function janelaDo(roteiro) {
    const j = ((roteiro || {}).janelas || [])[0];
    return j ? { tipo: j.tipo || "", titulo: j.titulo || "", referencia: j.referencia || "" } : null;
  }

  function fila(e, aba, agora) {
    if (!(aba in ABAS)) aba = "fila";
    const videos = lista(e.videos);
    const abas = Object.entries(ABAS).map(([id, [rotulo, filtro]]) => ({ id, rotulo, n: videos.filter(filtro).length }));
    const itens = videos.filter(ABAS[aba][1]).sort((a, b) => (a.atualizadoEm || "").localeCompare(b.atualizadoEm || "")).map((v) => {
      const canal = e.canais[v.canal];
      return {
        id: v.id, canal: canalJson(e, v.canal), titulo: titulo(v), serie: v.serie || "", referencia: v.referencia || "",
        status: v.status, duracao: v.duracao, horario: v.horario,
        horario_sugerido: canal && v.status === "fila" ? proximoHorario(e, canal, agora) : null,
        aviso: v.aviso || "", testes: v.testes || [], janela: janelaDo(v.roteiro), drive_id: v.driveId || null,
      };
    });
    return { aba, abas, itens };
  }

  function producao(e) {
    const videos = lista(e.videos).filter((v) => EM_PRODUCAO.includes(v.status))
      .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")).slice(0, 30).map((v) => {
        const etapas = ETAPAS.slice(1).map((et) => ({ etapa: et, status: ((v.etapas || {})[et] || {}).status || "espera", nota: ((v.etapas || {})[et] || {}).nota || "" }));
        return {
          id: v.id, canal: canalJson(e, v.canal), titulo: titulo(v), serie: v.serie || "", referencia: v.referencia || "",
          etapas, destaque: etapas.find((x) => ["voce", "erro"].includes(x.status)) || null,
        };
      });
    const eventos = [...(e.eventos || [])].sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 40)
      .map(({ ts, etapa, alvo, msg, nivel }) => ({ ts, etapa, alvo, msg, nivel }));
    return { videos, eventos };
  }

  function canais(e, agora) {
    const hoje = diaBR(agora);
    const agoraIso = isoBR(agora);
    const resultado = Object.values(e.canais).sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "") || a.slug.localeCompare(b.slug)).map((c) => {
      const revisoes = lista(e.videos).filter((v) => v.canal === c.slug && num(v.revisaoS) !== null).map((v) => v.revisaoS);
      const proxima = lista(e.videos).filter((v) => v.canal === c.slug && v.status === "aprovado" && v.horario && v.horario >= agoraIso)
        .map((v) => v.horario).sort()[0] || null;
      const inscritos = metricaCanal(e, c.slug, "inscritos");
      const views90 = somaViews(e, somarDias(hoje, -90), hoje, c.slug);
      return {
        id: c.slug, nome: c.nome, cor: c.cor, descricao: c.descricao || "", ligado: ligado(e, c.slug),
        horarios: c.horarios || [], plataformas: c.plataformas || [], duracao: duracaoDo(c), modelo: c.modelo || "",
        n_videos: lista(e.videos).filter((v) => v.canal === c.slug).length,
        inscritos, seguidores_tiktok: metricaCanal(e, c.slug, "seguidores_tiktok"),
        views_30d: somaViews(e, somarDias(hoje, -30), hoje, c.slug), media_por_short: metricaCanal(e, c.slug, "media_views_short"),
        revisao_min: revisoes.length ? arred(revisoes.reduce((s, x) => s + x, 0) / revisoes.length / 60, 1) : null,
        avisos: metricaCanal(e, c.slug, "avisos") || 0, proxima,
        ypp: { inscritos, inscritos_meta: 500, views_90d: views90, views_meta: 3000000 },
      };
    });
    return {
      canais: resultado, gatilho: condicoes(medir(e, agora)), limite: LIMITE_CANAIS, duracao_faixa: DURACAO_FAIXA,
      modelos: (e.modelos || []).map((m) => ({
        id: m.id, nome: m.nome, cor: m.cor, descricao: m.descricao || "", horarios: m.horarios || [], plataformas: m.plataformas || [], duracao: duracaoDo(m),
      })),
      plataformas: e.plataformas.plataformas.map((p) => ({ id: p.id, nome: p.nome, cor: p.cor })),
    };
  }

  function series(e) {
    const grupos = new Map();
    lista(e.videos).filter((v) => v.serie).sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "")).forEach((v) => {
      const chave = `${v.canal}\u0000${v.serie}`;
      if (!grupos.has(chave)) grupos.set(chave, { canal: v.canal, serie: v.serie, episodios: [] });
      grupos.get(chave).episodios.push({ id: v.id, titulo: titulo(v), referencia: v.referencia || "", status: v.status });
    });
    return [...grupos.values()].map((g) => ({
      canal: canalJson(e, g.canal), serie: g.serie, episodios: g.episodios,
      personagens: ((e.canais[g.canal] || {}).personagens || []).map((p) => ({ id: p.id, ficha: p.ficha || "", descricao: p.descricao || "" })),
    }));
  }

  function dinheiro(e, agora) {
    const mes = mesBR(agora);
    const agrupar = (itens, chave) => {
      const g = {};
      itens.forEach((x) => { g[x[chave]] = (g[x[chave]] || 0) + (Number(x.valor) || 0); });
      return Object.entries(g).map(([k, valor]) => ({ [chave]: k, valor }));
    };
    const receitas = agrupar((e.receitas || []).filter((r) => r.mes === mes), "fonte");
    const custos = agrupar((e.custos || []).filter((c) => c.mes === mes), "fornecedor").sort((a, b) => b.valor - a.valor);
    const aiPro = config(e, "preco_ai_pro_brl");
    const receita = receitas.reduce((s, r) => s + r.valor, 0);
    const gasto = custos.reduce((s, c) => s + c.valor, 0) + (aiPro || 0);
    const cambio = config(e, "cambio_usd_brl") || 5.2;
    const campanhas = (e.campanhas || []).map((c) => {
      const aReceber = (Number(c.views_aprovadas) / 1000) * Number(c.valor_mil_usd) * cambio;
      return { ...c, a_receber_brl: arred(aReceber, 2), rs_hora: c.horas ? arred(aReceber / c.horas, 2) : null };
    });
    return {
      mes, receitas, custos, ai_pro_brl: aiPro, receita, gasto, sobra: receita - gasto,
      gemini: { gasto: gastoMes(e, mes, ["gemini"]), teto: teto(e) },
      flow: { restantes: config(e, "creditos_flow_restantes"), total: config(e, "creditos_flow_total") || 1000 },
      cambio, campanhas,
    };
  }

  function telaConfig(e) {
    const valores = {};
    Object.keys(FAIXAS_CONFIG).forEach((k) => { valores[k] = (e.config || {})[k] ?? ""; });
    if (valores.teto_mes_brl === "") valores.teto_mes_brl = "150";
    return { valores, conexao: e.conexao || {} };
  }

  function saude(e, agora) {
    const desde = isoBR(new Date(agora.getTime() - DIA));
    const eventos = [...(e.eventos || [])].sort((a, b) => (b.n || 0) - (a.n || 0));
    const status = {};
    lista(e.videos).forEach((v) => { status[v.status] = (status[v.status] || 0) + 1; });
    const conferido = new Date(`${e.plataformas.verificado_em}T12:00:00${OFFSET}`);
    return {
      versao: VERSAO, ...(e.conexao || {}), canais: Object.keys(e.canais).length,
      plataformas_dias: Math.floor((agora.getTime() - conferido.getTime()) / DIA),
      erros_24h: eventos.filter((x) => x.nivel === "cr" && x.ts >= desde).length,
      ultimo_evento: eventos[0] ? { ts: eventos[0].ts, etapa: eventos[0].etapa, alvo: eventos[0].alvo, msg: eventos[0].msg, nivel: eventos[0].nivel } : null,
      status,
    };
  }

  function plataformas(e, agora) {
    const conferido = new Date(`${e.plataformas.verificado_em}T12:00:00${OFFSET}`);
    const dias = Math.floor((agora.getTime() - conferido.getTime()) / DIA);
    return {
      verificado_em: e.plataformas.verificado_em, dias, revisar: dias > 90, situacoes: SITUACOES_CONTA,
      plataformas: e.plataformas.plataformas.map((p) => ({
        ...p,
        contas: Object.values(e.canais).filter((c) => (c.plataformas || []).includes(p.id)).map((c) => {
          const conta = contaDe(e, c.slug, p.id);
          return { canal: canalJson(e, c.slug), ...conta, progresso: progresso(p, conta.numeros) };
        }),
      })),
    };
  }

  function publicar(e, aba, agora) {
    if (!(aba in ABAS_PUBLICAR)) aba = "pendentes";
    const limiteFeitos = isoBR(new Date(agora.getTime() - 14 * DIA));
    const janela = isoBR(new Date(agora.getTime() - JANELA_PUBLICAR_DIAS * DIA));
    const grupos = { pendentes: [], feitos: [] };
    lista(e.videos).filter((v) => ["aprovado", "publicado"].includes(v.status) && (!v.horario || v.horario >= janela))
      .sort((a, b) => (a.horario || "").localeCompare(b.horario || "")).forEach((v) => {
        const canal = e.canais[v.canal];
        if (!canal) return;
        const feitas = v.publicacoes || {};
        const faltam = pendentes(e, canal, feitas);
        const ultima = Object.values(feitas).map((f) => f.atualizadoEm || "").sort().pop() || v.atualizadoEm || "";
        if (!faltam.length && ultima < limiteFeitos) return;
        const linhas = plataformasDoCanal(e, canal).map((p) => {
          const f = feitas[p.id] || {};
          const [status, detalhe] = elegibilidade(p, v.duracao);
          const conta = contaDe(e, canal.slug, p.id);
          return {
            id: p.id, nome: p.nome, cor: p.cor, publicacao: p.publicacao, situacao: f.situacao || "pendente",
            url: f.url || "", publicado_em: f.publicadoEm || null, elegivel: { status, detalhe },
            legenda: legenda(p, titulo(v), v.roteiro), subir: (p.urls || {}).subir || "", ao_publicar: p.ao_publicar || [],
            conta: { usuario: conta.usuario, situacao: conta.situacao },
          };
        });
        grupos[faltam.length ? "pendentes" : "feitos"].push({
          id: v.id, canal: canalJson(e, v.canal), titulo: titulo(v), horario: v.horario, duracao: v.duracao, status: v.status,
          drive_id: v.driveId || null, faltam: faltam.length, plataformas: linhas,
        });
      });
    grupos.feitos.reverse();
    return {
      aba,
      abas: Object.entries(ABAS_PUBLICAR).map(([id, rotulo]) => ({ id, rotulo, n: grupos[id].length })),
      itens: grupos[aba].slice(0, 40),
    };
  }

  /* ------------------------------------------------------------ roteador */

  function get(e, caminho, agora) {
    const [rota, consulta = ""] = String(caminho).split("?");
    const aba = new URLSearchParams(consulta).get("aba") || "";
    switch (rota) {
      case "/api/resumo": return resumo(e, agora);
      case "/api/fila": return fila(e, aba || "fila", agora);
      case "/api/producao": return producao(e);
      case "/api/canais": return canais(e, agora);
      case "/api/series": return series(e);
      case "/api/dinheiro": return dinheiro(e, agora);
      case "/api/config": return telaConfig(e);
      case "/api/saude": return saude(e, agora);
      case "/api/plataformas": return plataformas(e, agora);
      case "/api/publicar": return publicar(e, aba || "pendentes", agora);
      case "/api/plataforma": return telaPlataforma(e);
      default: throw new Invalido("tela desconhecida", 404);
    }
  }

  const ROTAS = [
    [new RegExp(`^/api/videos/${ID_VIDEO}/acao$`), (e, m, c, a) => executarAcao(e, m[1], c, a)],
    [new RegExp(`^/api/videos/${ID_VIDEO}/etapas/gancho/pular$`), (e, m, c, a) => pularGancho(e, m[1], a)],
    [/^\/api\/videos$/, (e, m, c, a) => adicionarVideo(e, c, a)],
    [/^\/api\/lotes$/, (e, m, c, a) => criarLote(e, c, a)],
    [new RegExp(`^/api/canais/${SLUG}/ligado$`), (e, m, c, a) => ligarCanal(e, m[1], c, a)],
    [new RegExp(`^/api/canais/${SLUG}/apagar$`), (e, m, c, a) => apagarCanal(e, m[1], a)],
    [new RegExp(`^/api/canais/${SLUG}$`), (e, m, c, a) => editarCanal(e, m[1], c, a)],
    [/^\/api\/canais$/, (e, m, c, a) => criarCanal(e, c, a)],
    [/^\/api\/plataforma\/acesso$/, (e, m, c, a) => salvarAcesso(e, c, a)],
    [new RegExp(`^/api/plataforma/estudios/${UID}/ativo$`), (e, m, c) => ativarEstudio(e, m[1], c)],
    [/^\/api\/config$/, (e, m, c) => salvarConfig(e, c)],
    [new RegExp(`^/api/contas/${SLUG}/${SLUG}$`), (e, m, c, a) => salvarConta(e, m[1], m[2], c, a)],
    [new RegExp(`^/api/publicacoes/${ID_VIDEO}/${SLUG}$`), (e, m, c, a) => marcarPublicacao(e, m[1], m[2], c, a)],
  ];

  function post(e, caminho, corpo, agora) {
    for (const [padrao, fazer] of ROTAS) {
      const m = padrao.exec(String(caminho));
      if (m) return fazer(e, m, corpo && typeof corpo === "object" ? corpo : {}, agora);
    }
    throw new Invalido("pedido desconhecido", 404);
  }

  const Motor = {
    ETAPAS, FAIXAS_CONFIG, VERSAO, LIMITE_CANAIS, Invalido, isoBR, diaBR, mesBR, somarDias, aplicar, get, post,
    proximoHorario, hostAceito, legenda, elegibilidade, progresso, idDoDrive, testeDuracao, novoId, slugDe,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else raiz.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);
