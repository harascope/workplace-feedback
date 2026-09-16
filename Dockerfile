# 本番用。開発用は Dockerfile.dev（docker-compose.yml 参照）。
# next.config.mjs の output: "standalone" が出力する .next/standalone を動かす。

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# devDependencies も入れる。tsconfig がテストまで型検査の対象にしているので、
# --omit=dev にすると next build の型チェックが落ちる
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# ANTHROPIC_API_KEY は設定しない。キー無しのスタブで動かす方針（README「デプロイ」参照）
USER node
# standalone は依存を同梱するので node_modules はコピーしない。public ディレクトリは無い
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
