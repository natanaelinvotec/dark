# Imagem do pipeline e do painel.
# Produção: fixe a imagem base por digest (python:3.12-slim@sha256:...) depois do primeiro build.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv==0.5.4

WORKDIR /app
COPY pyproject.toml uv.lock* README.md ./
RUN uv sync --no-dev --all-extras --no-install-project

COPY src ./src
COPY channels ./channels
COPY plataformas.yaml ./
COPY assets ./assets
RUN uv sync --no-dev --all-extras

RUN useradd --create-home --uid 10001 estudio \
    && mkdir -p /app/dados \
    && chown -R estudio /app/dados
USER estudio

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

EXPOSE 8787
# Dentro do container escuta em 0.0.0.0; o compose publica só em 127.0.0.1 do host.
CMD ["estudio", "painel", "--host", "0.0.0.0", "--port", "8787", "--permitir-rede"]
