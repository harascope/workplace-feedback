# uv で依存を解決し、python:3.13-slim の非 root ユーザーで uvicorn を動かす。
# 鍵（GEMINI_API_KEY 等）はこのイメージに焼かない。実行時に compose の環境変数/env_file から渡す。
# migration（alembic upgrade head）はこのイメージでは実行しない。deploy/deploy.sh が起動前に
# 別途コンテナ上で実行する（README「デプロイ」参照）。

FROM python:3.13-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.9.6 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# 依存関係だけを先に解決してレイヤーキャッシュを効かせる（アプリコードの変更で毎回再インストールしない）
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
RUN uv sync --frozen --no-dev

FROM python:3.13-slim AS runner
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

RUN groupadd -r api && useradd -r -g api api
COPY --from=builder --chown=api:api /app /app

USER api
EXPOSE 8000

# イメージに curl は無いので標準ライブラリの urllib で確かめる
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status == 200 else 1)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
