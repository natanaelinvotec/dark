"use strict";
/* Dados de exemplo do modo demonstração (os mesmos do mockup), relativos ao "agora".
   Só roda no navegador de quem abre sem Firebase; nada disso vai para o banco. */
(function (raiz) {
  function criar(Motor, agora) {
    const { isoBR, diaBR, mesBR, somarDias, ETAPAS } = Motor;
    const DIA = 86400e3;
    let seq = 0;
    const novoId = () => `e${(++seq).toString(16).padStart(11, "0")}`;
    const ok = (nome) => ({ nome, status: "ok", detalhe: "" });
    const padrao = (sim, extras = {}) => [
      ok("Formato 9:16"), ok("Áudio -14 LUFS"), ok("Tela preta"), ok("Silêncio"),
      extras.legenda || ok("Legenda"), ok("Licenças"),
      { nome: `Similaridade ${sim.toFixed(2).replace(".", ",")}`, status: sim >= 0.6 ? "cr" : sim >= 0.45 ? "at" : "ok", detalhe: "contra o canal" },
      extras.checagem || ok("Checagem"),
    ];
    const videos = {};
    function video(canal, nome, campos = {}) {
      const id = novoId();
      const finais = ["fila", "reprovado", "aprovado", "publicado"];
      const padraoEtapa = finais.includes(campos.status) ? "feito" : "espera";
      const etapas = {};
      ETAPAS.forEach((et) => { etapas[et] = { status: et === "pauta" ? "feito" : (campos.etapas || {})[et] || padraoEtapa, nota: "" }; });
      const quando = isoBR(new Date(agora.getTime() - (20 - seq) * 3600e3));
      videos[id] = {
        id, canal, titulo: nome, tema: nome, serie: "", referencia: "", status: "pauta", roteiro: null, duracao: null,
        horario: null, aviso: "", notaRefazer: "", revisaoS: null, driveId: null, testes: [], publicacoes: {},
        criadoEm: quando, atualizadoEm: quando, ...campos, etapas,
      };
      return id;
    }
    const serie = "Temporada Davi";
    const meioDia = new Date(`${diaBR(agora)}T12:00:00-03:00`);
    const publicado = video("biblico-manhwa", "O gigante de Gate desafia Israel", {
      serie, referencia: "1 Samuel 17:1-10", status: "publicado", duracao: 66, testes: padrao(0.12),
      horario: isoBR(new Date(meioDia.getTime() - DIA)),
      roteiro: { descricao: "Golias desafia o exército de Israel por 40 dias. Episódio 1.", hashtags: ["#biblia", "#davi", "#manhwa", "#historiasbiblicas"], fontes: ["1 Samuel 17:1-10"], janelas: [] },
    });
    const agoraIso = isoBR(agora);
    videos[publicado].publicacoes = {
      youtube: { situacao: "publicado", url: "", publicadoEm: agoraIso, atualizadoEm: agoraIso },
      tiktok: { situacao: "publicado", url: "", publicadoEm: agoraIso, atualizadoEm: agoraIso },
      kwai: { situacao: "pulado", url: "", publicadoEm: null, atualizadoEm: agoraIso },
    };
    video("curiosidades", "Por que o céu fica laranja no fim da tarde", {
      status: "aprovado", duracao: 68, testes: padrao(0.11), horario: isoBR(new Date(meioDia.getTime() + 6.5 * 3600e3)),
      roteiro: { descricao: "A luz do pôr do sol atravessa mais ar e o azul se espalha pelo caminho.", hashtags: ["#curiosidades", "#ciencia", "#ceu", "#pordosol"], fontes: ["NASA Space Place: Why is the sky blue?"], janelas: [] },
    });
    const missao = { tipo: "MISSAO", titulo: "Levar provisões aos irmãos", referencia: "1 Sm 17:17" };
    video("biblico-manhwa", "O gigante que desafiou um exército por 40 dias", { serie, referencia: "1 Samuel 17:11-16", status: "fila", duracao: 71, testes: padrao(0.22) });
    video("biblico-manhwa", "Davi recebe a missão que ninguém queria", {
      serie, referencia: "1 Samuel 17:17-30", status: "fila", duracao: 64,
      aviso: "Altura de Golias: o texto massorético diz 6 côvados e 1 palmo; outros manuscritos dizem 4 → confira 1 Samuel 17:4",
      testes: padrao(0.18, { checagem: { nome: "Checagem: 1 aviso(s)", status: "at", detalhe: "" } }),
      roteiro: { descricao: "", hashtags: [], fontes: [], janelas: [missao] },
    });
    video("biblico-manhwa", "O pastor que já tinha enfrentado um leão e um urso", { serie, referencia: "1 Samuel 17:31-37", status: "fila", duracao: 69, testes: padrao(0.25) });
    video("biblico-manhwa", "Davi recusa a armadura do rei", {
      serie, referencia: "1 Samuel 17:38-39", status: "voce",
      etapas: { roteiro: "feito", checagem: "feito", quadros: "voce", voz: "feito" },
    });
    video("biblico-manhwa", "Cinco pedras lisas do riacho", { serie, referencia: "1 Samuel 17:40-51", status: "produzindo", etapas: { roteiro: "rodando" } });
    video("curiosidades", "O planeta onde chove vidro de lado", { status: "fila", duracao: 62, testes: padrao(0.14) });
    video("curiosidades", "Por que o pôr do sol em Marte é azul", {
      status: "reprovado", duracao: 63, testes: padrao(0.19, { legenda: { nome: "Legenda", status: "cr", detalhe: "atrasada 0,8 s a partir de 0:31" } }),
    });
    video("curiosidades", "O som mais alto já registrado", { status: "reprovado", duracao: 67, testes: padrao(0.72) });
    const feitas = Object.fromEntries(["roteiro", "checagem", "quadros", "voz"].map((e) => [e, "feito"]));
    video("curiosidades", "Os relâmpagos que quase não param no Catatumbo", { status: "produzindo", etapas: { ...feitas, montagem: "feito", gancho: "pulado", testes: "rodando" } });
    video("curiosidades", "A árvore mais solitária do mundo", { status: "produzindo", etapas: { ...feitas, gancho: "pulado", montagem: "erro" } });
    videos[Object.keys(videos)[Object.keys(videos).length - 1]].etapas.montagem.nota = 'nenhum asset vertical para "acacia desert"';

    const hoje = diaBR(agora);
    const metricas = [];
    const curvas = {
      "biblico-manhwa": [11.2, 12.8, 13.5, 12.1, 14.9, 16.2, 15.4, 14.8, 17.3, 16.9, 18.4, 17.7, 19.2, 20.1],
      curiosidades: [7.4, 8.1, 7.9, 8.8, 9.2, 8.6, 9.9, 10.4, 9.7, 10.8, 11.2, 10.6, 11.9, 12.3],
      clipping: [3.1, 4.2, 5.6, 4.8, 6.1, 7.4, 6.9, 5.8, 7.2, 8.1, 6.6, 7.9, 8.4, 9.2],
    };
    for (let i = 0; i < 14; i += 1) {
      for (const [canal, valores] of Object.entries(curvas)) {
        metricas.push({ data: somarDias(hoje, i - 14), canal, views: Math.round(valores[i] * 1000) });
      }
    }
    const mes = mesBR(agora);
    let n = agora.getTime() - 3600e3;
    const eventos = [
      ["montagem", "curiosidades/tenere", 'erro: nenhum asset vertical para "acacia desert"', "cr"],
      ["quadros", "biblico-manhwa/davi-05", "esperando você: 10 prompts gerados", "at"],
      ["roteiro", "biblico-manhwa/davi-06", "gerando (Gemini API)", "run"],
      ["checagem", "curiosidades/catatumbo", "0 avisos, 4 fontes conferidas", "ok"],
      ["voz", "curiosidades/catatumbo", "WAV 0:56, -14,1 LUFS", "ok"],
      ["montagem", "curiosidades/catatumbo", "MP4 1080×1920, 0:56", "ok"],
      ["testes", "curiosidades/catatumbo", "rodando 6 de 8 checagens", "run"],
    ].map(([etapa, alvo, msg, nivel]) => {
      n += 60e3;
      return { ts: isoBR(new Date(n)), n, etapa, alvo, msg, nivel };
    }).reverse();
    const conta = (canal, plataforma, usuario, situacao, numeros) =>
      [`${canal}:${plataforma}`, { canal, plataforma, usuario, url: "", situacao, seguranca: true, numeros, atualizadoEm: agoraIso }];
    return {
      versao: 2,
      exemplo: true,
      videos,
      contas: Object.fromEntries([
        conta("biblico-manhwa", "youtube", "@biblico.manhwa", "crescendo", { inscritos: 940, views_shorts_90d: 1240000, seguidores: 940 }),
        conta("biblico-manhwa", "tiktok", "@biblico.manhwa", "crescendo", { seguidores: 3860, views_30d: 61000 }),
        conta("curiosidades", "youtube", "@curiosidades", "criada", { inscritos: 680, views_shorts_90d: 820000, seguidores: 680 }),
        conta("curiosidades", "tiktok", "@curiosidades", "criada", { seguidores: 2140, views_30d: 38000 }),
      ]),
      acoes: [],
      eventos,
      custos: [["gemini", 96], ["azure", 22], ["vps", 60]].map(([fornecedor, valor]) => ({ mes, fornecedor, valor })),
      metricas,
      receitas: [{ mes, fonte: "clipping", valor: 890, situacao: "prevista" }, { mes, fonte: "afiliados", valor: 350, situacao: "prevista" }],
      campanhas: [
        { nome: "Campanha A", tipo: "podcast", valor_mil_usd: 1.0, teto_views: 300000, views_aprovadas: 128000, horas: 7.0, situacao: "aprovada" },
        { nome: "Campanha B", tipo: "aplicativo", valor_mil_usd: 0.7, teto_views: 150000, views_aprovadas: 61500, horas: 4.0, situacao: "em analise" },
      ],
      config: {
        creditos_flow_restantes: "180",
        creditos_flow_total: "1000",
        metricas: {
          revisao_media_min: 8.4, horas_semana: 6.5, avisos_politica: 0,
          por_canal: {
            "biblico-manhwa": { media_views_short: 3100, inscritos: 940, seguidores_tiktok: 3860 },
            curiosidades: { media_views_short: 2200, inscritos: 680, seguidores_tiktok: 2140 },
          },
        },
      },
    };
  }
  const Semente = { criar };
  if (typeof module !== "undefined" && module.exports) module.exports = Semente;
  else raiz.Semente = Semente;
})(typeof window !== "undefined" ? window : globalThis);
