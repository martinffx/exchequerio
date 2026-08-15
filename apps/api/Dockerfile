FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

WORKDIR /app

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/typescript-config/package.json ./packages/typescript-config/

RUN pnpm install --filter=@exchequerio/api --frozen-lockfile

COPY apps/api/ ./apps/api/
COPY packages/typescript-config/ ./packages/typescript-config/

RUN pnpm --filter=@exchequerio/api build

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/typescript-config/package.json ./packages/typescript-config/

RUN pnpm install --filter=@exchequerio/api --prod --frozen-lockfile

FROM node:24-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app/apps/api

COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./node_modules
COPY apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
