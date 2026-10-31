# Atalhos para Linux/macOS/WSL e CI. No Windows sem make, rode os comandos `uv run ...` direto.
.PHONY: instalar test lint formatar audit painel worker init exemplo fontes smoke

FONTES_URL = https://github.com/google/fonts/raw/main/ofl

instalar:
	uv sync --all-extras

test:
	uv run pytest -q

lint:
	uv run ruff check .

formatar:
	uv run ruff format .
	uv run ruff check --fix .

audit:
	uv run pip-audit

init:
	uv run estudio init

exemplo:
	ESTUDIO_DB=dados/exemplo.db uv run estudio seed-exemplo

painel:
	uv run estudio painel --host 127.0.0.1 --port 8787

worker:
	uv run estudio worker

# Fontes livres (licença OFL) usadas na janela de missão e nas legendas
fontes:
	mkdir -p assets/fonts
	curl -fsSL -o assets/fonts/Cinzel.ttf "$(FONTES_URL)/cinzel/Cinzel%5Bwght%5D.ttf"
	curl -fsSL -o assets/fonts/Nunito.ttf "$(FONTES_URL)/nunito/Nunito%5Bwght%5D.ttf"
	curl -fsSL -o assets/fonts/Manrope.ttf "$(FONTES_URL)/manrope/Manrope%5Bwght%5D.ttf"

# Monta um vídeo de teste de 2 s com FFmpeg real
smoke:
	uv run pytest -q -m ffmpeg
