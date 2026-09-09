# syntax=docker/dockerfile:1

# ---- build: Bun でビルドする ----
# $env/dynamic/private は実行時に読むので、ビルドに DATABASE_URL などの秘密は不要。
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# ---- deps: 本番依存だけを別に入れる ----
# adapter-node の出力は drizzle-orm / postgres / nanoid を外部参照のまま残すので node_modules が要る。
# --omit=peer が要点: better-auth は prisma / mysql2 / drizzle-kit などを optional peer に並べており、
# これを外さないと svelte・typescript・rolldown 等のビルド専用ツールまで実行イメージに入る。
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit=peer --ignore-scripts

# ---- runtime: adapter-node の出力なので Node で動かす ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# drizzle/ は起動時マイグレーションの入力。SQL と meta/_journal.json の両方が要る。
COPY drizzle ./drizzle
COPY scripts/migrate.js ./scripts/migrate.js
COPY package.json ./
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# node:alpine 同梱の非 root ユーザー
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "build"]
