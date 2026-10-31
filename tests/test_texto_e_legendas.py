from __future__ import annotations

from estudio.legendas import Palavra, agrupar, cobertura, gerar_ass, tempo_ass
from estudio.similaridade import jaccard, mais_parecido, normalizar


def test_normalizar_tira_acentos_e_pontuacao():
    assert normalizar("Ação, Coração!") == ["acao", "coracao"]


def test_jaccard_identico_e_diferente():
    texto = "o som mais alto ja registrado foi a explosao do krakatoa em 1883"
    assert jaccard(texto, texto) == 1.0
    assert jaccard(texto, "planeta onde chove vidro de lado") == 0.0


def test_mais_parecido_aponta_o_id():
    base = "o som mais alto ja registrado foi a explosao do krakatoa"
    valor, quem = mais_parecido(base, [("a", "planeta de vidro"), ("b", base + " em 1883")])
    assert quem == "b"
    assert valor > 0.7


def test_tempo_ass():
    assert tempo_ass(0) == "0:00:00.00"
    assert tempo_ass(61.237) == "0:01:01.24"
    assert tempo_ass(3600) == "1:00:00.00"


def test_agrupar_quebra_por_tamanho_pausa_e_pontuacao():
    palavras = [
        Palavra("Existe", 0.0, 0.3),
        Palavra("um", 0.3, 0.4),
        Palavra("planeta", 0.4, 0.8),
        Palavra("onde", 0.8, 1.0),
        Palavra("chove.", 1.0, 1.4),
        Palavra("Vidro", 2.5, 2.9),
    ]
    blocos = agrupar(palavras, max_palavras=3)
    assert [len(b.palavras) for b in blocos] == [3, 2, 1]


def test_ass_destaca_a_palavra_atual_e_limpa_tags():
    palavras = [Palavra("{\\pos(1,1)}Davi", 0.0, 0.4), Palavra("venceu", 0.4, 0.9)]
    ass = gerar_ass(agrupar(palavras))
    eventos = [linha for linha in ass.splitlines() if linha.startswith("Dialogue:")]
    assert len(eventos) == 2
    assert "\\pos" not in ass
    assert "{\\c&H00D7FF&}" in eventos[0]
    assert "PlayResY: 1920" in ass


def test_cobertura():
    blocos = agrupar([Palavra("a", 0, 1), Palavra("b", 1, 2), Palavra("c", 2, 3)])
    assert cobertura(blocos, 3.0) == 1.0
    assert cobertura([], 3.0) == 0.0
