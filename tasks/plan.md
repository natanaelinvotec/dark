# Plano: Estúdio de Canais Automatizado

> Versão 1.1 · 31/10/2026 · especificação técnica em `SPEC.md` · tarefas em `tasks/todo.md`
>
> **Atenção:** a estratégia de canais abaixo continua valendo. A parte técnica (Python, VPS, painel
> local) foi substituída pela versão Firebase descrita no `SPEC.md` v2.

## 1. Estratégia (resumo de uma página)

### Problema
Como montar uma linha de produção de vídeos curtos que entregue **R$ 1–3 mil/mês em 6 meses**, gastando até **R$ 500/mês** e **5–10 h/semana**, sem que o volume vire o motivo de os canais serem derrubados?

### Direção recomendada
**Estúdio enxuto + clipping + um canal em vários formatos.** A automação faz o trabalho pesado (pauta, roteiro, voz, imagens, montagem, legenda, variações), e você entra só no **portão de revisão** (cerca de 8 min por vídeo). A escala vem de três coisas: (1) cada canal publicar mais e melhor; (2) cada roteiro virar 3 formatos (Short, TikTok de mais de 1 min, vídeo longo semanal) e outros idiomas por dublagem; (3) uma trilha de clipping pago por views, que gera caixa antes de qualquer monetização do YouTube.

