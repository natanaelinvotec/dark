#!/usr/bin/env bash
# Roda uma vez, quando o Codespace é criado: instala FFmpeg e uv, baixa as bibliotecas
# e cria o .env com a pasta de dados dentro do Codespace (o Drive do PC não existe aqui).
set -euo pipefail
cd "$(dirname "$0")/.."

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ffmpeg fonts-dejavu-core >/dev/null
python -m pip install --quiet --upgrade uv

uv sync --all-extras
mkdir -p dados/drive dados/logs

# endereço do Codespaces é https: cookie seguro ligado
uv run estudio configurar --dados dados/drive --online
uv run estudio init

echo
echo "Falta 1 passo: no terminal abaixo, rode   uv run estudio configurar"
echo "(ele pede a senha do painel e as chaves; depois rode   bash scripts/codespace-iniciar.sh)"
