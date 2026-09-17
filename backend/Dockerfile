# Backend do Truco Mineiro — imagem de produção (Cloud Run).
# Contexto de build: a pasta `backend/` (o domínio já vem sincronizado em src/domain pelo
# `npm run sync-domain`, que o CI roda antes do `docker build`).

# ---- build --------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN node scripts/sync-domain.js && npx tsc -p tsconfig.build.json

# ---- migrate (Cloud Run Job: `prisma migrate deploy` + seed estrutural antes do deploy) ------
FROM build AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts"]

# ---- deps de produção -------------------------------------------------------------------------
FROM build AS prod-deps
# Só dependências de produção (sem devDependencies); o client Prisma gerado continua em node_modules.
RUN npm prune --omit=dev --ignore-scripts

# ---- runtime ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --chown=app:app package.json ./
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini repassa SIGTERM ao Node (desligamento ordenado: readiness 503 → drena → fecha sockets e Prisma).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