**Sobre "5 canais × 3–5 vídeos/dia":** a arquitetura suporta 5 canais desde o primeiro dia, porque cada canal é só uma entrada de configuração. O que muda é a **ordem**: começamos com 2 canais ligados e abrimos o 3º, o 4º e o 5º por gatilho de métrica (seção 5). Motivos:
- 15–25 vídeos/dia com 5–10 h/semana dão de 2 a 3 minutos de atenção humana por vídeo. Isso é, na prática, o que a [política contra spam](https://support.google.com/youtube/answer/2801973?hl=pt-BR) do YouTube chama de "produção em massa automatizada ou sintética". A regra vale para "redes coordenadas de canais", e a punição é o encerramento da conta.
- Canais que nascem juntos, do mesmo IP, com o mesmo molde, caem juntos.
- A partir de 01/02/2027 o YPP exige, **por canal**, 1.000 inscritos + 20 milhões de views em Shorts em 90 dias ou 8.000 h. Dois canais fortes chegam lá antes de cinco medianos.

### Canais iniciais
| Canal | Por quê | Cuidados |
|---|---|---|
| **Bíblico** (manhwa com janelas de missão) | Público grande e fiel no Brasil; aceita vídeo longo; combina com afiliados | Revisão teológica humana; **traduções como NVI, NAA e ARA têm direitos autorais**; cuidado com imagens de IA de figuras sagradas |
| **Curiosidades** (ciência, espaço, história) | Infinitas pautas; material livre (NASA, Pexels, Pixabay) | Checagem de fatos obrigatória; variar formatos para não virar molde |
| **Contas de clipping** (por campanha Whop) | Caixa mais rápido: paga por mil views, conteúdo autorizado pelo dono | Seguir as regras de cada campanha; nunca pagar para participar |

### Premissas a validar
- [ ] O pipeline reduz o tempo humano para no máximo 10 min por Short (medido no painel).
- [ ] Bíblico e curiosidades passam de 1 mil views por Short em média nos primeiros 30 dias.
- [ ] Existem campanhas Whop que aceitam conteúdo/público em português e pagam.
- [ ] O app próprio passa na auditoria da YouTube Data API.
- [ ] Nenhum canal recebe aviso de spam ou de conteúdo inautêntico.

### O que NÃO vamos fazer
- Canal infantil agora (sem anúncio personalizado, pressão regulatória sobre IA infantil, exige animação cara).
- Criar contas em massa, chips, proxies ou navegadores anti-detecção.
- Repostar o mesmo vídeo em vários canais.
- Personas de IA falando de saúde, finanças ou jurídico.
- Aprovar em lote ou publicar sem um humano assistir.

### Formato do canal Bíblico: manhwa com "janelas de missão"
- Episódio de 45–60 s = 1 cena bíblica em 8–12 quadros verticais + 1 ou 2 janelas de missão + gancho animado (Veo, 4–8 s).
- Séries por personagem ("Temporada Davi", ep. 1 a 6); a temporada completa vira vídeo longo.
- O "Sistema" é recurso do narrador, nunca a voz de Deus; toda janela tem referência bíblica.
- Narração com palavras próprias + referência na tela.
- Janela de missão com design próprio (pergaminho dourado), desenhada pelo programa.
- Fichas de personagem fixas (Drive `/Personagens`) usadas como referência em todo quadro.

## 2. Arquitetura

```
 lote ──> [roteiro Gemini] ──> [checagem] ──> [quadros: manual ou Pexels/Pixabay] ──> [gancho: manual/pular]
                                                                                            │
          [testes automáticos] <── [montagem FFmpeg + legendas + janelas] <── [voz Azure ou sua] <┘
                 │
           fila | reprovado ──> PAINEL (você assiste: aprovar / refazer / rejeitar, com desfazer)
                                    │ aprovado
                              pacote de agendamento (pasta do dia + CSV) → Studio/Metricool
```

### Decisões
| Decisão | Escolha | Motivo |
|---|---|---|
| Orquestração | Python + SQLite + worker (systemd ou Docker) | Pipeline como código, testável e versionável |
| Canal = configuração | `channels/<slug>.yaml` | Abrir o canal 3 vira mudar uma flag |
| Render | FFmpeg self-hosted | Custo zero por minuto |
| Legendas | faster-whisper local, palavra a palavra | Grátis; roda em CPU |
| Voz | TTS neural pt-BR da Azure; sua voz no bíblico, se quiser | ElevenLabs grátis não permite uso comercial |
| Visuais | Pexels e Pixabay (licença comercial) + quadros feitos no Gemini | Licença de cada ativo registrada |
| LLM | Gemini API, saída em JSON validado | Texto custa centavos |
| Armazenamento | Google Drive 5 TB sincronizado | Já pago; pasta local para o programa |
| Painel | **Web app FastAPI + SQLite** seguindo o mockup aprovado | Um toque de verdade, prévia do vídeo, testes e auditoria |
| Janela de missão | Desenhada por código (Pillow → PNG) | IA de imagem erra texto em português |
| Publicação v1 | Pacote de agendamento | API não auditada só publica como privado |
| Publicação v2 | YouTube Data API após auditoria; TikTok via agendador auditado | — |

## 3. Riscos e mitigação
| Risco | Impacto | Mitigação |
|---|---|---|
| Canal marcado como spam/inautêntico | Alto | Portão humano obrigatório; teste de similaridade; variar formato/música |
| Erro bíblico ou factual viraliza | Alto | Etapa de checagem + revisão humana; referências na tela |
| Auditoria da API negada/demorada | Médio | Pacote de agendamento + agendador auditado |
| Vazamento de tokens/chaves | Alto | Seção 4 |
| Custo de API sai do orçamento | Baixo | Teto mensal no código, registrado em `custos` |

## 4. Segurança
Ver `SECURITY.md`. Pontos-chave: painel só em 127.0.0.1 + Tailscale + senha (scrypt); cookie httpOnly/SameSite=Strict; `X-Estudio` em todo POST; saída da LLM validada; `subprocess` sem shell; downloads só de hosts permitidos com limite de tamanho; FFmpeg em container sem rede; segredos fora do Git; `pip-audit` no CI.

## 5. Gatilho de expansão (canal 3, 4, 5)
Abrir o próximo canal só quando **todas** as condições valerem por 4 semanas seguidas:
1. Tempo humano médio de no máximo 10 min por vídeo.
2. Pelo menos um canal com média de 5 mil views por Short em 30 dias **ou** 1.000 inscritos.
3. Nenhum aviso de política em nenhum canal.
4. Menos de 7 h/semana usadas.

> A regra exata é decisão sua: `deve_abrir_proximo_canal()` em `src/estudio/gatilho.py`.

## 6. Perguntas em aberto
- VPS ou PC de casa?
- Bíblico com sua voz ou TTS?
- Qual tradução bíblica e sob qual licença?
- Quais campanhas Whop aceitam português hoje?
