#!/usr/bin/env bash
# Roda a cada vez que o Codespace liga: sobe o painel e o worker em segundo plano.
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p dados/logs

if ! grep -Eq "^ESTUDIO_SENHA_HASH=.+" .env 2>/dev/null; then
  echo "O painel ainda não tem senha. Rode:  uv run estudio configurar"
  echo "Depois:  bash scripts/codespace-iniciar.sh"
  exit 0
fi

# não sobe duas vezes
if pgrep -f "estudio painel" >/dev/null; then
  echo "O painel já está rodando (aba Portas, porta 8787)."
  exit 0
fi

# setsid: os processos continuam vivos depois que este script termina
setsid nohup uv run estudio painel --host 127.0.0.1 --port 8787 \
  >dados/logs/painel.log 2>&1 < /dev/null &
setsid nohup uv run estudio worker \
  >dados/logs/worker.log 2>&1 < /dev/null &

sleep 4
if pgrep -f "estudio painel" >/dev/null; then
  echo "Painel no ar. Abra pela aba Portas (porta 8787) ou pelo link que abriu sozinho."
else
  echo "O painel não subiu. Veja: tail -n 40 dados/logs/painel.log"
fi
